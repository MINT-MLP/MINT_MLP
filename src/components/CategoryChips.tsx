import { useEffect, useMemo, useState } from 'react';
import { fetchPlaceCategories, categoriesForPurpose, categoryPath, type PlaceCategory } from '@/services/placeCategories';

interface Props {
  purpose: '밥' | '술' | '카페';
  value: string | null;                    // "한식 > 국밥" 같은 경로. null이면 전체
  onChange: (path: string | null) => void;
  color: 'mint' | 'orange';
}

// 카테고리 칩 — 단계별로 좁혀 간다. 1단계(한식·일식…) → 2단계(국밥·냉면…) → 3단계(게,대게…).
// 값은 경로 문자열이고 서버는 접두어 일치로 거른다. 안 고르면 목적만으로 추천(지금까지와 동일).
// 목록은 서버 place_category(카카오 분류 실측, 브랜드 제외)에서 온다.
export default function CategoryChips({ purpose, value, onChange, color }: Props) {
  const [all, setAll] = useState<PlaceCategory[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchPlaceCategories().then((c) => { if (alive) setAll(c); });
    return () => { alive = false; };
  }, []);

  const pool = useMemo(() => (all ? categoriesForPurpose(all, purpose) : []), [all, purpose]);
  const segs = value ? value.split(' > ').map((s) => s.trim()) : [];

  // 각 단계의 선택지: 앞 단계 선택과 접두어가 맞는 행들의 그 단계 값(중복 제거, 빈 값 제외)
  const optionsAt = (depth: 0 | 1 | 2): string[] => {
    const key = (['depth2', 'depth3', 'depth4'] as const)[depth];
    const rows = pool.filter((c) =>
      (depth < 1 || c.depth2 === segs[0]) && (depth < 2 || c.depth3 === segs[1]));
    return [...new Set(rows.map((c) => c[key]).filter(Boolean))];
  };

  const levels: { depth: 0 | 1 | 2; options: string[]; selected: string | undefined }[] = [];
  for (const depth of [0, 1, 2] as const) {
    if (depth > 0 && !segs[depth - 1]) break;
    const options = optionsAt(depth);
    if (options.length === 0) break;
    // 선택지가 하나뿐이면(카페 → 카페) 그 단계는 자동 선택하고 보여주지 않는다
    if (options.length === 1 && !segs[depth]) {
      segs[depth] = options[0];
      continue;
    }
    levels.push({ depth, options, selected: segs[depth] });
  }

  const pick = (depth: number, option: string | null) => {
    const next = segs.slice(0, depth);
    if (option) next.push(option);
    // 자동 선택된 단일 단계는 경로에 남긴다(서버 판정에 필요)
    onChange(next.length ? categoryPath(next[0], next[1], next[2]) : null);
  };

  if (!all) return null;
  if (levels.length === 0) return null;

  const isMint = color === 'mint';
  const on = isMint ? 'bg-mint-100 border-mint-500/60 text-mint-600' : 'bg-orange-50 border-orange-300 text-orange-500';
  const off = 'bg-white border-gray-200 text-gray-600 hover:border-gray-300';

  return (
    <div className="mt-2.5 flex flex-col gap-2 animate-fade-in-up">
      {levels.map(({ depth, options, selected }) => (
        <div key={depth} className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => pick(depth, null)}
            aria-pressed={!selected}
            className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all active:scale-95 ${!selected ? on : off}`}
          >
            전체
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick(depth, selected === opt ? null : opt)}
              aria-pressed={selected === opt}
              className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all active:scale-95 ${selected === opt ? on : off}`}
            >
              {opt.replace(/,/g, '·')}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
