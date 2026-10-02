import { goBackOr } from '@/utils/appRoute';

// 탭 안의 하위 화면 머리 — 왼쪽 뒤로(앱 안에서 왔으면 들어온 곳으로, 주소로 바로 왔으면 fallback으로)와 제목
export default function SubPageHeader({ title, fallback }: { title: string; fallback: string }) {
  return (
    <div className="relative -mx-2 flex h-10 items-center justify-center">
      <button
        onClick={() => goBackOr(fallback)}
        className="absolute left-0 top-1/2 -translate-y-1/2 flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:text-mint-600"
        aria-label="뒤로 가기"
      >
        <span aria-hidden>←</span>
        <span>뒤로</span>
      </button>
      <h1 className="text-[17px] font-black text-gray-900">{title}</h1>
    </div>
  );
}
