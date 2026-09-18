import { useState } from 'react';
import type { VibeState } from '@/types';
import { VIBE_KEY_TO_LABEL } from '@/constants/vibeOptions';

export type VibeWeights = Record<string, number>;

interface Props {
  vibe: VibeState;
  budget: string | null;
  onRetryWithWeights: (weights: VibeWeights) => void;
  onClose: () => void;
}

const WEIGHT_LABELS: Record<number, string> = {
  1: '거의 무시',
  2: '낮음',
  3: '보통',
  4: '중요',
  5: '최우선',
};

// 재추천 조정에 자주 쓰는 키워드 (분위기/취향 옵션과 겹치지 않는 것들)
const PRESET_KEYWORDS = ['루프탑', '가성비', '노포 맛집', '주차 가능', '디저트', '룸/단체석'];

export default function RetryWeightModal({ vibe, budget, onRetryWithWeights, onClose }: Props) {
  const selectedVibes: { key: string; label: string }[] = [];
  Object.values(vibe).forEach((g) => {
    [...g.first, ...g.second].forEach((k) => {
      selectedVibes.push({ key: k, label: VIBE_KEY_TO_LABEL[k] ?? k });
    });
  });

  const initialWeights: VibeWeights = Object.fromEntries(selectedVibes.map((v) => [v.key, 3]));
  if (budget) initialWeights[`budget:${budget}`] = 3;

  const [weights, setWeights] = useState<VibeWeights>(initialWeights);
  const [keywordList, setKeywordList] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState('');

  function setWeight(key: string, val: number) {
    setWeights((prev) => ({ ...prev, [key]: val }));
  }

  const vibeLabelSet = new Set(selectedVibes.map((v) => v.label));

  function addKeyword(raw: string) {
    const t = raw.trim().slice(0, 20);
    if (!t || keywordList.includes(t) || vibeLabelSet.has(t)) { setKwInput(''); return; }
    setKeywordList((prev) => [...prev, t]);
    // 사용자가 직접 넣은 키워드는 기본 '중요(4)'로 시작
    setWeights((prev) => ({ ...prev, [t]: 4 }));
    setKwInput('');
  }

  function removeKeyword(kw: string) {
    setKeywordList((prev) => prev.filter((k) => k !== kw));
    setWeights((prev) => {
      const next = { ...prev };
      delete next[kw];
      return next;
    });
  }

  function togglePreset(kw: string) {
    if (keywordList.includes(kw)) removeKeyword(kw);
    else addKeyword(kw);
  }

  const hasSliders = selectedVibes.length > 0 || !!budget || keywordList.length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl px-5 pt-5 pb-10 max-h-[88vh] overflow-y-auto animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        <h3 className="text-base font-black text-gray-800 mb-0.5">취향 직접 조절하기</h3>
        <p className="text-xs text-gray-400 mb-5">슬라이더가 높을수록 AI가 더 우선해서 반영해요</p>

        {hasSliders && (
          <div className="flex flex-col gap-5 mb-6">
            {selectedVibes.map((v) => (
              <SliderRow
                key={v.key}
                label={v.label}
                value={weights[v.key] ?? 3}
                onChange={(val) => setWeight(v.key, val)}
              />
            ))}
            {budget && (
              <SliderRow
                label={`예산 ${budget}`}
                value={weights[`budget:${budget}`] ?? 3}
                onChange={(val) => setWeight(`budget:${budget}`, val)}
              />
            )}
            {keywordList.map((kw) => (
              <SliderRow
                key={kw}
                label={kw}
                badge="키워드"
                value={weights[kw] ?? 4}
                onChange={(val) => setWeight(kw, val)}
                onRemove={() => removeKeyword(kw)}
              />
            ))}
          </div>
        )}

        {/* 키워드 추가(검색) */}
        <div className="mb-6 border-t border-gray-100 pt-5">
          <div className="flex items-center gap-2 mb-2.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">＋ 키워드 추가</p>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">원하는 조건을 검색해 더해요</span>
          </div>

          {/* 검색 입력 */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={kwInput}
              maxLength={20}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(kwInput); } }}
              placeholder="예: 루프탑, 조용한, 노포..."
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-mint-500 transition-colors"
            />
            <button
              onClick={() => addKeyword(kwInput)}
              className="flex-shrink-0 px-4 rounded-xl bg-mint-500 text-white text-sm font-bold transition-all active:scale-95 hover:bg-mint-600"
            >
              추가
            </button>
          </div>

          {/* 프리셋 칩 */}
          <div className="flex flex-wrap gap-2">
            {PRESET_KEYWORDS.map((kw) => {
              const active = keywordList.includes(kw);
              return (
                <button
                  key={kw}
                  onClick={() => togglePreset(kw)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 border ${
                    active
                      ? 'bg-mint-100 border-mint-500 text-mint-600'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-mint-500/50'
                  }`}
                >
                  {active ? '✓ ' : '+ '}{kw}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => onRetryWithWeights(weights)}
          className="w-full py-4 rounded-2xl bg-mint-500 text-white font-black text-base shadow-lg shadow-mint-500/30 hover:bg-mint-600 transition-all active:scale-95"
        >
          이 조건으로 재추천받기
        </button>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  badge,
  onRemove,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  badge?: string;
  onRemove?: () => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-gray-700">{label}</span>
          {badge && <span className="text-[9px] font-black text-mint-600 bg-mint-100 px-1.5 py-0.5 rounded-full">{badge}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs font-black text-mint-600 bg-mint-100 px-2 py-0.5 rounded-full">
            {WEIGHT_LABELS[value]}
          </span>
          {onRemove && (
            <button onClick={onRemove} className="text-gray-300 hover:text-red-400 text-sm px-0.5" aria-label="키워드 삭제">×</button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer accent-mint-500"
      />
      <div className="flex justify-between text-[10px] text-gray-300 mt-1">
        <span>1</span>
        <span>2</span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
      </div>
    </div>
  );
}
