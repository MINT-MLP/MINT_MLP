import { useRef, useState } from 'react';
import type { VibeState, GroupVibeState, PurposeCtx, VibePreset } from '@/types';
import { GROUPS, CONDITION_OPTIONS, VIBE_PRESETS, RECOMMENDED_KEYWORDS, MAX_PER_COURSE, BUDGET_OPTIONS } from '@/constants/vibeOptions';
import { orderByPurpose, orderConditionsByPurpose, orderKeywordsByPurpose } from '@/utils/vibeOrder';
import VibeKeywordTagInput from '@/components/VibeKeywordTagInput';
import { Icon } from '@/components/icons';

// 코스별로 여러 개 고를 수 있다. 예전엔 슬롯 2칸이라 3번째를 누르면 첫 선택이 말없이 밀려났다.

interface Props {
  value: VibeState;
  onChange: (v: VibeState) => void;
  purpose?: PurposeCtx;
  budget?: string | null;
  onBudgetChange?: (b: string | null) => void;
  keywords?: string[];              // 통합 키워드 — 1차/2차 분리 폐지
  onKeywordsChange?: (k: string[]) => void;
  conditions?: string[];            // 시설형 조건(코스 무관 전역)
  onConditionsChange?: (c: string[]) => void;
  // 'all'(기본)=전체 한 화면 / 'mood'=프리셋·분위기·취향·조건만 / 'extras'=예산·키워드만
  // 그룹 참여(MemberInput)에서 취향을 2개 스텝으로 나눠 4단계로 맞추기 위한 스위치
  section?: 'all' | 'mood' | 'extras';
}

export default function VibeSelect({
  value, onChange, purpose,
  budget = null, onBudgetChange,
  keywords = [], onKeywordsChange,
  conditions = [], onConditionsChange,
  section = 'all',
}: Props) {
  const showMood = section === 'all' || section === 'mood';
  const showExtras = section === 'all' || section === 'extras';
  const hasSecond = !!(purpose?.second && purpose.second !== '없음');

  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(() => {
    const hasAny = (g?: GroupVibeState) => !!g && (g.first.length > 0 || g.second.length > 0);
    return hasAny(value['분위기']) || hasAny(value['취향']);
  });
  const [conditionsOpen, setConditionsOpen] = useState(() => conditions.length > 0);
  const [courseTab, setCourseTab] = useState<'first' | 'second'>('first');
  const [capMsg, setCapMsg] = useState<string | null>(null);
  const capTimerRef = useRef<number | undefined>(undefined);

  // 2차 코스가 사라지면 탭 상태와 무관하게 1차로 본다. effect로 되돌리면 한 렌더 동안
  // 보이지도 않는 2차 슬롯에 선택이 쌓일 수 있어, 상태를 맞추지 않고 파생시킨다.
  const activeCourse: 'first' | 'second' = hasSecond ? courseTab : 'first';

  function setCourseArray(g: GroupVibeState, course: 'first' | 'second', next: string[]): GroupVibeState {
    return course === 'first' ? { ...g, first: next } : { ...g, second: next };
  }

  // 상한을 넘겨 누르면 짧게 알려준다 — 조용히 씹히면 사용자는 앱이 고장난 줄 안다
  function showCap(groupLabel: string) {
    setCapMsg(`${groupLabel}는 한 코스에 최대 ${MAX_PER_COURSE}개까지 고를 수 있어요`);
    if (capTimerRef.current) window.clearTimeout(capTimerRef.current);
    capTimerRef.current = window.setTimeout(() => setCapMsg(null), 1800);
  }

  // 어느 코스를 편집 중인지는 세그먼트가 정한다 — 칩은 단순히 켜고 끈다.
  function toggle(groupLabel: string, key: string) {
    setActivePreset(null); // 수동으로 손대면 프리셋 하이라이트만 푼다(칩 선택은 유지)
    const g = value[groupLabel] ?? { first: [], second: [] };
    const arr = g[activeCourse];
    if (arr.includes(key)) {
      onChange({ ...value, [groupLabel]: setCourseArray(g, activeCourse, arr.filter((k) => k !== key)) });
      return;
    }
    if (arr.length >= MAX_PER_COURSE) { showCap(groupLabel); return; }
    onChange({ ...value, [groupLabel]: setCourseArray(g, activeCourse, [...arr, key]) });
  }

  // 조건은 코스 구분 없는 전역 다중선택 — 풀이 6개뿐이라 상한을 두지 않는다
  function toggleCondition(key: string) {
    if (!onConditionsChange) return;
    setActivePreset(null);
    onConditionsChange(conditions.includes(key) ? conditions.filter((k) => k !== key) : [...conditions, key]);
  }

  function applyPreset(preset: VibePreset) {
    const moodG = value['분위기'] ?? { first: [], second: [] };
    const prefG = value['취향'] ?? { first: [], second: [] };
    if (activePreset === preset.id) {
      // 같은 프리셋 재탭 = 해제. 여기 도달했다는 건 아직 수동으로 안 건드렸다는 뜻이라 비워도 안전하다.
      onChange({
        ...value,
        분위기: setCourseArray(moodG, activeCourse, []),
        취향: setCourseArray(prefG, activeCourse, []),
      });
      onConditionsChange?.([]);
      setActivePreset(null);
      return;
    }
    // 프리셋끼리는 합치지 않고 갈아치운다 — 조용하게+시끌벅적 같은 모순 조합을 막는다
    onChange({
      ...value,
      분위기: setCourseArray(moodG, activeCourse, [...preset.mood]),
      취향: setCourseArray(prefG, activeCourse, [...preset.pref]),
    });
    onConditionsChange?.([...preset.conditions]);
    setActivePreset(preset.id);
    setManualOpen(true);
    if (preset.conditions.length > 0) setConditionsOpen(true);
  }

  const otherCourse: 'first' | 'second' = activeCourse === 'first' ? 'second' : 'first';

  return (
    <div className="px-4 pt-3 pb-6 flex flex-col gap-5">
      {showMood && (
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2"><Icon name="sparkle" className="mr-1" />무드 프리셋</p>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            {VIBE_PRESETS.map((preset) => {
              const on = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  aria-pressed={on}
                  className={`flex flex-col items-start gap-0.5 rounded-2xl border-2 p-3 text-left transition-all duration-200 active:scale-[0.97] ${
                    on ? 'border-mint-500 bg-mint-100 shadow-sm shadow-mint-500/20' : 'border-gray-200 bg-white hover:border-mint-500/50'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon name={preset.icon} className="text-base" />
                    <span className={`text-sm font-black break-keep ${on ? 'text-mint-600' : 'text-gray-800'}`}>{preset.title}</span>
                  </span>
                  <span className={`text-[11px] leading-snug break-keep ${on ? 'text-mint-600/70' : 'text-gray-400'}`}>{preset.desc}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setManualOpen((o) => !o)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-gray-400 hover:text-mint-600 transition-colors"
          >
            <span>{manualOpen ? '접기' : '직접 골라볼까요?'}</span>
            <span className={`inline-block transition-transform duration-200 ${manualOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>

          {manualOpen && (
            <div className="flex flex-col gap-5 mt-3">
              {/* 1차/2차를 칩에서 떼어내 세그먼트로 — 칩 하나가 4상태였을 땐 배너로 설명해야 했다 */}
              {hasSecond && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setCourseTab('first')}
                    aria-pressed={activeCourse === 'first'}
                    className={`h-10 rounded-xl text-xs font-black transition-all active:scale-[0.97] ${
                      activeCourse === 'first' ? 'bg-mint-600 text-white shadow-sm' : 'bg-white border-2 border-gray-200 text-gray-500'
                    }`}
                  >
                    <Icon name="clover" className="mr-1" />1차{purpose?.first ? ` · ${purpose.first}` : ''}
                  </button>
                  <button
                    onClick={() => setCourseTab('second')}
                    aria-pressed={activeCourse === 'second'}
                    className={`h-10 rounded-xl text-xs font-black transition-all active:scale-[0.97] ${
                      activeCourse === 'second' ? 'bg-orange-400 text-white shadow-sm' : 'bg-white border-2 border-gray-200 text-gray-500'
                    }`}
                  >
                    <Icon name="flame" className="mr-1" />2차{purpose?.second ? ` · ${purpose.second}` : ''}
                  </button>
                </div>
              )}

              {GROUPS.map((group) => {
                const g = value[group.label] ?? { first: [], second: [] };
                return (
                  <div key={group.label}>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">{group.label}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {orderByPurpose(group.options, purpose).map((opt) => {
                        const inActive = g[activeCourse].includes(opt.key);
                        const inOther = hasSecond && g[otherCourse].includes(opt.key);
                        return (
                          <button
                            key={opt.key}
                            onClick={() => toggle(group.label, opt.key)}
                            aria-pressed={inActive}
                            aria-label={`${opt.label}${inActive ? ' (선택됨)' : ''}${inOther ? (otherCourse === 'first' ? ' (1차에도 선택됨)' : ' (2차에도 선택됨)') : ''}`}
                            className={`relative flex h-10 items-center justify-center gap-1 rounded-full border-2 px-1 text-xs font-bold whitespace-nowrap transition-all duration-200 active:scale-95 ${
                              inActive
                                ? activeCourse === 'first'
                                  ? 'border-mint-500 bg-mint-100 text-mint-600 shadow-sm shadow-mint-500/20'
                                  : 'border-orange-400 bg-orange-50 text-orange-500 shadow-sm shadow-orange-200/50'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-mint-500/50'
                            }`}
                          >
                            {/* 다른 코스에 이미 골라둔 칩 — 탭을 옮기지 않아도 보이게 */}
                            {inOther && (
                              <span className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                                activeCourse === 'first' ? 'bg-orange-400' : 'bg-mint-500'
                              }`} />
                            )}
                            <Icon name={opt.icon} className="text-sm" />
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    {capMsg?.startsWith(group.label) && (
                      <p className="text-[11px] text-orange-500 font-bold mt-1.5">{capMsg}</p>
                    )}
                  </div>
                );
              })}

              {onConditionsChange && (
                <div>
                  <button
                    onClick={() => setConditionsOpen((o) => !o)}
                    className="w-full flex items-center justify-between py-1 text-xs font-bold text-gray-400 hover:text-mint-600 transition-colors"
                  >
                    <span>조건 추가{conditions.length > 0 ? ` (${conditions.length})` : ''}</span>
                    <span className={`inline-block transition-transform duration-200 ${conditionsOpen ? 'rotate-180' : ''}`}>▾</span>
                  </button>
                  {conditionsOpen && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {orderConditionsByPurpose(CONDITION_OPTIONS, purpose).map((opt) => {
                        const active = conditions.includes(opt.key);
                        return (
                          <button
                            key={opt.key}
                            onClick={() => toggleCondition(opt.key)}
                            aria-pressed={active}
                            className={`flex h-10 items-center justify-center gap-1 rounded-full border-2 px-1 text-xs font-bold whitespace-nowrap transition-all duration-200 active:scale-95 ${
                              active
                                ? 'border-mint-500 bg-mint-100 text-mint-600 shadow-sm shadow-mint-500/20'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-mint-500/50'
                            }`}
                          >
                            <Icon name={opt.icon} className="text-sm" />
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 예산 — 1인 기준. 서버가 검색 키워드에 '가성비/고급' 프리픽스 + AI 예산 제약으로 반영 */}
      {showExtras && onBudgetChange && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest"><Icon name="wallet" className="mr-1" />예산</p>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">1인 기준 · 선택사항</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {BUDGET_OPTIONS.map((opt) => {
              const isActive = budget === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => onBudgetChange(isActive ? null : opt.value)}
                  aria-pressed={isActive}
                  className={`flex flex-col items-center justify-center h-16 rounded-xl border-2 text-xs font-bold transition-all duration-200 active:scale-[0.97] ${
                    isActive
                      ? 'border-mint-500 bg-mint-100 text-mint-600 shadow-md shadow-mint-500/20'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-mint-500/50'
                  }`}
                >
                  <Icon name={opt.icon} className="text-lg mb-0.5" />
                  <span>{opt.label}</span>
                  <span className={`text-[9px] font-medium ${isActive ? 'text-mint-600/70' : 'text-gray-400'}`}>{opt.sub}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 키워드 — 추천 칩을 앞에 둬서 타이핑 없이 끝낼 수 있게. 자유 입력은 탈출구로 아래에 남긴다 */}
      {showExtras && onKeywordsChange && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
          <p className="text-sm font-bold text-gray-700 mb-1 break-keep"><Icon name="search" className="mr-1" />더 필요한 조건 추가</p>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed break-keep">추천 칩을 탭하거나, 없으면 직접 입력하세요</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {orderKeywordsByPurpose(RECOMMENDED_KEYWORDS, purpose).map((kw) => {
              const active = keywords.includes(kw);
              return (
                <button
                  key={kw}
                  onClick={() => onKeywordsChange(active ? keywords.filter((k) => k !== kw) : [...keywords, kw])}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 border ${
                    active ? 'bg-mint-100 border-mint-500 text-mint-600' : 'bg-white border-gray-200 text-gray-600 hover:border-mint-500/50'
                  }`}
                >
                  {active ? '✓ ' : '+ '}{kw}
                </button>
              );
            })}
          </div>
          <VibeKeywordTagInput
            keywords={keywords}
            onChange={onKeywordsChange}
            placeholder="키워드 입력 후 Enter (여러 개)"
          />
        </div>
      )}
    </div>
  );
}
