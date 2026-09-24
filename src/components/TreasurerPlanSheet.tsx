import { useEffect, useRef, useState } from 'react';
import { getDeviceId } from '@/storage/device';
import { trackEvent } from '@/services/analytics';
import { isPreregistered, markPreregistered, type PlanFrame } from '@/storage/treasurerPlan';
import { Icon, type IconName } from '@/components/icons';

// 총무 플랜 '자세히 알아보기' 상세 시트 — 구독하면 어떤 서비스가 실현되는지 보여준다.
// 결제·기능은 없다(가짜 문). 순수 가격 검증 + 사전등록. 가격 프레임은 기기별 A/B 고정.

const DOISS: { icon: IconName; pain: string; solve: string; live: boolean }[] = [
  { icon: 'chat', pain: '질문 폭탄에 1:1 답장', solve: '링크 하나로 취합 — 멤버가 각자 취향·출발지를 직접 입력', live: true },
  { icon: 'brain', pain: '매번 취향 다시 물어보기', solve: '취향 자동 기억 — 지난 모임 조건을 그대로 불러오기', live: false },
  { icon: 'megaphone', pain: '공지 쓰고 리마인드 노동', solve: '공지·참석 마감 자동 — 가요/못가요 수합 + 마감 알림', live: false },
  { icon: 'target', pain: '"네가 고른 데 별로였어" 결정 책임', solve: '"MINT가 골랐어요" — 데이터 근거 카드로 책임 분산', live: true },
];

export default function TreasurerPlanSheet({ frame, onClose }: { frame: PlanFrame; onClose: () => void }) {
  const [prereg, setPrereg] = useState(() => isPreregistered());
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
    trackEvent('plan_detail_view', { device_id: getDeviceId(), frame });
  }, [frame]);

  function close() {
    const dwell = Math.round((Date.now() - openedAt.current) / 1000);
    if (!prereg) trackEvent('plan_detail_close', { device_id: getDeviceId(), frame, dwell_seconds: dwell });
    onClose();
  }

  function preregister(withEmail: boolean) {
    const dwell = Math.round((Date.now() - openedAt.current) / 1000);
    const mail = withEmail ? email.trim() : '';
    trackEvent('plan_preregister', {
      device_id: getDeviceId(), frame, dwell_seconds: dwell,
      ...(mail ? { email: mail } : {}),
    });
    markPreregistered();
    setPrereg(true);
    setShowEmail(false);
  }

  const priceHero = frame === 'monthly'
    ? { big: '월 4,900원', sub: '커피 한 잔 값으로 장소 독박 탈출' }
    : { big: '인당 약 600원', sub: '8명 기준 · 모임 공금에서 1차 소주 반 병 값' };

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={close}>
      <div
        className="fixed inset-x-0 bottom-0 z-50 max-w-md mx-auto bg-mint-50 rounded-t-3xl max-h-[85dvh] flex flex-col animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <span className="text-xs font-black bg-amber-100 text-amber-700 px-3 py-1 rounded-full">총무 플랜</span>
          <button onClick={close} className="text-gray-400 text-sm font-bold px-2 active:scale-95">닫기</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* 히어로 — 포지셔닝 한 줄 */}
          <div className="pt-1 pb-4">
            <h2 className="text-[22px] font-black text-gray-900 leading-snug break-keep">
              정산은 모임통장이 해요.<br />
              그럼 <span className="text-mint-600">장소</span>는 누가 정하죠?
            </h2>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed break-keep">
              — 아직도 총무님이잖아요. MINT가 그 '장소 독박'을 대신 풀어드릴게요.
            </p>
          </div>

          {/* 섹션 1 — 공감(독박의 해부) */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-3">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">총무님이 매번 받는 메시지</p>
            <div className="flex flex-col gap-2">
              {['어디로 가요?', '저 매운 거 못 먹는데…', '거기 웨이팅 있대요?', '다시 정하면 안 돼요?'].map((m) => (
                <div key={m} className="self-start bg-[#F1F3F5] text-gray-700 text-sm rounded-2xl rounded-tl-sm px-3.5 py-2">{m}</div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">이 질문들… 익숙하시죠?</p>
          </div>

          {/* 섹션 2 — MINT가 대신 하는 일 */}
          <p className="text-[11px] font-bold text-mint-600 uppercase tracking-widest px-1 mb-2">MINT가 대신 하는 일</p>
          <div className="flex flex-col gap-2 mb-4">
            {DOISS.map((d) => (
              <div key={d.pain} className="bg-white rounded-2xl border border-gray-100 p-3.5">
                <div className="flex items-start gap-3">
                  <Icon name={d.icon} className="text-xl mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 line-through decoration-gray-300">{d.pain}</p>
                    <p className="text-sm font-bold text-gray-800 leading-snug mt-0.5 break-keep">{d.solve}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-full ${
                    d.live ? 'bg-mint-100 text-mint-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {d.live ? '지금도 돼요' : '플랜에서 열려요'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 섹션 3 — 가격 */}
          <div className="bg-gradient-to-br from-mint-500 to-mint-600 rounded-2xl p-5 text-white text-center mb-3">
            <p className="text-3xl font-black">{priceHero.big}</p>
            <p className="text-sm opacity-90 mt-1 break-keep">{priceHero.sub}</p>
          </div>
          <p className="text-[11px] text-gray-400 text-center mb-4">아직 결제되지 않아요 · 출시 준비 중이에요</p>
        </div>

        {/* 하단 고정 CTA */}
        <div className="shrink-0 px-5 pt-3 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] bg-white border-t border-gray-100">
          {prereg ? (
            <div className="text-center py-2">
              <p className="text-sm font-black text-mint-600">✓ 사전등록 완료!</p>
              <p className="text-xs text-gray-400 mt-0.5">출시되면 제일 먼저 알려드릴게요.</p>
            </div>
          ) : showEmail ? (
            <div className="flex flex-col gap-2">
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일 (얼리버드 혜택용 · 선택)"
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 bg-white text-sm outline-none focus:border-mint-500"
              />
              <p className="text-[10px] text-gray-400 px-1 -mt-0.5">출시 알림 용도로만 써요</p>
              <div className="flex gap-2">
                <button onClick={() => preregister(false)} className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-500 font-bold text-sm active:scale-95 transition-transform">
                  건너뛰기
                </button>
                <button
                  onClick={() => preregister(true)}
                  disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
                  className={`flex-1 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 ${
                    /^\S+@\S+\.\S+$/.test(email.trim()) ? 'bg-mint-500 text-white' : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  등록
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowEmail(true)}
              className="w-full py-4 rounded-2xl bg-mint-500 text-white font-black text-base shadow-lg shadow-mint-500/30 active:scale-95 transition-transform"
            >
              출시되면 제일 먼저 알려주세요<Icon name="bell" className="ml-1" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
