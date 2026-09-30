import { useState } from 'react';
import AdminStatCard from '@/components/AdminStatCard';
import AdminBarRow from '@/components/AdminBarRow';
import { pctLabel, formatDate } from '@/utils/format';

// 어드민 재방문(리텐션) 섹션 — api/_lib/retention.ts가 접어 보낸 기기별 방문 타임라인을 보여준다.
// 방문 = 기기당 KST 하루 1회(sql/user-visits.sql). 수집은 2026-10-01부터라 그 전 방문은 없다.
// 그 전 구간은 버튼을 누르면 행동 흔적(탭 클릭·찜·피드백 등)으로 추정한 값을 따로 보여준다 — 정답과 섞지 않는다.

export interface RetentionStep {
  n: number;
  at: string;
  date: string;
  gapDays: number | null;
  path: string | null;
}

export interface RetentionUser {
  deviceId: string;
  userId: string | null;
  nickname: string | null;
  visitCount: number;
  firstAt: string;
  lastAt: string;
  steps: RetentionStep[];
}

export interface RetentionData {
  available: boolean;
  since: string;
  summary?: {
    users: number;
    returning: number;
    threePlus: number;
    avgVisits: number | null;
    medianFirstGapDays: number | null;
    distribution: { one: number; two: number; three: number; four: number; fivePlus: number };
  };
  users?: RetentionUser[];
  visitsScanned?: number;
  truncated?: boolean;
  failedSources?: string[];   // 추정 전용 — 조회에 실패해 빠진 흔적 소스
}

// 한 번에 그리는 유저 행 수 — 300명을 한꺼번에 펼치면 모바일에서 스크롤이 끝나지 않는다
const PAGE = 30;

const REACH_BARS: `bg-${string}`[] = ['bg-mint-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500'];

function gapLabel(gapDays: number | null): string {
  if (gapDays == null) return '첫 방문';
  if (gapDays <= 1) return '다음 날 재방문';
  return `이전 방문 ${gapDays}일 뒤`;
}

// 요약 카드 + N번째 도달 막대 + 기기별 타임라인. 정답(user_visits)과 추정이 같은 모양을 쓴다.
function RetentionBody({ data, estimate }: { data: RetentionData; estimate?: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [returningOnly, setReturningOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  // 목록이 길어 아래 섹션까지 스크롤이 멀어진다 — 카드째 접을 수 있게 한다
  const [listOpen, setListOpen] = useState(true);

  const s = data.summary;
  const allUsers = data.users ?? [];
  const list = returningOnly ? allUsers.filter((u) => u.visitCount >= 2) : allUsers;
  const unitWord = estimate ? '활동' : '방문';

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // "N번째 방문까지 온 기기" — 분포를 누적해 퍼널로 본다(2번째까지 온 비율 = 재방문율)
  const d = s?.distribution;
  const reach = s && d ? [
    { label: '1번째', count: s.users },
    { label: '2번째', count: d.two + d.three + d.four + d.fivePlus },
    { label: '3번째', count: d.three + d.four + d.fivePlus },
    { label: '4번째', count: d.four + d.fivePlus },
    { label: '5번째+', count: d.fivePlus },
  ] : [];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <AdminStatCard label={`${unitWord} 유저(기기)`} value={s?.users ?? 0} unit="명" />
        <AdminStatCard
          label="재방문 유저 (2회+)"
          value={s?.returning ?? 0}
          unit="명"
          sub={`재방문율 ${pctLabel(s?.returning ?? 0, s?.users ?? 0)}`}
          highlight={!estimate}
        />
        <AdminStatCard label={`평균 ${unitWord} 일수`} value={s?.avgVisits ?? '—'} unit={s?.avgVisits != null ? '회' : undefined} />
        <AdminStatCard
          label="첫 재방문까지 (중앙값)"
          value={s?.medianFirstGapDays ?? '—'}
          unit={s?.medianFirstGapDays != null ? '일' : undefined}
          sub="1번째 → 2번째 방문 간격"
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3">
        <div className="text-xs font-bold text-gray-500 mb-3">N번째 {unitWord}까지 온 유저</div>
        <div className="flex flex-col gap-2">
          {reach.map((r, i) => (
            <AdminBarRow key={r.label} label={r.label} count={r.count} total={s?.users ?? 0} bar={REACH_BARS[i]} />
          ))}
        </div>
      </div>

      {data.truncated && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-600">
          ⚠️ 기록 {data.visitsScanned?.toLocaleString()}건 상한에 걸려 오래된 기록부터 이만큼만 집계했어요.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={listOpen}
        >
          <span className="text-xs font-bold text-gray-500">
            유저 목록 <span className="text-gray-400 font-normal">({list.length}명 · {unitWord} 많은 순)</span>
          </span>
          <span className="text-[11px] text-gray-400 shrink-0">{listOpen ? '접기 ▲' : '펼치기 ▼'}</span>
        </button>

        {listOpen && (
        <>
        <div className="flex items-center justify-between mt-3 mb-2 gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={returningOnly}
              onChange={(e) => { setReturningOnly(e.target.checked); setShown(PAGE); }}
            />
            2회 이상만
          </label>
          {expanded.size > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              className="text-[11px] font-bold text-gray-500 bg-gray-50 rounded-lg px-2 py-1"
            >
              펼친 기록 모두 접기
            </button>
          ) : (
            <span className="text-[11px] text-gray-400">탭하면 회차별 기록</span>
          )}
        </div>

        {list.length === 0 ? (
          <div className="text-xs text-gray-400 py-4 text-center">
            {returningOnly ? '아직 다시 온 유저가 없어요.' : `아직 기록된 ${unitWord}이 없어요.`}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {list.slice(0, shown).map((u) => {
              const open = expanded.has(u.deviceId);
              return (
                <li key={u.deviceId} className="py-2">
                  <button
                    type="button"
                    onClick={() => toggle(u.deviceId)}
                    className="w-full flex items-center gap-3 text-left"
                    aria-expanded={open}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-700 truncate">
                        {u.nickname ?? `기기 ${u.deviceId.slice(0, 10)}`}
                        {u.userId && (
                          <span className="ml-1.5 text-[10px] font-bold text-mint-600 bg-mint-100 rounded px-1 py-0.5 align-middle">로그인</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        첫 {unitWord} {formatDate(u.firstAt)} · 최근 {formatDate(u.lastAt)}
                      </div>
                    </div>
                    <span className={`text-sm font-black shrink-0 ${estimate ? 'text-gray-500' : 'text-mint-500'}`}>{u.visitCount}회</span>
                    <span className="text-[10px] text-gray-300 shrink-0">{open ? '▲' : '▼'}</span>
                  </button>
                  {open && (
                    <ol className={`mt-2 ml-1 pl-3 border-l-2 flex flex-col gap-1.5 ${estimate ? 'border-gray-200' : 'border-mint-200'}`}>
                      {u.steps.map((st) => (
                        <li key={st.n} className="text-xs flex flex-wrap items-baseline gap-x-2">
                          <span className="font-black text-gray-700 w-12 shrink-0">{st.n}번째</span>
                          <span className="text-gray-600">{formatDate(st.at)}</span>
                          <span className="text-[11px] text-gray-400">
                            {gapLabel(st.gapDays)}{st.path ? ` · ${st.path}` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {list.length > shown && (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="mt-2 w-full text-xs font-bold text-gray-500 bg-gray-50 rounded-xl py-2"
          >
            더 보기 ({list.length - shown}명 남음)
          </button>
        )}

        {/* 긴 목록 끝에서 맨 위 헤더까지 올라가지 않고 바로 접는다 */}
        {list.length > 5 && (
          <button
            type="button"
            onClick={() => setListOpen(false)}
            className="mt-2 w-full text-xs font-bold text-gray-400 py-2"
          >
            목록 접기 ▲
          </button>
        )}
        </>
        )}
      </div>

      {allUsers.length > 0 && s && s.users > allUsers.length && (
        <p className="text-[11px] text-gray-400 mt-2 px-1">
          * 목록은 {unitWord} 많은 순 상위 {allUsers.length}명만 보여요(요약 수치는 전체 기준).
        </p>
      )}
    </>
  );
}

export default function AdminRetentionSection({ data, onLoadEstimate }: {
  data: RetentionData | null;
  onLoadEstimate: () => Promise<RetentionData>;
}) {
  const since = data?.since ?? '2026-10-01';
  const [estimate, setEstimate] = useState<RetentionData | null>(null);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  async function openEstimate() {
    setEstimateOpen((v) => !v);
    if (estimate || estimateLoading) return;
    setEstimateLoading(true);
    setEstimateError(null);
    try {
      setEstimate(await onLoadEstimate());
    } catch (e) {
      setEstimateError(e instanceof Error ? e.message : '불러오지 못했어요.');
    } finally {
      setEstimateLoading(false);
    }
  }

  return (
    <section className="mb-6">
      <h2 className="text-sm font-black text-gray-600 mb-3">
        🔁 재방문 <span className="text-gray-300 font-normal">(유저가 다시 돌아오나)</span>
      </h2>

      {/* 수집 시작일 — 이 날 이전 접속은 기록이 없어 "1번째 방문"이 실제보다 늦게 잡힐 수 있다 */}
      <div className="mb-3 bg-mint-100 border border-mint-200 rounded-2xl p-4">
        <div className="text-sm font-bold text-mint-600 mb-1">📅 {since}부터 추가된 기능이에요</div>
        <div className="text-xs text-gray-500">
          재방문 기록은 {since}부터 수집했어요. 그 전에 온 유저는 {since} 이후 첫 접속이 "1번째 방문"으로 잡혀요.
          방문은 기기당 하루 1회(한국 시간)로 세고, 위 기간 필터와 무관하게 전체 기록을 보여줘요.
        </div>
      </div>

      {!data?.available ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-xs text-gray-500">
          아직 재방문 데이터가 없어요. Supabase SQL Editor에서 <code className="font-mono">sql/user-visits.sql</code>을
          실행했는지 확인해주세요. 실행 후 배포되면 그때부터 쌓여요.
        </div>
      ) : (
        <RetentionBody data={data} />
      )}

      <p className="text-[11px] text-gray-400 mt-2 px-1">
        * 기기 기준이라 같은 사람이 폰·PC로 오면 2명, 브라우저 데이터를 지우면 새 유저로 잡혀요.
        하루에 여러 번 켜도 1회이고, 시각은 그날 첫 접속이에요. 로그인 유저는 닉네임으로 보여요.
      </p>

      {/* ── 수집 시작 전 추정 — 누를 때만 불러온다(과거 흔적 전체를 훑는 무거운 조회) ── */}
      <div className="mt-4">
        <button
          type="button"
          onClick={openEstimate}
          className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-left"
          aria-expanded={estimateOpen}
        >
          <span>
            <span className="text-sm font-bold text-gray-600">📜 {since} 이전 재방문 (추정치)</span>
            <span className="block text-[11px] text-gray-400">버튼 클릭 등 행동 흔적으로 추정 · 누르면 불러와요</span>
          </span>
          <span className="text-[10px] text-gray-400">{estimateOpen ? '▲' : '▼'}</span>
        </button>

        {estimateOpen && (
          <div className="mt-3">
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="text-sm font-bold text-amber-700 mb-1">⚠️ 정확한 방문 기록이 아니에요</div>
              <div className="text-xs text-amber-600">
                {since} 전에는 방문 자체를 기록하지 않았어요. 대신 기기 ID가 남은 행동(탭 클릭·찜·피드백·그룹 참여·
                로그인 유저 추천 기록 등)이 있었던 날을 방문일로 잡았어요. 들어와서 아무것도 안 누른 날은 빠지므로
                실제보다 <b>적게</b> 잡혀요(하한값). 회차별 기록의 오른쪽 글자는 그날 잡힌 흔적 종류예요.
              </div>
            </div>
            {estimateLoading && <div className="text-xs text-gray-400 py-4 text-center">과거 기록을 훑는 중이에요…</div>}
            {estimateError && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-xs text-red-500">{estimateError}</div>
            )}
            {estimate && (
              <>
                {(estimate.failedSources?.length ?? 0) > 0 && (
                  <div className="mb-3 text-[11px] text-gray-400 px-1">
                    * 조회에 실패해 빠진 소스: {estimate.failedSources?.join(', ')}
                  </div>
                )}
                <RetentionBody data={estimate} estimate />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
