import SubPageHeader from '@/components/SubPageHeader';
import LoginEmptyCard from '@/components/LoginEmptyCard';
import { MemberHistoryList } from '@/components/MemberPlaces';
import { useUserStore } from '@/stores/userStore';

// 지난 추천(/app/profile/history) — 누르면 결과 화면으로 연다. 비회원은 로그인 안내(로그인 뒤 이 화면으로 돌아온다).
export default function HistoryPage() {
  const ready = useUserStore((s) => s.ready);
  const isMember = useUserStore((s) => s.isMember);
  const userId = useUserStore((s) => s.user?.id ?? null);
  return (
    <div className="max-w-md mx-auto px-5 pt-[max(1rem,env(safe-area-inset-top))]">
      <SubPageHeader title="지난 추천" fallback="/app/profile" />
      <p className="mt-2 mb-4 text-xs text-gray-400">최근 받은 추천 20개까지 볼 수 있어요.</p>
      {isMember && userId ? (
        <MemberHistoryList key={userId} />
      ) : ready ? (
        <LoginEmptyCard icon="clock" message="로그인하면 받은 추천이 여기에 쌓여요." returnPath="/app/profile/history" />
      ) : null}
    </div>
  );
}
