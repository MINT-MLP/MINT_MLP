import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/services/supabase';
import { getNickname, getAvatarUrl } from '@/services/auth';

// 로그인 상태의 단일 출처. 화면은 useUserStore, 서비스 코드는 useUserStore.getState()로 읽는다.
// 여기 값은 화면 표시용이다. 구독 등급 같은 권한 판정은 반드시 서버(RLS·API)에서 한다.

interface UserState {
  ready: boolean;              // 첫 세션 확인이 끝났는가(그 전엔 로그인 버튼을 깜빡이지 않게)
  session: Session | null;
  user: User | null;           // 회원일 때만 채운다
  isMember: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  plan: string | null;         // 구독 등급 자리. 지금은 항상 null
}

export const useUserStore = create<UserState>(() => ({
  ready: false,
  session: null,
  user: null,
  isMember: false,
  nickname: null,
  avatarUrl: null,
  plan: null,
}));

function apply(session: Session | null) {
  const user = session?.user ?? null;
  useUserStore.setState({
    ready: true,
    session: user ? session : null,
    user,
    isMember: !!user,
    nickname: getNickname(user),
    avatarUrl: getAvatarUrl(user),
  });
}

let started = false;

// 앱에서 한 번만 부른다(AppShell). 로그인 구독도 여기서 한 번만 연다.
export function initUserStore(): void {
  if (started) return;
  started = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    // 익명 로그인을 없앴다(09-30). 예전에 만들어진 익명 세션은 회원이 아니므로 버린다.
    if (session?.user?.is_anonymous) {
      // 이 콜백 안에서 다른 인증 함수를 바로 부르면 멈출 수 있어 한 박자 미룬다(Supabase 권장)
      setTimeout(() => { void supabase.auth.signOut({ scope: 'local' }); }, 0);
      apply(null);
      return;
    }
    apply(session);
  });
}
