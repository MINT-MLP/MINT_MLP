import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { categoryLabel, categoryPath, type CategoryGroup } from '@/services/placeCategories';
import { PICK_TONE, type PickCourse } from '@/constants/colors';
import { cn } from '@/utils/cn';
import { Icon } from '@/components/icons';

interface Props {
  course: PickCourse;
  groups: CategoryGroup[];
  value: string | null;                 // "일식 > 일본식라면" / "일식" / null
  onApply: (path: string | null) => void;
  onClose: () => void;
}

// 밥 종류 2단 선택 시트 — 왼쪽 대분류, 오른쪽 세부. 고른 건 "적용"을 눌러야 반영된다.
export default function CategorySheet({ course, groups, value, onApply, onClose }: Props) {
  const [cur2, cur3, cur4] = value ? value.split(' > ').map((s) => s.trim()) : [];
  const [rail, setRail] = useState<string>(cur2 || groups[0]?.name || '');
  const [draft, setDraft] = useState<{ d2: string; d3: string; d4: string } | null>(cur2 ? { d2: cur2, d3: cur3 ?? '', d4: cur4 ?? '' } : null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const tone = PICK_TONE[course];
  const subs = groups.find((g) => g.name === rail)?.subs ?? [];
  // 한 줄씩: 대분류 전체 → 세부 → (있으면) 그 아래 항목을 들여써서
  const rows: { d3: string; d4: string; label: string; indent: boolean }[] = [{ d3: '', d4: '', label: `${rail} 전체`, indent: false }];
  for (const s of subs) {
    rows.push({ d3: s.name, d4: '', label: categoryLabel(s.name), indent: false });
    for (const c of s.children) rows.push({ d3: s.name, d4: c, label: categoryLabel(c), indent: true });
  }
  const draftLabel = draft ? (draft.d4 ? categoryLabel(draft.d4) : draft.d3 ? categoryLabel(draft.d3) : `${draft.d2} 전체`) : '';
  const applyLabel = draft ? `${draftLabel}로 찾기` : '종류를 골라 주세요';

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-gray-900/45" role="dialog" aria-modal="true" aria-label="종류 고르기">
      <button type="button" aria-label="닫기" onClick={onClose} className="flex-1" />
      <div className="mx-auto flex h-[min(560px,80dvh)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white animate-fade-in-up">
        <div className="flex items-center justify-between px-5 pb-3 pt-[18px]">
          <div className="flex flex-col gap-0.5">
            <span className={cn('text-xs font-bold', tone.text)}>{course === 'first' ? '1차' : '2차'} · 밥</span>
            <span className="text-lg font-black text-gray-800">종류 고르기</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-gray-700"
          >
            <Icon name="close" className="text-lg" strokeWidth={2} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[124px_minmax(0,1fr)] border-t border-gray-100">
          <div className="flex flex-col overflow-y-auto bg-mint-50">
            {groups.map((g) => {
              const on = rail === g.name;
              const picked = draft?.d2 === g.name;
              return (
                <button
                  key={g.name}
                  type="button"
                  onClick={() => setRail(g.name)}
                  aria-pressed={on}
                  className={cn(
                    'min-h-12 px-4 text-left text-sm',
                    on ? cn('bg-white font-black', tone.text) : picked ? cn('font-bold', tone.text) : 'font-medium text-gray-600',
                  )}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col overflow-y-auto px-4 py-2">
            {rows.map((r) => {
              const on = draft?.d2 === rail && draft.d3 === r.d3 && draft.d4 === r.d4;
              return (
                <button
                  key={`${r.d3}|${r.d4}`}
                  type="button"
                  onClick={() => setDraft({ d2: rail, d3: r.d3, d4: r.d4 })}
                  aria-pressed={on}
                  className={cn(
                    'flex items-center justify-between border-b border-gray-100 text-left',
                    r.indent ? 'min-h-11 pl-4 pr-1 text-[13px]' : 'min-h-12 px-1 text-sm',
                    on ? cn('font-black', tone.text) : r.indent ? 'font-medium text-gray-600' : r.d3 ? 'font-medium text-gray-800' : 'font-bold text-gray-800',
                  )}
                >
                  <span>{r.label}</span>
                  {on && (
                    <Icon name="check" className="text-lg" strokeWidth={2.4} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={() => onApply(null)}
            className="h-[52px] rounded-2xl border-2 border-gray-200 bg-white px-[18px] text-sm font-bold text-gray-700"
          >
            상관없음
          </button>
          <button
            type="button"
            disabled={!draft}
            onClick={() => draft && onApply(categoryPath(draft.d2, draft.d3, draft.d4))}
            className={cn('h-[52px] flex-1 rounded-2xl text-[15px] font-black disabled:opacity-50', tone.solid)}
          >
            {applyLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
