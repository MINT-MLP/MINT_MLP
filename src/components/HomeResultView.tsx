import StepProgress from '@/components/StepProgress';
import ResultCard from '@/components/ResultCard';
import RetryWeightModal from '@/components/RetryWeightModal';
import PointsBadge from '@/components/PointsBadge';
import WishlistSheet from '@/components/WishlistSheet';
import type { PlaceRecommendation } from '@/types';
import { VIBE_KEY_TO_LABEL } from '@/constants/vibeOptions';
import type { RecommendFlow, RecommendInput, ResultState, RecommendActions, StepNavigation } from '@/hooks';

// 추천 결과 화면. Home이 훅 결과 객체를 그대로 넘기고, 여기서 같은 이름으로 풀어 쓴다 — JSX는 분리 전 Home과 동일.
export default function HomeResultView({ result, flow, input, resultState, actions, nav, onShare, onFullReset }: {
  result: PlaceRecommendation[];
  flow: RecommendFlow; input: RecommendInput; resultState: ResultState; actions: RecommendActions; nav: StepNavigation;
  onShare: () => void; onFullReset: () => void;
}) {
  const { setView, setStep, isGroup } = flow;
  const { meetingLocation, purpose, vibe, conditions, keywords, excludeFoods, budget } = input;
  const {
    showRetryModal, setShowRetryModal, midpointData, resultTravelTimes, treasurer, pointsBalance, setPointsBalance,
    showWishlist, setShowWishlist, resultWeather, resultThird, resultThirdLabel, changeNote, setChangeNote,
    compromiseMessage, showCompromiseToast, showResultScrollHint,
  } = resultState;
  const { handleRetry, handleAdjust, handleReject, handleRetryWithWeights } = actions;
  const { handleStepJump, canJumpTo } = nav;
  const handleShare = onShare;
  const handleFullReset = onFullReset;

  return (
      <div className="min-h-screen bg-mint-50">
        {/* 중간 지점 보완 토스트 */}
        {compromiseMessage && (
          <div className={`fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm transition-all duration-500 ${showCompromiseToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
            <div className="bg-mint-800 text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-lg flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">📍</span>
              <span className="leading-snug">{compromiseMessage}</span>
            </div>
          </div>
        )}
        <div className="max-w-md mx-auto px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
          {/* 헤더 3요소: 좌 '조건 수정'(값 유지), 중앙 브랜드 마크(클릭 불가), 우 '처음부터'(확인 후 전체 초기화).
              입력 단계 헤더와 동일 문법: 높이 h-10, 좌우는 같은 소형 텍스트 버튼, 로고는 절대 중앙 정렬.
              -mx-2로 버튼 내부 px-2를 상쇄해 글자 시작선을 콘텐츠 px-5에 맞춘다. */}
          <div className="relative -mx-2 flex h-10 items-center justify-between mb-1">
            <button
              onClick={() => {
                // 결과에서 조건 수정 = 바로 이전 입력 화면(마지막 스텝)으로. 입력값은 그대로 유지해 바로 수정·재추천 가능.
                setChangeNote(null);
                setView('steps');
                setStep(3);
              }}
              className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:text-mint-600"
            >
              ← 조건 수정
            </button>
            {/* 로고 = 랜딩페이지로 탈출. 좌우 버튼 폭과 무관하게 절대 중앙 정렬. */}
            <button
              onClick={() => { window.location.href = '/'; }}
              aria-label="MINT 홈으로"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-mint-600 font-black text-2xl tracking-tight select-none active:scale-95 transition-transform"
            >
              MINT
            </button>
            <button
              onClick={handleFullReset}
              className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:text-mint-600"
              title="처음부터 다시 (입력·결과 초기화)"
            >
              ↺ 처음부터
            </button>
          </div>

          {/* 포인트·찜 바 — 방문 인증 적립 잔액 + 내 찜 목록 진입 */}
          <div className="flex items-center justify-end gap-2 mb-1.5">
            <button
              onClick={() => setShowWishlist(true)}
              aria-label="내 찜 목록"
              className="flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2.5 py-1.5 text-xs font-black text-gray-500 active:scale-95 transition-transform"
            >
              <span className="text-sm leading-none">🤍</span>찜
            </button>
            <PointsBadge balance={pointsBalance} />
          </div>

          {/* 상단 단계바 — 결과 화면에서도 특정 단계를 눌러 바로 수정하러 갈 수 있게(값 유지). */}
          <StepProgress
            current={4}
            total={4}
            labels={isGroup ? ['코스', '지역', '공유', '확정'] : undefined}
            onStepClick={handleStepJump}
            isStepClickable={canJumpTo}
          />

          {/* 날씨 반영 배너 — "모든 변수 반영"을 유저가 체감하게 */}
          {resultWeather && (resultWeather.isRainy || resultWeather.isHot || resultWeather.isCold) && (
            <div className="mb-2 bg-white border border-gray-100 rounded-2xl px-4 py-2.5 flex items-center gap-2 shadow-sm animate-fade-in-up">
              <span className="text-base leading-none">
                {resultWeather.isRainy ? '☔' : resultWeather.isHot ? '🥵' : '🥶'}
              </span>
              <p className="text-xs text-gray-600 leading-relaxed flex-1">
                {resultWeather.isRainy
                  ? `오늘 ${resultWeather.description} 소식이 있어 실내 위주로 골랐어요`
                  : resultWeather.isHot
                    ? `${resultWeather.temp}°C 더운 날씨라 시원한 실내 위주로 골랐어요`
                    : `${resultWeather.temp}°C 추운 날씨라 따뜻한 실내 위주로 골랐어요`}
              </p>
            </div>
          )}

          {/* 재추천 변경점 한 줄 — 이전 결과 대비 뭐가 달라졌는지 */}
          {changeNote && (
            <div className="mb-2 bg-mint-100 border border-mint-500/40 rounded-2xl px-4 py-2.5 flex items-start gap-2 animate-fade-in-up">
              <span className="text-base leading-none mt-0.5">🔁</span>
              <p className="text-xs text-mint-800 leading-relaxed flex-1">{changeNote}</p>
              <button
                onClick={() => setChangeNote(null)}
                className="text-mint-600/60 hover:text-mint-600 text-xs px-1"
              >
                ✕
              </button>
            </div>
          )}

          <ResultCard
            results={result}
            thirdResult={resultThird}
            thirdLabel={resultThirdLabel}
            travelTimes={resultTravelTimes}
            showTravelTime={meetingLocation?.type === 'auto'}
            midpointAreaName={midpointData?.areaName}
            purpose={purpose?.first ? { first: purpose.first, second: purpose.second ?? null } : undefined}
            vibeLabels={[...Object.values(vibe).flatMap((g) => [...g.first, ...g.second]), ...conditions].map((k) => VIBE_KEY_TO_LABEL[k] ?? k)}
            keywords={keywords}
            genreLabels={[purpose?.firstGenre, purpose?.secondGenre].filter((g): g is string => !!g)}
            excludeFoods={excludeFoods}
            treasurer={treasurer}
            onRetry={handleRetry}
            onAdjust={handleAdjust}
            onReserve={() => setView('reserve')}
            onReject={handleReject}
            onPointsChange={setPointsBalance}
          />

          {/* 하단 sticky 카톡 공유 바 — 유일한 공유 CTA. 결과 어디서든 한 탭(핵심 유입).
              콘텐츠 컨테이너 pb로 마지막 버튼(총무/예약)이 이 바에 가리지 않게 여백 확보됨. */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-100 bg-white/95 px-5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <div className="mx-auto max-w-md">
              <button
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-kakao text-gray-900 font-black text-base shadow-lg shadow-yellow-200/60 active:scale-95 transition-transform"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.08 2 11.1c0 3.13 1.73 5.9 4.35 7.57V22l3.97-2.18c1.06.29 2.18.44 3.33.44 5.52 0 10-4.08 10-9.1C23.65 6.08 17.52 2 12 2z" />
                </svg>
                카카오톡으로 공유하기
              </button>
            </div>
          </div>

          {showResultScrollHint && (
            <button
              type="button"
              onClick={() => window.scrollBy({ top: Math.max(320, window.innerHeight * 0.55), behavior: 'smooth' })}
              className="fixed bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-mint-500/35 bg-white/95 px-4 py-2.5 text-xs font-bold text-mint-600 shadow-xl shadow-mint-600/20 backdrop-blur"
            >
              {purpose?.second && purpose.second !== '없음'
                ? '아래에 다른 후보와 2차 코스도 있어요'
                : '아래에 다른 후보도 있어요'}
              <span className="animate-bounce text-sm leading-none" aria-hidden>↓</span>
            </button>
          )}

          {showRetryModal && (
            <RetryWeightModal
              vibe={vibe}
              budget={budget}
              onRetryWithWeights={handleRetryWithWeights}
              onClose={() => setShowRetryModal(false)}
            />
          )}

          {showWishlist && <WishlistSheet onClose={() => setShowWishlist(false)} />}
        </div>
      </div>
  );
}
