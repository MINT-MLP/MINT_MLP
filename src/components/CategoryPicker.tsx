import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchPlaceCategories, flatOptions, riceGroups, categoryLabel, QUICK_GROUPS, type PlaceCategory,
} from '@/services/placeCategories';
import { PICK_TONE, type PickCourse } from '@/constants/colors';
import { cn } from '@/utils/cn';
import CategorySheet from '@/components/CategorySheet';
import { Icon } from '@/components/icons';

interface Props {
  purpose: '밥' | '술' | '카페';
  course: PickCourse;
  value: string | null;                    // 분류 경로. null이면 상관없음
  onChange: (path: string | null) => void;
}

// 종류 고르기(선택사항). 자주 찾는 것만 한 줄로 보여주고, 밥의 세부 종류는 시트에서 고른다.
// 값은 서버가 접두어 일치로 거르는 경로 문자열. 안 고르면 목적만으로 추천한다.
export default function CategoryPicker({ purpose, course, value, onChange }: Props) {
  const [all, setAll] = useState<PlaceCategory[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchPlaceCategories().then((c) => { if (alive) setAll(c); });
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => (all && purpose === '밥' ? riceGroups(all) : []), [all, purpose]);
  const flat = useMemo(() => (all && purpose !== '밥' ? flatOptions(all, purpose) : []), [all, purpose]);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  if (!all) return null;
  if (purpose === '밥' ? groups.length === 0 : flat.length === 0) return null;

  const tone = PICK_TONE[course];
  const [d2, d3, d4] = value ? value.split(' > ').map((s) => s.trim()) : [];
  const chip = (on: boolean) => cn(
    'flex-shrink-0 min-h-9 rounded-full border-[1.5px] px-3.5 text-[13px] font-bold whitespace-nowrap transition-all active:scale-95',
    on ? tone.chip : PICK_TONE.off.chip,
  );

  // 밥: 자주 찾는 대분류 + 지금 고른 대분류(목록에 없으면 앞에 끼워 넣는다)
  const available = new Set(groups.map((g) => g.name));
  let quick = QUICK_GROUPS.filter((n) => available.has(n));
  if (d2 && purpose === '밥' && !quick.includes(d2)) quick = [d2, ...quick.slice(0, quick.length - 1)];
  const subs = groups.find((g) => g.name === d2)?.subs ?? [];

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-2xl border-2 border-gray-200 bg-white p-3.5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-gray-600">
          어떤 종류? <span className="font-medium text-gray-500">안 골라도 돼요</span>
        </span>
        {purpose === '밥' && (
          <button type="button" onClick={() => setSheetOpen(true)} className={cn('min-h-8 text-xs font-bold', tone.text)}>
            전체 보기
          </button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
        <button type="button" onClick={() => onChange(null)} aria-pressed={!value} className={chip(!value)}>
          상관없음
        </button>
        {purpose === '밥'
          ? quick.map((name) => {
              const on = d2 === name;
              return (
                <button key={name} type="button" onClick={() => onChange(on ? null : name)} aria-pressed={on} className={chip(on)}>
                  {name}
                </button>
              );
            })
          : flat.map((o) => {
              const on = value === o.path;
              return (
                <button key={o.path} type="button" onClick={() => onChange(on ? null : o.path)} aria-pressed={on} className={chip(on)}>
                  {o.label}
                </button>
              );
            })}
      </div>

      {purpose === '밥' && d2 && subs.length > 0 && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex min-h-11 w-full items-center justify-between rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-3 text-[13px] text-gray-700"
        >
          <span>
            <span className="font-bold">{d2}</span>{' '}
            <span className="text-gray-500">· {d4 ? `${categoryLabel(d3)} › ${categoryLabel(d4)}` : d3 ? categoryLabel(d3) : '세부 종류도 고를 수 있어요'}</span>
          </span>
          <Icon name="chevronRight" className="text-base" strokeWidth={2} />
        </button>
      )}

      {sheetOpen && (
        <CategorySheet
          course={course}
          groups={groups}
          value={value}
          onApply={(p) => { onChange(p); setSheetOpen(false); }}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
