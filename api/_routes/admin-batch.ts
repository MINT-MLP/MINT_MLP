import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { tmToWgs84 } from '../_lib/coords.js';

// 어드민 배치 — 인허가(행안부 일반음식점) 캐시 적재. 사람만 부른다(POST + x-admin-secret).
// 블로그 버즈 캐시 워밍과 야간 크론은 네이버 검색 API 약관(2026-09-07 개정) 저촉으로 제거했다(17번 노트).
//
//   curl -X POST -H "x-admin-secret: ..." -H "content-type: application/json" \
//     -d '{"action":"refresh-license","regionCode":"3220000"}' https://.../api/admin/batch
// 이어서(done:false로 응답 온 경우):
//   -d '{"action":"refresh-license","regionCode":"3220000","pageNo":11,"resetRegion":false}'

// ───────────────────────── 인허가 캐시 적재 ─────────────────────────
// 인허가 API(행안부 일반음식점) 배치 적재 — 월 1회 수동 트리거 전용.
// 지역 하나당 데이터가 많으면(강남구 51,000+건) 한 번의 서버리스 호출(60초 제한)로 전량을
// 못 가져온다. 그래서 지역 1개 + 시작페이지(pageNo) 단위로 처리하고, 시간 예산(45초) 안에서
// 페이지를 채운 뒤 done:false + nextPageNo를 반환한다 — 호출자는 done:true가 될 때까지
// 같은 regionCode에 nextPageNo를 넣어 재호출하면 된다.
//
// ⚠️ OPN_ATMY_GRP_CD(개방자치단체코드)는 행안부 표준 5자리 지역코드가 아니라 LOCALDATA 체계의
// 7자리 코드다(예: 서울 강남구=3220000, 실제 API 응답으로 검증됨).

const LICENSE_TIME_BUDGET_MS = 45_000; // Vercel maxDuration(60s) 안에서 여유를 두고 조기 종료
const PAGE_SIZE = 100;

interface HistoryItem {
  BPLC_NM: string;
  ROAD_NM_ADDR?: string;
  LOTNO_ADDR?: string;
  LCPMT_YMD?: string;
  SALS_STTS_CD?: string;
  CRD_INFO_X?: string;
  CRD_INFO_Y?: string;
}

// 실패 시 빈 배열이 아니라 throw — 호출부에서 "더 이상 데이터 없음"과 "일시적 오류"를
// 구분해야 한다(구분 안 하면 일시적 오류를 done:true로 착각해 나머지 페이지를 조용히
// 누락한다 — 실제로 겪은 문제).
async function fetchPage(regionCode: string, baseDate: string, pageNo: number, serviceKey: string): Promise<HistoryItem[]> {
  const params = new URLSearchParams({
    serviceKey,
    returnType: 'json',
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    'cond[BASE_DATE::EQ]': baseDate,
    'cond[OPN_ATMY_GRP_CD::EQ]': regionCode,
    'cond[SALS_STTS_CD::EQ]': '01', // 영업/정상만
  });
  const res = await fetch(`https://apis.data.go.kr/1741000/general_restaurants/history?${params}`);
  if (!res.ok) throw new Error(`data.go.kr HTTP ${res.status}`);
  const data = await res.json() as {
    response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: HistoryItem[] | HistoryItem } } };
  };
  const resultCode = data.response?.header?.resultCode;
  if (resultCode !== '0') throw new Error(`data.go.kr resultCode=${resultCode} msg=${data.response?.header?.resultMsg}`);

  const rawItems = data.response?.body?.items?.item;
  return Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
}

async function runRefreshLicense(
  body: { regionCode?: string; pageNo?: number; baseDate?: string; resetRegion?: boolean },
  res: VercelResponse,
) {
  const startedAt = Date.now();

  const serviceKey = process.env.PUBLIC_DATA_SERVICE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'PUBLIC_DATA_SERVICE_KEY 미설정' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase 설정이 없습니다.' });

  const regionCode = body.regionCode;
  if (!regionCode) {
    return res.status(400).json({ error: 'regionCode가 필요합니다 (예: "3220000"). 지역 하나씩만 처리합니다.' });
  }

  const now = new Date();
  const baseDate = body.baseDate ??
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const startPageNo = body.pageNo ?? 1;

  // 재실행(첫 페이지) 시에만 기존 행 삭제 — 이어받기 호출에서는 지우면 안 됨
  if (startPageNo === 1 && body.resetRegion !== false) {
    await supabase.from('license_cache').delete().eq('region_code', regionCode);
  }

  let pageNo = startPageNo;
  let fetched = 0;
  let upserted = 0;
  const sampleAddresses: string[] = [];
  let done = false;
  let pageError: string | null = null;

  while (Date.now() - startedAt < LICENSE_TIME_BUDGET_MS) {
    let items: HistoryItem[];
    try {
      items = await fetchPage(regionCode, baseDate, pageNo, serviceKey);
    } catch (e) {
      // 이 페이지에서 일시적 오류 — done:true로 착각하지 않도록 done:false + 같은 pageNo로
      // 반환해 호출자가 이 페이지부터 재시도할 수 있게 한다.
      pageError = (e as Error).message;
      console.error('[admin-batch/refresh-license] page fetch failed', regionCode, pageNo, pageError);
      break;
    }

    if (items.length === 0) { done = true; break; }

    fetched += items.length;
    const rows = items
      .map((it) => {
        const x = parseFloat((it.CRD_INFO_X ?? '').trim());
        const y = parseFloat((it.CRD_INFO_Y ?? '').trim());
        if (!it.BPLC_NM || Number.isNaN(x) || Number.isNaN(y)) return null;
        const { lat, lng } = tmToWgs84(x, y);
        return {
          region_code: regionCode,
          biz_name: it.BPLC_NM,
          address: it.ROAD_NM_ADDR || it.LOTNO_ADDR || null,
          lat,
          lng,
          license_date: it.LCPMT_YMD || null,
          status_code: it.SALS_STTS_CD || null,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      try {
        const { error } = await supabase.from('license_cache').insert(rows);
        if (!error) {
          upserted += rows.length;
          if (sampleAddresses.length < 3) sampleAddresses.push(...rows.slice(0, 3 - sampleAddresses.length).map((r) => r.address ?? '(주소 없음)'));
        } else {
          console.error('[admin-batch/refresh-license] insert failed', regionCode, pageNo, error.message);
        }
      } catch (e) {
        console.error('[admin-batch/refresh-license] insert threw', regionCode, pageNo, e);
      }
    }

    if (items.length < PAGE_SIZE) { done = true; break; }
    pageNo += 1;
  }

  return res.status(200).json({
    regionCode,
    baseDate,
    done,
    nextPageNo: done ? null : pageNo,
    fetchedThisCall: fetched,
    upsertedThisCall: upserted,
    sampleAddresses,
    ...(pageError ? { pageError } : {}),
  });
}

// ───────────────────────── 라우팅 ─────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  // 어떤 action이든 x-admin-secret 하나로 막는다 — action을 보기 전에 인증부터.
  const adminSecret = process.env.ADMIN_REFRESH_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(401).json({ error: '인증 실패' });
  }

  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof rawBody.action === 'string' ? rawBody.action : '';

  if (action === 'refresh-license') {
    return runRefreshLicense(rawBody as {
      regionCode?: string; pageNo?: number; baseDate?: string; resetRegion?: boolean;
    }, res);
  }

  return res.status(400).json({ error: 'action이 필요해요. "refresh-license"(인허가 캐시 적재)를 지정해주세요.' });
}
