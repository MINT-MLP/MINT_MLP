import { useEffect, useState } from 'react';
import type { MockMeeting } from '@/pages/mock/data/meetings';
import { loadMeetings } from '@/pages/mock/data/sources';
import { getPlanFrame, isPreregistered, planPriceLabel } from '@/storage/treasurerPlan';
import { getDeviceId } from '@/storage/device';
import { trackEvent } from '@/services/analytics';
import { TreasurerPlanSheet, Icon, IconCalendar, IconMapPin, IconChevronDown, IconUserCircle } from '@/components';
import { buildMapLink } from '@/storage/wishlist';

// 배지는 카드당 1개만 둔다. 색은 "지금 내 응답이 필요한 상태"(취합 중)에만 민트를 쓰고
// 나머지는 회색조 — 우상단이 알록달록한 라벨 뭉치가 되지 않게 하는 게 목적이다.
const STATUS_BADGE: Record<MockMeeting['status'], { label: string; className: string }> = {
  collecting: { label: '취합 중', className: 'bg-mint-100 text-mint-600' },
  confirmed: { label: '장소 확정', className: 'bg-gray-100 text-gray-500' },
  past: { label: '지난 모임', className: 'bg-gray-100 text-gray-400' },
};

function ddayLabel(dateISO: string): string | null {
  const target = new Date(dateISO);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) return null;
  return days === 0 ? 'D-DAY' : `D-${days}`;
}

interface Props {
  onGoHome?: () => void;
  onChromeChange?: (showTabBar: boolean) => void;
}

// 내 모임 탭 — 모임 카드는 아직 목업(서버 기능 없음), 총무 플랜 배너만 실제 계측된다.
export default function MyMeetings({ onGoHome, onChromeChange }: Props) {
  const [planFrame] = useState(() => getPlanFrame());
  const [prereg, setPrereg] = useState(() => isPreregistered());
  const [showPlanSheet, setShowPlanSheet] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // 총무 플랜 시트가 열리면 하단 탭바를 내린다 — 안 그러면 시트 하단 CTA가 탭바에 가린다.
  useEffect(() => {
    onChromeChange?.(!showPlanSheet);
  }, [showPlanSheet, onChromeChange]);

  const [meetings] = useState(loadMeetings);
  const upcoming = meetings.filter((m) => m.status !== 'past');
  const past = meetings.filter((m) => m.status === 'past');

  return (
    <div className="max-w-md mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="flex items-center gap-2 text-[22px] font-black text-gray-900">
        <IconCalendar className="h-6 w-6 text-mint-600" />
        내 모임
      </h1>
      <p className="mt-1 text-sm text-gray-400">약속 잡은 모임들을 한눈에 볼 수 있어요.</p>

      {upcoming.length === 0 && past.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-gray-100 bg-white px-5 py-10 text-center">
          <IconCalendar className="mx-auto h-8 w-8 text-gray-200" />
          <p className="mt-3 text-sm font-black text-gray-700">아직 등록된 모임이 없어요</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 break-keep">
            홈에서 추천을 받으면 여기에 모임이 자동으로 모여요
          </p>
          <button
            onClick={() => { trackEvent('meetings_empty_cta_click', { device_id: getDeviceId() }); onGoHome?.(); }}
            className="mt-4 min-h-10 rounded-2xl bg-mint-500 px-5 py-3 text-sm font-black text-white transition-transform active:scale-[0.98]"
          >
            장소 추천 받으러 가기
          </button>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="mt-6">
              <p className="px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                다가오는 모임 · {upcoming.length}건
              </p>
              <div className="flex flex-col gap-3">
                {upcoming.map((m) => <MeetingCard key={m.id} meeting={m} />)}
              </div>
            </section>
          )}

          {/* 총무 플랜 가짜 문 — 응답 현황을 먼저 보여준 뒤 제안해야 설득력이 있다 */}
          <button
            onClick={() => { trackEvent('plan_entry_click', { device_id: getDeviceId(), frame: planFrame, source: 'meetings_tab' }); setShowPlanSheet(true); }}
            className="mt-4 w-full text-left rounded-2xl bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-all"
          >
            <Icon name="user" className="text-2xl shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-amber-800 leading-snug break-keep">매번 장소 정하는 거, 이제 독박 그만</p>
              <p className="text-xs text-amber-600 mt-0.5">
                {prereg ? '사전등록 완료 · 출시되면 알려드릴게요' : `총무 플랜 ${planPriceLabel(planFrame)} · 자세히 알아보기 →`}
              </p>
            </div>
          </button>

          {past.length > 0 && (
            <section className="mt-4">
              <button
                onClick={() => setShowPast((v) => !v)}
                aria-expanded={showPast}
                className="flex min-h-10 w-full items-center justify-center gap-1 py-2 text-xs font-bold text-gray-400 active:scale-[0.99] transition-transform"
              >
                {showPast ? '지난 모임 접기' : `지난 모임 ${past.length}건 보기`}
                <IconChevronDown className={`h-4 w-4 transition-transform ${showPast ? 'rotate-180' : ''}`} />
              </button>
              {showPast && (
                <div className="mt-1 flex flex-col gap-3">
                  {past.map((m) => <MeetingCard key={m.id} meeting={m} />)}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <p className="mt-5 text-center text-[11px] text-gray-400">모임 관리 기능은 출시 준비 중이에요</p>

      {showPlanSheet && (
        <TreasurerPlanSheet
          frame={planFrame}
          onClose={() => { setShowPlanSheet(false); setPrereg(isPreregistered()); }}
        />
      )}
    </div>
  );
}

function MeetingCard({ meeting: m }: { meeting: MockMeeting }) {
  const badge = STATUS_BADGE[m.status];
  const ratio = m.totalCount > 0 ? Math.round((m.respondedCount / m.totalCount) * 100) : 0;
  const dday = m.status === 'past' ? null : ddayLabel(m.dateISO);

  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-4 ${m.status === 'past' ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="truncate text-sm font-black text-gray-800">{m.title}</p>
            {/* 총무는 배지 대신 제목 옆 12px 아이콘으로 — 우상단 라벨 뭉침을 만들지 않는다 */}
            {m.isHost && (
              <span className="shrink-0 text-mint-600" title="내가 총무인 모임">
                <IconUserCircle className="h-3 w-3" strokeWidth={2.4} />
                <span className="sr-only">총무</span>
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">{m.dateLabel}{m.areaName ? ` · ${m.areaName}` : ''}</p>
        </div>
        {/* D-day는 별도 배지가 아니라 상태 앞 텍스트로 합친다(D-3 · 취합 중) */}
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${badge.className}`}>
          {dday ? `${dday} · ` : ''}{badge.label}
        </span>
      </div>

      {/* 응답 현황 — 정보성 진행바(게이미피케이션 아님) */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] font-bold text-gray-400">
          <span>응답 현황</span>
          <span>{m.respondedCount}/{m.totalCount}명</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={m.totalCount}
          aria-valuenow={m.respondedCount}
          aria-label="응답 현황"
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
        >
          <div className="h-full rounded-full bg-mint-500 transition-all" style={{ width: `${ratio}%` }} />
        </div>
      </div>

      {/* 확정 장소는 발굴 탭과 같은 규칙으로 카카오맵 링크(같은 요소면 인터랙션도 같아야 한다) */}
      {m.placeName ? (
        <a
          href={buildMapLink(m.placeName)}
          target="_blank"
          rel="noreferrer"
          className="mt-1 -mx-1 flex min-h-10 items-center gap-1 rounded-xl px-1 text-xs text-gray-500 transition-transform active:scale-[0.99]"
        >
          <IconMapPin className="h-4 w-4 shrink-0 text-mint-600" />
          <span className="truncate font-bold text-gray-700">{m.placeName}</span>
          <span aria-hidden className="shrink-0 text-mint-600">›</span>
        </a>
      ) : (
        <p className="mt-1 flex min-h-10 items-center gap-1 text-xs text-gray-500">
          <IconMapPin className="h-4 w-4 shrink-0 text-gray-300" />
          아직 장소를 정하는 중이에요
        </p>
      )}
    </div>
  );
}
