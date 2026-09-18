import { useState } from 'react';

// 키워드 태그 입력 — Enter/완료로 #태그 커밋, 여러 개. 1차/2차 분리가 사라져 색상 분기도 없앴다.
export default function VibeKeywordTagInput({
  keywords,
  onChange,
  placeholder,
}: {
  keywords: string[];
  onChange: (k: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState('');

  function commit() {
    const t = text.trim().slice(0, 20);
    if (!t) { setText(''); return; }
    if (keywords.includes(t)) { setText(''); return; }
    onChange([...keywords, t]);
    setText('');
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          onBlur={commit}
          placeholder={placeholder}
          maxLength={20}
          className="flex-1 min-w-0 border-2 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none bg-white transition-colors border-[#3CDBC0]/50 focus:border-[#3CDBC0]"
        />
        <button
          onClick={commit}
          className="flex-shrink-0 px-4 rounded-xl text-white text-sm font-bold transition-all active:scale-95 bg-[#3CDBC0] hover:bg-[#2AB5A0]"
        >
          추가
        </button>
      </div>
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2.5">
          {keywords.map((k) => (
            <button
              key={k}
              onClick={() => onChange(keywords.filter((x) => x !== k))}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border text-xs font-bold transition-all active:scale-95 border-[#3CDBC0]/50 text-[#2AB5A0]"
            >
              <span>#{k}</span>
              <span className="opacity-60">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
