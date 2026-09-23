// 장소 카테고리 분류표 수집 — 카카오 로컬 API 응답의 category_name만 모아 place_category에 upsert한다.
//
// 가게 데이터(이름·ID·좌표·주소)는 메모리에서도 보관하지 않는다. 응답에서 category_name만 꺼내고 버린다.
//
// 실행:
//   node --env-file=.env.local --env-file=.env.migrate scripts/collect-place-categories.mjs --yes
//   옵션: --max=10000 (호출 상한)  --stall=2000 (새 경로 없이 N회 연속이면 종료)
//         --dry-run (DB에 쓰지 않고 집계만)  --ref=<프로젝트ref> (기본 dev ref, 다르면 중단)
// 읽는 env:
//   VITE_KAKAO_REST_API_KEY            (.env.local)
//   DST_SUPABASE_URL, DST_SERVICE_ROLE_KEY   (.env.migrate — 이관 대상 = dev)
// 일 한도: 키워드·카테고리 검색 각 100,000회(앱 단위). 기본 상한 10,000.

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const MAX_CALLS = Number(args.max ?? 10000);
const STALL_LIMIT = Number(args.stall ?? 2000);
const DRY_RUN = !!args['dry-run'];
const EXPECT_REF = String(args.ref ?? 'bhsihxqkyjomlukymzlr');

const KAKAO_KEY = process.env.VITE_KAKAO_REST_API_KEY;
const DB_URL = process.env.DST_SUPABASE_URL;
const DB_KEY = process.env.DST_SERVICE_ROLE_KEY;
if (!KAKAO_KEY) die('VITE_KAKAO_REST_API_KEY 없음');
if (!DRY_RUN) {
  if (!DB_URL || !DB_KEY) die('DST_SUPABASE_URL / DST_SERVICE_ROLE_KEY 없음 (.env.migrate)');
  const ref = new URL(DB_URL).hostname.split('.')[0];
  if (ref !== EXPECT_REF) die(`대상 프로젝트가 ${ref} — 기대값 ${EXPECT_REF}와 다름. --ref로 명시하거나 env를 확인할 것`);
  if (!args.yes) die(`대상 ${ref}에 쓰려면 --yes 필요`);
}

function die(msg) { console.error(msg); process.exit(1); }

// 수집 지점 — 중심 좌표(대략값). 상권이 다르면 카테고리 분포가 달라지므로 넓게 잡는다.
const AREAS = [
  // 서울 25구
  ['종로', 37.5735, 126.9790], ['중구', 37.5641, 126.9979], ['용산', 37.5326, 126.9906], ['성동', 37.5634, 127.0369],
  ['광진', 37.5385, 127.0823], ['동대문', 37.5744, 127.0396], ['중랑', 37.6063, 127.0928], ['성북', 37.5894, 127.0167],
  ['강북', 37.6397, 127.0256], ['도봉', 37.6688, 127.0471], ['노원', 37.6543, 127.0568], ['은평', 37.6027, 126.9291],
  ['서대문', 37.5791, 126.9368], ['마포', 37.5637, 126.9086], ['양천', 37.5170, 126.8665], ['강서', 37.5510, 126.8495],
  ['구로', 37.4954, 126.8875], ['금천', 37.4569, 126.8955], ['영등포', 37.5264, 126.8963], ['동작', 37.5124, 126.9393],
  ['관악', 37.4784, 126.9516], ['서초', 37.4837, 127.0324], ['강남', 37.5172, 127.0473], ['송파', 37.5145, 127.1059],
  ['강동', 37.5301, 127.1238],
  // 서울 핵심 상권
  ['강남역', 37.4979, 127.0276], ['홍대', 37.5563, 126.9236], ['성수동', 37.5445, 127.0560], ['이태원', 37.5345, 126.9946],
  ['건대', 37.5403, 127.0695], ['신촌', 37.5551, 126.9368], ['을지로', 37.5663, 126.9910], ['잠실', 37.5133, 127.1001],
  ['여의도', 37.5219, 126.9245], ['연남동', 37.5626, 126.9254],
  // 경기·인천
  ['수원역', 37.2659, 127.0000], ['수원 광교', 37.2860, 127.0560], ['성남 분당', 37.3825, 127.1190], ['성남 판교', 37.3948, 127.1112],
  ['고양 일산', 37.6583, 126.7710], ['용인 수지', 37.3222, 127.0978], ['안양 범계', 37.3897, 126.9506], ['부천', 37.5036, 126.7660],
  ['화성 동탄', 37.2010, 127.0730], ['남양주', 37.6360, 127.2165], ['김포', 37.6153, 126.7157], ['의정부', 37.7380, 127.0337],
  ['하남', 37.5393, 127.2148], ['광명', 37.4786, 126.8646],
  ['인천 부평', 37.4893, 126.7245], ['인천 구월동', 37.4486, 126.7226], ['인천 송도', 37.3826, 126.6566], ['인천 검단', 37.5990, 126.6960],
  // 광역시·주요 도시
  ['부산 서면', 35.1578, 129.0595], ['부산 해운대', 35.1631, 129.1636], ['부산 남포동', 35.0987, 129.0300],
  ['대구 동성로', 35.8697, 128.5946], ['대구 수성', 35.8580, 128.6303], ['대전 둔산동', 36.3510, 127.3785], ['대전 유성', 36.3620, 127.3563],
  ['광주 상무', 35.1520, 126.8520], ['광주 충장로', 35.1470, 126.9180], ['울산 삼산', 35.5384, 129.3374], ['세종', 36.4800, 127.2890],
  ['제주시', 33.4996, 126.5312], ['서귀포', 33.2541, 126.5601], ['강릉', 37.7519, 128.8761], ['전주 한옥마을', 35.8150, 127.1530],
  ['청주', 36.6424, 127.4890], ['천안', 36.8151, 127.1139], ['창원', 35.2281, 128.6811], ['포항', 36.0190, 129.3435],
  ['여수', 34.7604, 127.6622], ['춘천', 37.8813, 127.7298],
];

// 키워드 — 업종·메뉴·업태를 넓게. 지역명과 조합해 키워드 검색.
const KEYWORDS = [
  '맛집', '한식', '중식', '일식', '양식', '아시안', '분식', '뷔페', '샐러드', '샤브샤브', '철판', '치킨', '패스트푸드', '퓨전',
  '초밥', '회', '참치', '해물탕', '대게', '조개', '굴', '장어', '복어', '아구', '추어탕', '곱창', '삼겹살', '한우', '갈비', '족발', '보쌈',
  '오리', '닭갈비', '닭요리', '불고기', '국밥', '설렁탕', '곰탕', '감자탕', '해장국', '냉면', '칼국수', '수제비', '순대', '쌈밥', '두부',
  '한정식', '찌개', '전골', '백반', '죽', '피자', '파스타', '이탈리안', '스테이크', '햄버거', '멕시칸', '스페인', '프렌치', '브런치',
  '쌀국수', '베트남', '태국', '인도', '커리', '돈까스', '우동', '라멘', '오마카세', '덮밥', '짬뽕', '짜장', '마라탕', '양꼬치', '딤섬', '훠궈',
  '이자카야', '포차', '호프', '맥주', '와인바', '칵테일바', '펍', '막걸리', '사케', '오뎅바', '위스키', '바',
  '카페', '커피', '디저트', '베이커리', '케이크', '북카페', '티카페', '전통찻집', '아이스크림', '빙수', '도넛', '떡', '초콜릿', '생과일',
  '애견카페', '고양이카페', '보드게임카페', '만화카페', '룸카페', '갤러리카페',
  '비건', '채식', '샌드위치', '토스트', '도시락', '김밥', '떡볶이', '핫도그', '닭강정', '와플', '크로플',
];

const seen = new Set();          // full path 문자열
const rows = new Map();          // full path → {depth1..4}
let calls = 0;
let lastNewAt = 0;
let stop = false;

async function hit(url) {
  if (calls >= MAX_CALLS || stop) return;
  calls++;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  } catch { return; }
  if (res.status === 429) { console.warn('429 — 잠시 대기'); await sleep(2000); return; }
  if (!res.ok) return;
  const data = await res.json();
  for (const d of data.documents ?? []) {
    const path = d.category_name;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const parts = path.split('>').map((s) => s.trim());
    if (parts[0] !== '음식점') continue;    // 관광명소·주차장 등 잡음 제외
    rows.set(path, { depth1: parts[0], depth2: parts[1] ?? '', depth3: parts[2] ?? '', depth4: parts[3] ?? '' });
    lastNewAt = calls;
  }
  if (calls - lastNewAt >= STALL_LIMIT) stop = true;
  if (calls % 500 === 0) console.log(`calls=${calls} paths=${rows.size} lastNewAt=${lastNewAt}`);
  await sleep(30);
  return data.meta?.is_end;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`시작: 지점 ${AREAS.length}, 키워드 ${KEYWORDS.length}, 상한 ${MAX_CALLS}회, 정체 종료 ${STALL_LIMIT}회${DRY_RUN ? ', DRY-RUN' : ''}`);

for (const [name, lat, lng] of AREAS) {
  if (stop) break;
  // 카테고리 검색: 음식점·카페를 페이지 끝까지 (size 15, 최대 45페이지)
  for (const code of ['FD6', 'CE7']) {
    for (let page = 1; page <= 45 && !stop; page++) {
      const end = await hit(`https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${code}&x=${lng}&y=${lat}&radius=3000&size=15&page=${page}`);
      if (end !== false) break;   // is_end true 또는 실패
    }
  }
  // 키워드 검색: 지역명 + 키워드
  for (const kw of KEYWORDS) {
    if (stop) break;
    await hit(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(`${name} ${kw}`)}&x=${lng}&y=${lat}&radius=5000&size=15`);
  }
}

console.log(`종료: calls=${calls} 음식점 경로 ${rows.size}종 (전체 ${seen.size}종)${stop ? ' — 정체 종료' : ''}`);

// 요약 출력 (2단계별 개수)
const byDepth2 = new Map();
for (const r of rows.values()) byDepth2.set(r.depth2, (byDepth2.get(r.depth2) ?? 0) + 1);
for (const [k, v] of [...byDepth2.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k || '(2단계 없음)'}`);

if (DRY_RUN) process.exit(0);

// upsert — (depth1..4) unique 기준. 기존 행의 is_brand·sort는 건드리지 않는다(ignoreDuplicates).
const supabase = createClient(DB_URL, DB_KEY, { auth: { persistSession: false } });
const list = [...rows.values()];
let inserted = 0;
for (let i = 0; i < list.length; i += 200) {
  const chunk = list.slice(i, i + 200);
  const { error, data } = await supabase
    .from('place_category')
    .upsert(chunk, { onConflict: 'depth1,depth2,depth3,depth4', ignoreDuplicates: true })
    .select('id');
  if (error) die(`upsert 실패: ${error.message}`);
  inserted += data?.length ?? 0;
}
const { count } = await supabase.from('place_category').select('*', { count: 'exact', head: true });
console.log(`upsert 완료: 신규 ${inserted}행, 테이블 총 ${count}행`);
