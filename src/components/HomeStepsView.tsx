import StepProgress from '@/components/StepProgress';
import LocationInput from '@/components/LocationInput';
import PurposeSelect from '@/components/PurposeSelect';
import VibeSelect from '@/components/VibeSelect';
import MeetingLocationSelect from '@/components/MeetingLocationSelect';
import GroupWaiting from '@/components/GroupWaiting';
import type { OccChip } from '@/types';
import { VIBE_KEY_TO_LABEL } from '@/constants/vibeOptions';
import { OCCASION_BY_RELATION, OCCASION_PREVIEW } from '@/constants/occasion';
import { cancelGroupSessionOnServer } from '@/services/session';
import { GROUP_SESSION_KEY } from '@/utils/history';
import type { RecommendFlow, RecommendInput, GroupSession, RequestState, GroupActions, RecommendActions, StepNavigation } from '@/hooks';

// 입력 플로우(스텝 0~3) 화면. Home이 훅 결과 객체를 그대로 넘기고, 여기서 같은 이름으로 풀어 쓴다 — JSX는 분리 전 Home과 동일.
export default function HomeStepsView({ flow, input, group, request, groupActions, actions, nav }: {
  flow: RecommendFlow; input: RecommendInput; group: GroupSession; request: RequestState;
  groupActions: GroupActions; actions: RecommendActions; nav: StepNavigation;
}) {
  const { appMode, setAppMode, step, isGroup, showVibeScrollHint, stepScrollRef } = flow;
  const {
    groupSize, setGroupSize, customOccasion, setCustomOccasion, etcRelOpen, setEtcRelOpen, occasionChip, setOccasionChip,
    locations, setLocations, purpose, setPurpose, vibe, setVibe, budget, setBudget, meetingLocation, setMeetingLocation,
    keywords, setKeywords, conditions, setConditions, excludeFoods, setExcludeFoods,
  } = input;
  const { sessionId, setSessionId, expectedCount, setExpectedCount, groupMembers, setGroupMembers, pendingGroupRecommend, creatingSession, groupError, setGroupError, copied } = group;
  const { loading, error, lastRecommendRef } = request;
  const { groupShareLink, handleCopyLink, handleShareGroupLink, requestGroupRecommend, handleCreateSession } = groupActions;
  const { handleConfirmMeetingLocation } = actions;
  const { canNext, canJumpTo, handleStepJump, handleNext, handleBack } = nav;

  return (
    <div
      className="bg-[#F5FBF8] overflow-hidden"
      style={{
        // 높이는 스텝과 무관하게 항상 동일. step 0→1에서 탭바가 사라져도 컨테이너가
        // 재계산되지 않아 콘텐츠가 튀지 않는다(탭바 자리는 아래 padding-bottom이 흡수).
        height: 'var(--mint-app-height, 100dvh)',
      }}
    >
      {/* step 0(탭바 보임)에서만 AppShell 탭바와 동일한 계산식으로 하단을 padding으로 비워둔다. */}
      <div
        className={`h-full max-w-md mx-auto flex flex-col ${
          step === 0 ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : ''
        }`}
      >

        {/* 헤더 — 노치/상단 안전영역 반영(인앱·일반 세로모드에선 16px 그대로).
            결과 화면 헤더와 같은 문법: 높이 h-10, 소형 텍스트 버튼, 로고 절대 중앙 정렬.
            좌측 버튼은 step에 따라 역할이 다르다 — step 0(모드 선택)에서만 "← 홈"으로 랜딩페이지에 나가고,
            step 1~3에서는 "← 뒤로"로 이전 단계로만 간다(하단 "← 이전 단계"와 같은 handleBack).
            중간 단계에서 홈을 누르면 랜딩으로 튕겨 입력 흐름이 끊기던 문제를 막는다.
            중앙 로고는 어느 step에서든 step 0으로 되감기(step 0에선 no-op) — 좌측은 한 단계, 로고는 끝까지. */}
        <div className="flex-shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="relative -mx-2 flex h-10 items-center justify-center">
            <button
              onClick={step === 0 ? () => { window.location.href = '/'; } : handleBack}
              className="absolute left-0 top-1/2 -translate-y-1/2 flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:text-[#2AB5A0]"
              aria-label={step === 0 ? '홈으로 가기' : '뒤로 가기'}
            >
              <span aria-hidden>←</span>
              <span>{step === 0 ? '홈' : '뒤로'}</span>
            </button>
            <h1
              className="text-2xl font-black text-[#2AB5A0] tracking-tight cursor-pointer select-none"
              onClick={() => handleStepJump(0)}
            >
              MINT
            </h1>
          </div>
        </div>

        {/* 스텝 프로그레스 — 전 화면 4단계 고정 (그룹은 라벨만 교체) */}
        <div className="flex-shrink-0">
          <StepProgress
            current={step}
            total={4}
            labels={isGroup ? ['코스', '지역', '공유', '확정'] : undefined}
            onStepClick={handleStepJump}
            isStepClickable={canJumpTo}
          />
        </div>

        {/* 스텝 제목 */}
        <div className="flex-shrink-0 text-center px-5 pt-2 pb-0">
          <h2 className="text-xl font-black text-gray-800">
            {step === 0 && (isGroup ? '무슨 코스로 모일까요?' : '어떤 모임인가요?')}
            {step === 1 && (isGroup ? '어디서 만날까요?' : '누구와 함께하나요?')}
            {step === 2 && (isGroup ? '친구들을 초대하세요' : '어디서 만날까요?')}
            {step === 3 && (isGroup ? '다 모였어요!' : '원하는 분위기를 골라봐요')}
          </h2>
          {step === 1 && !isGroup && (
            <p className="text-xs text-gray-400 mt-1">모두 선택사항 · 선택할수록 추천이 정확해져요</p>
          )}
          {step === 1 && isGroup && (
            <p className="text-xs text-gray-400 mt-1">중간지점 자동 · 또는 만날 동네 직접 선택</p>
          )}
          {step === 2 && !isGroup && (
            <p className="text-xs text-gray-400 mt-1">원하는 동네 선택 · 또는 중간지점을 AI에게 맡겨요</p>
          )}
          {step === 2 && isGroup && (
            <p className="text-xs text-gray-400 mt-1">링크를 공유하고 각자 입력을 기다려요</p>
          )}
          {step === 3 && !isGroup && (
            <p className="text-xs text-gray-400 mt-1">프리셋으로 빠르게 고르거나, 직접 취향대로 골라보세요</p>
          )}
          {step === 3 && isGroup && (
            <p className="text-xs text-gray-400 mt-1">모두의 취향이 모였어요 · 추천을 받아보세요</p>
          )}
        </div>

        {/* 콘텐츠 — 짧은 스텝은 세로 중앙정렬(빈 공간 제거), 길면 정상 스크롤 */}
        <div className="relative flex-1 min-h-0">
          <div ref={stepScrollRef} key={step} className="h-full overflow-y-auto animate-fade-in-up">
            <div className="min-h-full flex flex-col justify-center">

          {/* Step 0: 모임 유형 선택 */}
          {step === 0 && (
            <div className="px-5 py-3 flex flex-col gap-4">
              {/* 혼자 / 그룹 선택 버튼 */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  // 혼자 모드로 전환하면 그룹 세션을 확인 없이 버린다 → 서버에도 알려 옛 링크를 죽인다.
                  // (알리지 않으면 이미 공유된 링크가 계속 살아 있고, 그 링크로 제출한 게스트는 결과를 영원히 기다린다)
                  onClick={() => { if (sessionId) cancelGroupSessionOnServer(sessionId); setAppMode('solo'); setSessionId(null); setGroupMembers([]); setGroupError(null); try { localStorage.removeItem(GROUP_SESSION_KEY); } catch { /* ignore */ } }}
                  aria-pressed={appMode === 'solo'}
                  className={`flex flex-col items-center justify-center gap-0.5 py-3 rounded-2xl border transition-all active:scale-[0.97] ${
                    appMode === 'solo'
                      ? 'border-[#3CDBC0] bg-[#E8F8F5]'
                      : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'
                  }`}
                >
                  <span className="text-lg">🙋</span>
                  <span className={`text-[13px] font-black ${appMode === 'solo' ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>혼자 정할게요</span>
                  <span className="text-[10px] text-gray-400">내가 직접 입력</span>
                </button>
                <button
                  onClick={() => { if (appMode !== 'group') setAppMode('group'); }}
                  aria-pressed={isGroup}
                  className={`flex flex-col items-center justify-center gap-0.5 py-3 rounded-2xl border transition-all active:scale-[0.97] ${
                    isGroup
                      ? 'border-[#3CDBC0] bg-[#E8F8F5]'
                      : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'
                  }`}
                >
                  <span className="text-lg">👥</span>
                  <span className={`text-[13px] font-black ${isGroup ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>다같이 정할게요</span>
                  <span className="text-[10px] text-gray-400">링크로 친구 취향 모으기 →</span>
                </button>
              </div>

              {/* 다같이 선택 시 미리보기 한 줄 — 진행 전에 그룹 모드가 어떻게 돌아가는지 체감시켜 진입률↑ */}
              {isGroup && (
                <p className="text-xs text-[#2AB5A0] bg-[#E8F8F5] border border-[#3CDBC0]/30 rounded-xl px-3 py-2.5 leading-relaxed animate-fade-in-up break-keep">
                  💡 링크만 공유하면 친구들은 <strong className="font-black">가입 없이 분위기만 30초</strong>. 결과는 단톡방으로 와요!
                </p>
              )}

              {/* Solo: 인원수 + 목적 */}
              {appMode === 'solo' && (
                <>
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">모임 인원수</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(['2명', '3~4명', '5명 이상'] as const).map((size) => (
                        <button
                          key={size}
                          onClick={() => setGroupSize(size)}
                          aria-pressed={groupSize === size}
                          className={`flex items-center justify-center h-10 rounded-xl border text-sm font-bold transition-all active:scale-[0.97] ${
                            groupSize === size
                              ? 'border-[#3CDBC0] bg-[#E8F8F5] text-[#2AB5A0]'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-[#3CDBC0]/50'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PurposeSelect
                    value={purpose ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null }}
                    onChange={setPurpose}
                  />
                </>
              )}

              {/* Group: 참여 인원수 + 코스(목적) — 호스트가 여기서 코스를 선점 */}
              {isGroup && (
                <>
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">참여 인원수 (호스트 포함)</p>
                    <div className="grid grid-cols-5 gap-2">
                      {[2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          onClick={() => setExpectedCount(n)}
                          className={`flex items-center justify-center h-10 rounded-xl border text-sm font-black transition-all active:scale-[0.97] ${
                            expectedCount === n
                              ? 'border-[#3CDBC0] bg-[#E8F8F5] text-[#2AB5A0]'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-[#3CDBC0]/50'
                          }`}
                        >
                          {n === 6 ? '6+' : n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PurposeSelect
                    value={purpose ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null }}
                    onChange={setPurpose}
                  />
                </>
              )}
            </div>
          )}

          {/* Step 1 (그룹): 만날 지역 — 중간지점 자동 or 임의 지역. 출발지는 게스트가 각자 입력 */}
          {step === 1 && isGroup && (
            <div className="pb-4">
              <MeetingLocationSelect value={meetingLocation} onSelect={setMeetingLocation} />
              <p className="px-5 -mt-1 text-xs text-gray-400 leading-relaxed">
                {meetingLocation?.type === 'auto'
                  ? '참여자들이 각자 출발지를 입력하면 전원 기준 중간지점을 계산해요.'
                  : meetingLocation?.type === 'manual'
                    ? '참여자는 출발지 없이 분위기만 고르면 돼요.'
                    : '중간지점을 맡기거나, 만날 동네를 직접 골라주세요.'}
              </p>
            </div>
          )}

          {/* Step 1 (혼자): 오늘 모임 성격 — 한 줄 4개 (친목/데이트/가족/기타 콕!) */}
          {step === 1 && !isGroup && (() => {
            // relation 값은 recommend.ts의 키워드 매핑과 호환되게 매핑(연인·가족은 전용 키워드 있음)
            const REL_OPTIONS = [
              { key: '친목', relation: '친구들', emoji: '🍻' },
              { key: '데이트', relation: '연인', emoji: '💑' },
              { key: '가족', relation: '가족', emoji: '👨‍👩‍👧' },
            ];
            const curRelation = purpose?.relation ?? null;
            const occChips = curRelation ? (OCCASION_BY_RELATION[curRelation] ?? []) : [];
            const previewHint = occasionChip
              ? (OCCASION_PREVIEW[OCCASION_BY_RELATION[curRelation ?? '']?.find((c) => c.key === occasionChip)?.occasion ?? ''] ?? null)
              : null;
            function pickRel(relation: string) {
              setEtcRelOpen(false);
              setCustomOccasion('');
              setOccasionChip(null); // 관계가 바뀌면 2층 선택 초기화
              setPurpose((prev) => {
                const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                // 같은 걸 다시 누르면 해제
                const next = base.relation === relation ? null : relation;
                return { ...base, relation: next, occasion: null };
              });
            }
            // 스텝2 2층 — '특별한 날' 칩. 같은 칩 재클릭 시 해제. occasion 값은 recommend.ts 키에 매핑.
            function pickOccasion(chip: OccChip) {
              setOccasionChip((cur) => {
                const isOff = cur === chip.key;
                setPurpose((prev) => {
                  const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                  return { ...base, occasion: isOff ? null : chip.occasion };
                });
                return isOff ? null : chip.key;
              });
            }
            function openEtc() {
              setEtcRelOpen(true);
              setOccasionChip(null);
              setPurpose((prev) => {
                const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                return { ...base, relation: null };
              });
            }
            // 기타 콕! 자유 입력 — 메뉴 콕과 동일하게 사용자가 직접 상황을 적어 추천에 반영(occasion으로 전달)
            function handleEtcText(text: string) {
              setCustomOccasion(text);
              setPurpose((prev) => {
                const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                return { ...base, occasion: text.trim() ? text : null };
              });
            }
            return (
              <div className="px-5 flex flex-col gap-3 pt-3 pb-4">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">오늘 모임은?</p>
                <div className="grid grid-cols-4 gap-2">
                  {REL_OPTIONS.map((opt) => {
                    const selected = !etcRelOpen && curRelation === opt.relation;
                    return (
                      <button key={opt.key} onClick={() => pickRel(opt.relation)}
                        className={`flex flex-col items-center justify-center gap-1 h-[72px] rounded-2xl border transition-all active:scale-[0.97] ${selected ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'}`}>
                        <span className="text-xl leading-none">{opt.emoji}</span>
                        <span className={`text-xs font-bold leading-none ${selected ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>{opt.key}</span>
                      </button>
                    );
                  })}
                  <button onClick={openEtc}
                    className={`flex flex-col items-center justify-center gap-1 h-[72px] rounded-2xl border transition-all active:scale-[0.97] ${etcRelOpen ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'}`}>
                    <span className="text-xl leading-none">🎯</span>
                    <span className={`text-xs font-bold leading-none ${etcRelOpen ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>기타 콕!</span>
                  </button>
                </div>

                {/* 2층 — 관계를 고르면 문맥형 '특별한 날' 칩이 부드럽게 등장(선택사항) */}
                {occChips.length > 0 && !etcRelOpen && (
                  <div className="animate-fade-in-up flex flex-col gap-2 pt-1">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">오늘 좀 특별해요?</p>
                    <div className="grid grid-cols-4 gap-2">
                      {occChips.map((chip) => {
                        const on = occasionChip === chip.key;
                        return (
                          <button key={chip.key} onClick={() => pickOccasion(chip)}
                            className={`flex flex-col items-center justify-center gap-1 h-[64px] rounded-2xl border transition-all active:scale-[0.97] ${on ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'}`}>
                            <span className="text-lg leading-none">{chip.emoji}</span>
                            <span className={`text-[11px] font-bold leading-none text-center px-0.5 ${on ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>{chip.key}</span>
                          </button>
                        );
                      })}
                    </div>
                    {/* 살아있는 미리보기 — 선택 효과를 즉시 보여줌(입력 부담 0) */}
                    {previewHint && (
                      <div className="animate-fade-in-up flex items-center gap-1.5 rounded-xl bg-[#E8F8F5] px-3 py-2 mt-0.5">
                        <span className="text-sm">✨</span>
                        <span className="text-[12px] font-medium text-[#2AB5A0] leading-snug">{previewHint}</span>
                      </div>
                    )}
                  </div>
                )}

                {etcRelOpen && (
                  <div className="animate-fade-in-up">
                    <input
                      type="text"
                      autoFocus
                      value={customOccasion}
                      onChange={(e) => handleEtcText(e.target.value)}
                      placeholder="🔎 상황을 직접 적어요 (예: 회식, 상견례, 생일, 졸업)"
                      className={`w-full border rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#3CDBC0] transition-colors ${
                        customOccasion.trim() ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200'
                      }`}
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5">적은 상황을 반영해 분위기·메뉴를 맞춰 추천해요</p>
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-1">모두 선택사항 · 고를수록 추천이 정확해져요</p>
              </div>
            );
          })()}

          {/* Step 2 (혼자): 만날 장소 선택 */}
          {step === 2 && !isGroup && (
            <div className="pb-4 flex flex-col gap-3">
              <MeetingLocationSelect value={meetingLocation} onSelect={setMeetingLocation} />

              {/* 중간지점(자동) 모드: 출발지 입력 */}
              {meetingLocation?.type === 'auto' && (
                <div className="animate-fade-in-up border-t border-gray-100 pt-2 px-5">
                  <LocationInput locations={locations} onChange={setLocations} />
                </div>
              )}
            </div>
          )}

          {/* Step 2 (그룹): 링크 생성 → 공유 → 실시간 참여 현황 */}
          {step === 2 && isGroup && (
            <div className="px-5 py-3">
              {!sessionId ? (
                <div className="flex flex-col gap-4">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
                    <div className="text-3xl mb-2">🔗</div>
                    <p className="font-black text-gray-800 mb-1">참여 링크를 만들어요</p>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      친구들은 가입 없이 링크만 열면 분위기만 고르면 끝.<br />
                      코스·지역은 이미 골라뒀으니 링크에 담겨 전달돼요.
                    </p>
                  </div>
                  {groupError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 text-center">{groupError}</div>
                  )}
                  <button
                    onClick={handleCreateSession}
                    disabled={creatingSession}
                    className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${
                      creatingSession
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-[#3CDBC0] text-white shadow-lg shadow-[#3CDBC0]/30 hover:bg-[#2AB5A0]'
                    }`}
                  >
                    {creatingSession ? '생성 중...' : '링크 생성하기 →'}
                  </button>
                </div>
              ) : (
                <GroupWaiting
                  shareLink={groupShareLink()}
                  copied={copied}
                  onCopy={handleCopyLink}
                  onKakaoShare={handleShareGroupLink}
                  onRecommend={requestGroupRecommend}
                  members={groupMembers}
                  expectedCount={expectedCount}
                  canRecommend={canNext()}
                  recommending={pendingGroupRecommend || loading}
                />
              )}
            </div>
          )}

          {/* Step 3 (혼자): 분위기 */}
          {step === 3 && !isGroup && (
            <VibeSelect
              value={vibe}
              onChange={setVibe}
              purpose={purpose ? { first: purpose.first, second: purpose.second } : undefined}
              budget={budget}
              onBudgetChange={setBudget}
              keywords={keywords}
              onKeywordsChange={setKeywords}
              conditions={conditions}
              onConditionsChange={setConditions}
              excludeFoods={excludeFoods}
              onExcludeFoodsChange={setExcludeFoods}
            />
          )}

          {/* Step 3 (그룹): 확정 요약 */}
          {step === 3 && isGroup && (
            <div className="px-5 py-3 flex flex-col gap-3">
              <div className="bg-white rounded-2xl border border-[#3CDBC0]/30 shadow-sm p-5">
                <p className="text-[10px] font-bold text-[#2AB5A0] uppercase tracking-widest mb-3">모임 요약</p>
                <div className="flex flex-col gap-2.5 text-sm">
                  <div className="flex gap-2"><span className="text-gray-400 w-12 flex-shrink-0">코스</span>
                    <span className="font-bold text-gray-800">🍀 {purpose?.first ?? '-'}{purpose?.firstGenre ? `(${purpose.firstGenre})` : ''}{purpose?.second && purpose.second !== '없음' ? ` → ${purpose.second}${purpose?.secondGenre ? `(${purpose.secondGenre})` : ''}` : ''}</span>
                  </div>
                  <div className="flex gap-2"><span className="text-gray-400 w-12 flex-shrink-0">지역</span>
                    <span className="font-bold text-gray-800">📍 {meetingLocation?.type === 'auto' ? '중간지점 자동' : meetingLocation?.type === 'manual' ? meetingLocation.area : '-'}</span>
                  </div>
                  <div className="flex gap-2"><span className="text-gray-400 w-12 flex-shrink-0">인원</span>
                    <span className="font-bold text-gray-800">👥 {groupMembers.length}명 참여</span>
                  </div>
                </div>
              </div>

              {/* 모인 취향 */}
              {(() => {
                const vibeLabels = [...Object.values(vibe).flatMap((g) => [...g.first, ...g.second]), ...conditions].map((k) => VIBE_KEY_TO_LABEL[k] ?? k);
                if (vibeLabels.length === 0 && !budget && keywords.length === 0 && excludeFoods.length === 0) return null;
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <p className="text-[10px] font-bold text-[#2AB5A0] uppercase tracking-widest mb-2.5">모두의 취향 (자동 종합)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {vibeLabels.map((l) => <span key={l} className="bg-[#E8F8F5] text-[#2AB5A0] text-xs font-bold px-2.5 py-1 rounded-full">{l}</span>)}
                      {budget && <span className="bg-[#E8F8F5] text-[#2AB5A0] text-xs font-bold px-2.5 py-1 rounded-full">💰 {budget}</span>}
                      {keywords.map((k) => <span key={k} className="bg-[#E8F8F5] text-[#2AB5A0] text-xs font-bold px-2.5 py-1 rounded-full">{k}</span>)}
                      {excludeFoods.map((f) => <span key={f} className="bg-red-50 text-red-500 text-xs font-bold px-2.5 py-1 rounded-full">🚫 {f}</span>)}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
            </div>
          </div>

          {showVibeScrollHint && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-[#F5FBF8] via-[#F5FBF8]/95 to-transparent px-5 pb-2 pt-9">
              <button
                type="button"
                onClick={() => stepScrollRef.current?.scrollBy({ top: 240, behavior: 'smooth' })}
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#3CDBC0]/35 bg-white/95 px-4 py-2 text-xs font-bold text-[#2AB5A0] shadow-lg shadow-[#2AB5A0]/15 backdrop-blur"
              >
                키워드·못 먹는 음식도 더 있어요
                <span className="animate-bounce text-sm leading-none" aria-hidden>↓</span>
              </button>
            </div>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div className="flex-shrink-0 mx-5 mb-2 p-3.5 bg-red-50 border border-red-200 rounded-xl text-center">
            <p className="text-sm text-red-600 leading-snug">{error}</p>
            <p className="mt-1 text-[11px] text-gray-500">입력하신 조건은 그대로 있어요.</p>
            {lastRecommendRef.current && (
              <button
                onClick={() => lastRecommendRef.current?.()}
                className="mt-2.5 w-full py-2.5 rounded-xl bg-[#3CDBC0] text-white text-sm font-black active:scale-95 transition-transform hover:bg-[#2AB5A0]"
              >
                🔄 다시 시도
              </button>
            )}
          </div>
        )}

        {/* 하단 버튼 — 홈 인디케이터/네이티브 툴바와 겹치지 않게 안전영역 반영
            (카톡 인앱 env=0 → 32px 그대로, 일반 브라우저에서만 더 벌어짐) */}
        <div className={`flex-shrink-0 px-5 pt-2 flex flex-col gap-2 ${step === 0 ? 'pb-3' : 'pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))]'}`}>
          {step < 3 ? (
            <>
              <div className="flex gap-3">
                {step > 0 && (
                  <button
                    onClick={handleBack}
                    className="w-[92px] py-4 rounded-2xl border border-gray-200 bg-white text-gray-500 font-bold text-sm hover:border-gray-300 transition-all active:scale-95"
                  >
                    ← 이전 단계
                  </button>
                )}
                <button
                  onClick={handleNext}
                  disabled={!canNext()}
                  className={`flex-1 py-4 rounded-2xl font-black text-base transition-all duration-300 active:scale-95 ${
                    canNext()
                      ? 'bg-[#3CDBC0] text-white shadow-lg shadow-[#3CDBC0]/30 hover:bg-[#2AB5A0]'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {step === 2 && isGroup && sessionId ? `${groupMembers.length}명으로 추천받기` : '다음'}
                </button>
              </div>
              {!canNext() && (
                <p className="text-xs text-gray-400 text-center">
                  {step === 0 && appMode === 'mode-select' && '혼자 정하기 또는 다같이 정하기를 선택해주세요'}
                  {step === 0 && appMode === 'solo' && '1차 목적을 선택해주세요'}
                  {step === 0 && isGroup && '참여 인원과 1차 코스를 골라주세요'}
                  {step === 1 && isGroup && '만날 지역을 선택해주세요'}
                  {step === 2 && isGroup && !sessionId && '링크를 생성해 친구들에게 공유해주세요'}
                  {step === 2 && isGroup && sessionId && `2명 이상 입력하면 추천으로 진행할 수 있어요 (현재 ${groupMembers.length}명)`}
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-gray-400">
                {purpose?.second && purpose.second !== '없음'
                  ? '추천 결과에서 1차 다른 후보와 2차 코스까지 함께 확인할 수 있어요'
                  : '추천 결과에서 1차 다른 후보도 함께 확인할 수 있어요'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="w-[92px] py-4 rounded-2xl border border-gray-200 bg-white text-gray-500 font-bold text-sm hover:border-gray-300 transition-all active:scale-95"
                >
                  ← 이전 단계
                </button>
                <button
                  onClick={() => {
                    if (meetingLocation) handleConfirmMeetingLocation(meetingLocation);
                  }}
                  className="flex-1 py-4 rounded-2xl font-black text-base bg-[#3CDBC0] text-white shadow-lg shadow-[#3CDBC0]/30 hover:bg-[#2AB5A0] transition-all active:scale-95"
                >
                  ✨ 장소 추천받기
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
