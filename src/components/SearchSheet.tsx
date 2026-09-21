import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 모바일 전체 화면 검색 시트. 좁은 화면에서 입력창 아래 드롭다운은 키보드에 가려지므로,
// 화면을 통째로 덮고 맨 위에 검색창, 그 아래를 결과 목록이 전부 쓰게 한다(카카오맵·배민의 주소 검색과 같은 형태).
//
// 닫힘 경로는 셋이고 전부 history를 통해 한 곳으로 모인다:
//   열릴 때 history에 표시 항목을 하나 push → 안드로이드 뒤로가기·ESC·상단 ← 버튼·open=false 전환 모두
//   history.back()으로 그 항목을 걷어내고, popstate에서 onClose를 부른다.
//   (App 라우터는 pathname만 보므로 같은 URL의 push/pop은 라우팅에 영향이 없다.)
// 시트가 열린 동안 body 스크롤을 잠근다.

interface Props {
  open: boolean;
  title: string;
  placeholder: string;
  query: string;
  onQueryChange: (v: string) => void;
  searching?: boolean;
  onClose: () => void;
  children: ReactNode;      // 결과 목록(부모가 그린다)
  emptyHint?: string;       // 검색어가 비었을 때 안내
  noResultHint?: string;    // 검색어는 있는데 결과가 없을 때 안내
  hasResults: boolean;
}

const HISTORY_MARK = 'mintSearchSheet';

export default function SearchSheet({
  open, title, placeholder, query, onQueryChange, searching = false, onClose, children, emptyHint, noResultHint, hasResults,
}: Props) {
  const pushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // 열림: history 표시 push + popstate·ESC 구독 + body 스크롤 잠금. 닫힘(open=false): 남은 표시가 있으면 걷어낸다.
  useEffect(() => {
    if (!open) {
      if (pushedRef.current) { pushedRef.current = false; window.history.back(); }
      return;
    }
    try {
      window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_MARK]: true }, '');
      pushedRef.current = true;
    } catch { pushedRef.current = false; }

    const onPop = () => { pushedRef.current = false; onCloseRef.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    const requestClose = () => {
      if (pushedRef.current) window.history.back(); // → popstate → onClose
      else onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const requestClose = () => {
    if (pushedRef.current) window.history.back();
    else onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 bg-white flex flex-col"
      style={{ zIndex: 10000, paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* 헤더 */}
      <div className="flex items-center gap-1 px-2 h-14 border-b border-gray-100 shrink-0">
        <button
          type="button"
          onClick={requestClose}
          aria-label="닫기"
          className="w-11 h-11 rounded-full flex items-center justify-center text-gray-700 text-xl active:bg-gray-100"
        >
          ←
        </button>
        <h2 className="flex-1 text-base font-black text-gray-800">{title}</h2>
      </div>

      {/* 검색창 — 16px 이상이어야 iOS가 포커스 시 확대하지 않는다 */}
      <div className="relative px-4 py-3 shrink-0">
        <input
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-4 pr-11 py-3 rounded-xl border-2 border-mint-500 text-base text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-mint-500/20 bg-white"
        />
        {searching ? (
          <div className="absolute inset-y-0 right-7 flex items-center">
            <div className="w-4 h-4 border-2 border-mint-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="검색어 지우기"
            className="absolute inset-y-0 right-5 my-auto w-9 h-9 rounded-full flex items-center justify-center text-gray-400 active:bg-gray-100"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* 결과 — 남은 높이 전부. 키보드가 올라오면 visual viewport가 줄어 자연히 그 위 공간만 쓴다 */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {hasResults ? children : (
          <p className="px-6 py-8 text-sm text-gray-400 text-center leading-relaxed">
            {query.trim() ? (searching ? '검색 중…' : (noResultHint ?? '검색 결과가 없어요')) : (emptyHint ?? '')}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
