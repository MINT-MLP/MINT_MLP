import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 입력창 아래에 붙는 자동완성 드롭다운의 공용 껍데기.
// body 포털 + fixed 위치인 이유: 스텝 화면 루트가 overflow-hidden이라 입력창 안에 absolute로 두면 잘린다.
// 예전엔 좌표를 렌더 때 한 번만 재서, 창 크기 변경(F11·브라우저 줌)·스크롤 뒤에 드롭다운이 입력창에서 떨어져 떠 있었다.
// 여기서는 열려 있는 동안 창 resize, 캡처 단계 scroll(안쪽 스크롤 컨테이너까지), visualViewport(핀치 줌),
// 앵커의 ResizeObserver를 듣고 다시 잰다. 닫히면 전부 뗀다.
// getAnchor는 콜백이다(ref.current를 렌더 중에 읽지 않기 위해) — 호출부는 `() => wrapperRef.current`처럼 넘긴다.

interface Props {
  open: boolean;
  getAnchor: () => HTMLElement | null;
  children: ReactNode;
  maxHeight?: number;
  className?: string;
}

interface Box { top: number; left: number; width: number }

const GAP_PX = 4;

export default function AnchoredDropdown({ open, getAnchor, children, maxHeight, className }: Props) {
  const [box, setBox] = useState<Box | null>(null);
  // 최신 getAnchor를 effect 안에서 쓰기 위한 보관소. 렌더 중에 ref를 쓰지 않도록 effect에서 갱신한다.
  const getAnchorRef = useRef(getAnchor);
  useEffect(() => { getAnchorRef.current = getAnchor; });

  useLayoutEffect(() => {
    if (!open) return; // 닫히면 렌더가 null을 돌려주므로 box를 지울 필요 없다(effect 안 동기 setState 회피)
    const measure = () => {
      const el = getAnchorRef.current();
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      const next = { top: r.bottom + GAP_PX, left: r.left, width: r.width };
      // 값이 같으면 set하지 않는다 — scroll마다 리렌더가 나지 않게
      setBox((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width) ? prev : next);
    };
    // 첫 측정은 다음 프레임에 — effect 본문에서 동기 setState를 부르면 리렌더가 연쇄될 수 있어 lint가 막는다(한 프레임 지연은 체감 없음)
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    const anchor = getAnchorRef.current();
    const ro = typeof ResizeObserver !== 'undefined' && anchor ? new ResizeObserver(measure) : null;
    if (ro && anchor) ro.observe(anchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [open]);

  if (!open || !box) return null;
  return createPortal(
    <div
      style={{ position: 'fixed', top: box.top, left: box.left, width: box.width, zIndex: 9999, maxHeight, overflowY: maxHeight ? 'auto' : undefined }}
      className={className ?? 'bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden'}
    >
      {children}
    </div>,
    document.body,
  );
}
