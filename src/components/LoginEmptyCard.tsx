import { signInWithKakao } from '@/services/auth';
import { Icon } from '@/components/icons';
import type { IconName } from '@/components/icons';

// 비회원이 회원 기능 화면(지난 추천·찜한 곳)에 들어왔을 때 — 숨기지 않고 무엇이 쌓이는 곳인지 보여주고 로그인을 권한다.
// returnPath가 없으면 로그인 뒤 홈으로 돌아온다.
export default function LoginEmptyCard({ icon, message, returnPath }: { icon: IconName; message: string; returnPath?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-5 py-8 text-center">
      <Icon name={icon} className="mx-auto text-2xl text-gray-200" />
      <p className="mt-3 text-sm leading-relaxed text-gray-500">{message}</p>
      <button
        onClick={() => void signInWithKakao(returnPath)}
        className="mt-4 w-full rounded-2xl bg-kakao py-3 text-sm font-black text-[#191919] active:scale-[0.99] transition-transform"
      >
        카카오로 로그인
      </button>
    </div>
  );
}
