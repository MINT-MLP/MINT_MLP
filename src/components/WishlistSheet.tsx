import { useEffect } from 'react';
import { trackEvent } from '@/services/analytics';
import { Icon } from '@/components/icons';
import { signInWithKakao } from '@/services/auth';
import { MemberWishList } from '@/components/MemberPlaces';
import { useUserStore } from '@/stores/userStore';

// 내 찜 목록 바텀시트 — 저장한 곳을 모아 보고 지도로 바로 열기.
// 회원은 계정에 저장된 찜(카카오 재검색으로 이름 복원), 비회원은 로그인 안내.
export default function WishlistSheet({ onClose }: { onClose: () => void }) {
  const isMember = useUserStore((s) => s.isMember);
  useEffect(() => {
    if (isMember) trackEvent('wishlist_open', { member: true });
  }, [isMember]);
  if (isMember) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
        <div
          className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto bg-white rounded-t-3xl px-5 pt-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] max-h-[80vh] flex flex-col animate-fade-in-up"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-black text-gray-900"><Icon name="heart" className="mr-1" />내가 찜한 곳</h3>
            <button onClick={onClose} className="text-gray-400 text-sm font-bold px-2 active:scale-95">닫기</button>
          </div>
          <div className="flex-1 overflow-y-auto"><MemberWishList /></div>
        </div>
      </div>
    );
  }
  return <LoginPromptSheet onClose={onClose} />;
}

// 비회원 — 찜은 회원 기능이다(기기 저장 찜은 10-01에 없앴다)
function LoginPromptSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto bg-white rounded-t-3xl px-5 pt-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] flex flex-col animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-black text-gray-900"><Icon name="heart" className="mr-1" />내가 찜한 곳</h3>
          <button onClick={onClose} className="text-gray-400 text-sm font-bold px-2 active:scale-95">닫기</button>
        </div>
        <p className="py-6 text-center text-sm leading-relaxed text-gray-500">찜은 카카오 로그인 후 쓸 수 있어요.<br />로그인하면 어느 기기에서든 찜한 곳을 볼 수 있어요.</p>
        <button
          onClick={() => void signInWithKakao()}
          className="w-full rounded-2xl bg-kakao py-3 text-sm font-black text-[#191919] active:scale-[0.99] transition-transform"
        >
          카카오로 로그인
        </button>
      </div>
    </div>
  );
}
