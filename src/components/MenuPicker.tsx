import { useId, useState } from 'react';
import { PICK_TONE, type PickCourse } from '@/constants/colors';
import { cn } from '@/utils/cn';
import { Icon } from '@/components/icons';

// 메뉴 콕 입력. 여러 개면 메뉴마다 다른 집, "회&초밥"처럼 &로 묶으면 한 집에서 같이 파는 곳.
const MENU_MAX = 4;
const MENU_MAXLEN = 20;
const SUGGEST: Record<PickCourse, string[]> = {
  first: ['국밥', '냉면', '초밥', '돈까스', '양꼬치', '떡볶이', '피자', '햄버거'],
  second: ['치킨&맥주', '하이볼', '막걸리', '와인', '곱창', '디저트'],
};

// 입력 연결자(+, /, ＆ 등)를 &로 통일하고 각 파트 공백을 정리해 "회&초밥" 형태로 표준화
function normalizeMenu(raw: string): string {
  return raw
    .replace(/[＋+／/＆]/g, '&')
    .split('&')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('&')
    .slice(0, MENU_MAXLEN);
}

interface Props {
  course: PickCourse;
  menus: string[];
  onChange: (menus: string[]) => void;
}

export default function MenuPicker({ course, menus, onChange }: Props) {
  const [text, setText] = useState('');
  const inputId = useId();
  const tone = PICK_TONE[course];
  const full = menus.length >= MENU_MAX;

  function add(raw: string) {
    const m = normalizeMenu(raw);
    setText('');
    if (!m || full || menus.includes(m)) return;
    onChange([...menus, m]);
  }

  const suggest = SUGGEST[course].filter((s) => !menus.includes(s));

  return (
    <div className="mt-2.5 flex flex-col gap-3 rounded-2xl border-2 border-gray-200 bg-white p-3.5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-bold text-gray-600">먹고 싶은 메뉴</label>
        <span className="text-xs font-bold text-gray-500">{menus.length} / {MENU_MAX}</span>
      </div>

      {!full && (
        <div className="flex gap-2">
          <input
            id={inputId}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(text); } }}
            onBlur={() => { if (text.trim()) add(text); }}
            placeholder={menus.length ? '메뉴 더 입력' : course === 'first' ? '예: 보쌈, 회&초밥' : '예: 하이볼, 치킨&맥주'}
            maxLength={MENU_MAXLEN}
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-gray-200 px-3 text-sm font-bold text-gray-800 outline-none transition-colors placeholder:font-medium placeholder:text-gray-400 focus:border-mint-500"
          />
          <button
            type="button"
            onClick={() => add(text)}
            className="h-11 flex-shrink-0 rounded-xl bg-mint-500 px-4 text-[13px] font-bold text-white transition-all hover:bg-mint-600 active:scale-95"
          >
            추가
          </button>
        </div>
      )}

      {menus.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {menus.map((m) => (
            <span
              key={m}
              className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] pl-3.5 pr-1 text-[13px] font-bold', tone.chip)}
            >
              <span>{m.replace(/&/g, ' & ')}</span>
              {m.includes('&') && (
                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', tone.badge)}>한 집에서</span>
              )}
              <button
                type="button"
                onClick={() => onChange(menus.filter((x) => x !== m))}
                aria-label={`${m} 지우기`}
                className="flex h-7 w-7 items-center justify-center"
              >
                <Icon name="close" className="text-sm" strokeWidth={2.4} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
        <p>메뉴를 여러 개 넣으면 <span className="font-bold text-gray-800">메뉴마다 다른 집</span>을 찾아요.</p>
        <p>
          <span className="font-bold text-mint-800">&amp;</span>로 묶으면 <span className="font-bold text-gray-800">한 집에서 같이</span> 파는 곳을 찾아요. 예: 회&amp;초밥
        </p>
      </div>

      {!full && suggest.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-gray-500">이런 메뉴도 있어요</span>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
            {suggest.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="flex min-h-9 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] border-dashed border-gray-300 bg-white px-3 text-[13px] font-bold text-gray-700 active:scale-95"
              >
                <Icon name="plus" className="text-xs" strokeWidth={2.4} />
                <span>{s.replace(/&/g, ' & ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
