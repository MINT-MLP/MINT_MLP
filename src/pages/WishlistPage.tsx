import SubPageHeader from '@/components/SubPageHeader';
import LoginEmptyCard from '@/components/LoginEmptyCard';
import { MemberWishList } from '@/components/MemberPlaces';
import { useUserStore } from '@/stores/userStore';

// 찜한 곳(/app/profile/wishlist) — 5곳씩 이름을 채우고 '더 보기'로 이어서. 비회원은 로그인 안내(로그인 뒤 홈으로).
export default function WishlistPage() {
  const ready = useUserStore((s) => s.ready);
  const isMember = useUserStore((s) => s.isMember);
  const userId = useUserStore((s) => s.user?.id ?? null);
  return (
    <div className="max-w-md mx-auto px-5 pt-[max(1rem,env(safe-area-inset-top))]">
      <SubPageHeader title="찜한 곳" fallback="/app/profile" />
      <p className="mt-2 mb-4 text-xs text-gray-400">가게를 누르면 카카오맵에서 열려요.</p>
      {isMember && userId ? (
        <MemberWishList key={userId} />
      ) : ready ? (
        <LoginEmptyCard icon="heart" message="로그인하면 찜한 곳을 모아볼 수 있어요." />
      ) : null}
    </div>
  );
}
