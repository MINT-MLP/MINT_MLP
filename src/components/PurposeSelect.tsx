import { useState } from 'react';
import type { PurposeValue } from '@/types';
import CategoryChips from '@/components/CategoryChips';

interface Props {
  value: PurposeValue;
  onChange: (v: PurposeValue) => void;
}

// 밥/술/카페 = "검색어 없이 아무거나 추천받고 싶은 사람" / 메뉴 콕 = "특정 메뉴가 있는 사람"
const OPTIONS: { value: '밥' | '술' | '카페' | '기타'; label: string; sub: string; emoji: string }[] = [
  { value: '밥', label: '밥', sub: 'AI 추천', emoji: '🍽️' },
  { value: '술', label: '술', sub: 'AI 추천', emoji: '🍻' },
  { value: '카페', label: '카페', sub: 'AI 추천', emoji: '☕' },
  { value: '기타', label: '메뉴 콕!', sub: '직접 입력', emoji: '🎯' },
];

export default function PurposeSelect({ value, onChange }: Props) {
  // 메뉴 콕(기타) 모드일 때 first/second에 쉼표로 저장된 메뉴들
  const firstMenus = value.firstRaw === '기타' && value.first ? value.first.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const secondMenus = value.secondRaw === '기타' && value.second ? value.second.split(',').map((s) => s.trim()).filter(Boolean) : [];

  function addFirstMenu(m: string) { onChange({ ...value, first: [...firstMenus, m].join(',') }); }
  function removeFirstMenu(m: string) { const r = firstMenus.filter((x) => x !== m); onChange({ ...value, first: r.length ? r.join(',') : null }); }
  function addSecondMenu(m: string) { onChange({ ...value, second: [...secondMenus, m].join(',') }); }
  function removeSecondMenu(m: string) { const r = secondMenus.filter((x) => x !== m); onChange({ ...value, second: r.length ? r.join(',') : null }); }

  function selectFirst(opt: '밥' | '술' | '카페' | '기타') {
    if (opt === '기타') {
      onChange({ ...value, first: firstMenus.length ? value.first : null, firstRaw: '기타', firstGenre: null });
    } else {
      onChange({ ...value, first: opt, firstRaw: opt, firstGenre: null });
    }
  }

  function selectSecond(opt: '밥' | '술' | '카페' | '기타' | '없음') {
    if (opt === '없음') {
      onChange({ ...value, second: '없음', secondRaw: '없음', secondGenre: null });
    } else if (opt === '기타') {
      onChange({ ...value, second: secondMenus.length ? value.second : null, secondRaw: '기타', secondGenre: null });
    } else {
      onChange({ ...value, second: opt, secondRaw: opt, secondGenre: null });
    }
  }

  const isNoneSelected = value.secondRaw === '없음' || value.secondRaw === null;

    // 부모(Home step0)가 이미 px-4를 주므로 여기선 좌우 패딩을 두지 않는다
    //  → 1차·2차 목적 UI가 위의 인원수·모드선택과 가로폭이 정확히 일치.
  return (
    <div className="py-1 flex flex-col gap-5">
      {/* 1차 목적 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">1차 목적</p>
          <span className="text-[10px] font-bold text-red-400 bg-red-50 px-2 py-0.5 rounded-full">필수</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {OPTIONS.map((opt) => {
            const selected = value.firstRaw === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => selectFirst(opt.value)}
                aria-pressed={selected}
                className={`flex flex-col items-center justify-center h-[72px] rounded-2xl border-2 transition-all duration-200 ${
                  selected
                    ? 'border-mint-500 bg-mint-100 shadow-md shadow-mint-500/20'
                    : 'border-gray-200 bg-white hover:border-mint-500/50'
                }`}
              >
                <span className="text-xl mb-0.5 leading-none">{opt.emoji}</span>
                <span className={`text-xs font-bold leading-none ${selected ? 'text-mint-600' : 'text-gray-700'}`}>{opt.label}</span>
                <span className={`text-[9px] mt-0.5 leading-none ${selected ? 'text-mint-600/70' : 'text-gray-400'}`}>{opt.sub}</span>
              </button>
            );
          })}
        </div>

        {/* 카테고리 좁히기(선택) — 밥/술/카페일 때만. 안 고르면 목적만으로 추천 */}
        {(value.firstRaw === '밥' || value.firstRaw === '술' || value.firstRaw === '카페') && (
          <CategoryChips
            purpose={value.firstRaw}
            value={value.firstGenre ?? null}
            onChange={(p) => onChange({ ...value, firstGenre: p })}
            color="mint"
          />
        )}

        {/* 메뉴 콕 모드: 세부 메뉴 태그 입력 */}
        {value.firstRaw === '기타' && (
          <div className="mt-2.5 animate-fade-in-up">
            <p className="text-[10px] text-gray-400 mb-1.5 break-keep">먹고 싶은 메뉴 입력 · 한 집에서 다 먹고 싶으면 <span className="font-bold text-mint-600">&amp;로 묶기</span>(예: 회&amp;초밥)</p>
            <MenuTagInput
              color="mint"
              menus={firstMenus}
              onAdd={addFirstMenu}
              onRemove={removeFirstMenu}
              placeholder="🔎 예: 보쌈 · 회&초밥 (입력 후 Enter)"
            />
          </div>
        )}
      </div>

      {/* 2차 목적 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">2차 목적</p>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">선택사항</span>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-2.5">
          {OPTIONS.map((opt) => {
            const selected = value.secondRaw === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => selectSecond(opt.value)}
                aria-pressed={selected}
                className={`flex flex-col items-center justify-center h-[72px] rounded-2xl border-2 transition-all duration-200 ${
                  selected
                    ? 'border-mint-500 bg-mint-100 shadow-md shadow-mint-500/20'
                    : 'border-gray-200 bg-white hover:border-mint-500/50'
                }`}
              >
                <span className="text-xl mb-0.5 leading-none">{opt.emoji}</span>
                <span className={`text-xs font-bold leading-none ${selected ? 'text-mint-600' : 'text-gray-700'}`}>{opt.label}</span>
                <span className={`text-[9px] mt-0.5 leading-none ${selected ? 'text-mint-600/70' : 'text-gray-400'}`}>{opt.sub}</span>
              </button>
            );
          })}
        </div>

        {(value.secondRaw === '밥' || value.secondRaw === '술' || value.secondRaw === '카페') && (
          <div className="mb-2.5">
            <CategoryChips
              purpose={value.secondRaw}
              value={value.secondGenre ?? null}
              onChange={(p) => onChange({ ...value, secondGenre: p })}
              color="orange"
            />
          </div>
        )}

        {/* 2차 메뉴 콕 모드 */}
        {value.secondRaw === '기타' && (
          <div className="mb-2.5 animate-fade-in-up">
            <p className="text-[10px] text-gray-400 mb-1.5 break-keep">2차로 먹고 싶은 메뉴 · 한 집에서 다면 <span className="font-bold text-orange-500">&amp;로 묶기</span>(예: 치킨&amp;맥주)</p>
            <MenuTagInput
              color="orange"
              menus={secondMenus}
              onAdd={addSecondMenu}
              onRemove={removeSecondMenu}
              placeholder="🔎 예: 하이볼 · 치킨&맥주 (입력 후 Enter)"
            />
          </div>
        )}

        {/* 없음 — 풀너비, 기본 선택 */}
        <button
          onClick={() => selectSecond('없음')}
          className={`w-full py-3.5 rounded-2xl border-2 text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
            isNoneSelected
              ? 'border-mint-500 bg-mint-100 text-mint-600 shadow-md shadow-mint-500/20'
              : 'border-gray-200 bg-white text-gray-600 hover:border-mint-500/50'
          }`}
        >
          <span>✋</span>
          <span>2차 없음</span>
        </button>
      </div>

    </div>
  );
}

// 세부 메뉴 태그 입력 — 키워드 UI와 동일. Enter/완료로 #태그 커밋, 여러 개(코스별 최대 4개).
// "회&초밥"처럼 &로 묶으면 한 집에서 함께 파는 곳을 원한다는 뜻(하나의 조합 태그).
const MENU_MAX = 4;
const MENU_MAXLEN = 20;
// 입력 연결자(+, /, ＆ 등)를 &로 통일하고 각 파트 공백을 정리해 "회&초밥" 형태로 표준화.
function normalizeMenu(raw: string): string {
  return raw
    .replace(/[＋+／/＆]/g, '&')
    .split('&')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('&')
    .slice(0, MENU_MAXLEN);
}
function MenuTagInput({
  color,
  menus,
  onAdd,
  onRemove,
  placeholder,
}: {
  color: 'mint' | 'orange';
  menus: string[];
  onAdd: (m: string) => void;
  onRemove: (m: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const isMint = color === 'mint';
  const full = menus.length >= MENU_MAX;

  function commit() {
    const t = normalizeMenu(text);
    if (!t) { setText(''); return; }
    if (menus.includes(t) || full) { setText(''); return; }
    onAdd(t);
    setText('');
  }

  return (
    <div>
      {!full && (
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            onBlur={commit}
            placeholder={menus.length >= 1 ? '＋ 메뉴 더 입력 후 Enter' : placeholder}
            maxLength={MENU_MAXLEN}
            className={`flex-1 min-w-0 border-2 rounded-xl px-3.5 py-2.5 text-xs font-bold placeholder:text-gray-400 placeholder:font-medium outline-none transition-colors ${
              isMint
                ? 'text-mint-600 border-gray-200 focus:border-mint-500'
                : 'text-orange-500 border-gray-200 focus:border-orange-300'
            }`}
          />
          <button
            onClick={commit}
            className={`flex-shrink-0 px-3.5 rounded-xl text-white text-xs font-bold transition-all active:scale-95 ${
              isMint ? 'bg-mint-500 hover:bg-mint-600' : 'bg-orange-400 hover:bg-orange-500'
            }`}
          >
            추가
          </button>
        </div>
      )}
      {menus.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {menus.map((m) => (
            <button
              key={m}
              onClick={() => onRemove(m)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-bold transition-all active:scale-95 ${
                isMint
                  ? 'bg-mint-100 border-mint-500/50 text-mint-600'
                  : 'bg-orange-50 border-orange-300 text-orange-500'
              }`}
            >
              <span>#{m}</span>
              <span className="opacity-60">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
