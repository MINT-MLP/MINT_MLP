import { useState } from 'react';
import type { PurposeValue } from '@/types';
import CategoryPicker from '@/components/CategoryPicker';
import MenuPicker from '@/components/MenuPicker';
import { PICK_TONE, type PickCourse } from '@/constants/colors';
import { cn } from '@/utils/cn';
import { Icon, type IconName } from '@/components/icons';

interface Props {
  value: PurposeValue;
  onChange: (v: PurposeValue) => void;
}

type Raw = '밥' | '술' | '카페' | '기타';

// 밥/술/카페 = "검색어 없이 아무거나 추천받고 싶은 사람" / 메뉴 콕 = "특정 메뉴가 있는 사람"
const OPTIONS: { value: Raw; label: string; sub: string }[] = [
  { value: '밥', label: '밥', sub: 'AI 추천' },
  { value: '술', label: '술', sub: 'AI 추천' },
  { value: '카페', label: '카페', sub: 'AI 추천' },
  { value: '기타', label: '메뉴 콕', sub: '직접 입력' },
];

const PURPOSE_ICON: Record<Raw, IconName> = { '밥': 'meal', '술': 'drink', '카페': 'cafe', '기타': 'target' };

function splitMenus(s: string | null | undefined): string[] {
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
}

export default function PurposeSelect({ value, onChange }: Props) {
  // 메뉴 콕(기타) 모드일 때 first/second에 쉼표로 저장된 메뉴들
  const firstMenus = value.firstRaw === '기타' ? splitMenus(value.first) : [];
  const secondMenus = value.secondRaw === '기타' ? splitMenus(value.second) : [];
  // 다른 목적으로 넘어갔다 돌아왔을 때 되살릴 메뉴. 추천에는 지금 선택된 목적의 값만 간다.
  const [menuDraft, setMenuDraft] = useState<{ first: string[]; second: string[] }>({ first: firstMenus, second: secondMenus });

  function selectFirst(opt: Raw) {
    if (value.firstRaw === '기타' && opt !== '기타') setMenuDraft((d) => ({ ...d, first: firstMenus }));
    if (opt === '기타') {
      const restore = firstMenus.length ? firstMenus : menuDraft.first;
      onChange({ ...value, first: restore.length ? restore.join(',') : null, firstRaw: '기타', firstGenre: null });
    } else {
      onChange({ ...value, first: opt, firstRaw: opt, firstGenre: null });
    }
  }

  function selectSecond(opt: Raw | '없음') {
    if (value.secondRaw === '기타' && opt !== '기타') setMenuDraft((d) => ({ ...d, second: secondMenus }));
    if (opt === '없음') {
      onChange({ ...value, second: '없음', secondRaw: '없음', secondGenre: null });
    } else if (opt === '기타') {
      const restore = secondMenus.length ? secondMenus : menuDraft.second;
      onChange({ ...value, second: restore.length ? restore.join(',') : null, secondRaw: '기타', secondGenre: null });
    } else {
      onChange({ ...value, second: opt, secondRaw: opt, secondGenre: null });
    }
  }

  const isNoneSelected = value.secondRaw === '없음' || value.secondRaw === null;

  const purposeGrid = (course: PickCourse, selectedRaw: string | null, pick: (o: Raw) => void) => (
    <div className="grid grid-cols-4 gap-2">
      {OPTIONS.map((opt) => {
        const selected = selectedRaw === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => pick(opt.value)}
            aria-pressed={selected}
            className={cn(
              'flex h-[76px] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 transition-all duration-200',
              selected ? PICK_TONE[course].card : PICK_TONE.off.card,
            )}
          >
            <Icon name={PURPOSE_ICON[opt.value]} className="text-[22px]" />
            <span className="text-[13px] font-bold leading-tight">{opt.label}</span>
            <span className={cn('text-[10px] font-medium leading-none', selected ? 'opacity-80' : 'text-gray-500')}>{opt.sub}</span>
          </button>
        );
      })}
    </div>
  );

  // 부모(Home step0)가 이미 px-4를 주므로 여기선 좌우 패딩을 두지 않는다
  return (
    <div className="py-1 flex flex-col gap-6">
      {/* 1차 목적 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">1차 목적</p>
          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">필수</span>
        </div>
        {purposeGrid('first', value.firstRaw, selectFirst)}

        {(value.firstRaw === '밥' || value.firstRaw === '술' || value.firstRaw === '카페') && (
          <CategoryPicker
            key={`first-${value.firstRaw}`}
            purpose={value.firstRaw}
            course="first"
            value={value.firstGenre ?? null}
            onChange={(p) => onChange({ ...value, firstGenre: p })}
          />
        )}

        {value.firstRaw === '기타' && (
          <MenuPicker
            course="first"
            menus={firstMenus}
            onChange={(m) => onChange({ ...value, first: m.length ? m.join(',') : null })}
          />
        )}
      </div>

      {/* 2차 목적 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">2차 목적</p>
          <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full font-medium">선택사항</span>
        </div>
        {purposeGrid('second', value.secondRaw, selectSecond)}

        {(value.secondRaw === '밥' || value.secondRaw === '술' || value.secondRaw === '카페') && (
          <CategoryPicker
            key={`second-${value.secondRaw}`}
            purpose={value.secondRaw}
            course="second"
            value={value.secondGenre ?? null}
            onChange={(p) => onChange({ ...value, secondGenre: p })}
          />
        )}

        {value.secondRaw === '기타' && (
          <MenuPicker
            course="second"
            menus={secondMenus}
            onChange={(m) => onChange({ ...value, second: m.length ? m.join(',') : null })}
          />
        )}

        {/* 없음 — 풀너비, 기본 선택 */}
        <button
          type="button"
          onClick={() => selectSecond('없음')}
          aria-pressed={isNoneSelected}
          className={cn(
            'mt-2.5 w-full py-3.5 rounded-2xl border-2 text-sm font-bold transition-all duration-200',
            isNoneSelected ? PICK_TONE.first.card : PICK_TONE.off.card,
          )}
        >
          2차 없음
        </button>
      </div>
    </div>
  );
}
