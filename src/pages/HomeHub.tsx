import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { trackEvent } from '@/services/analytics';
import { signInWithKakao } from '@/services/auth';
import { cancelGroupSessionOnServer } from '@/services/session';
import { GROUP_SESSION_KEY, loadDraftSummary, loadGroupSessionSummary, loadResultSummary } from '@/storage/history';
import { useUserStore } from '@/stores/userStore';
import { navigateApp } from '@/utils/appRoute';

// 앱 홈(/app) — 임시 화면. 디자이너 시안이 나오면 이 화면만 바꾼다(주소·이동 규칙은 그대로).
// 이미 있는 기능으로만 채운다: 새로 시작, 이어서 하기(보던 결과·진행 중 그룹 링크·입력하던 초안), 내 기록.
export default function HomeHub() {
  const ready = useUserStore((s) => s.ready);
  const isMember = useUserStore((s) => s.isMember);
  const nickname = useUserStore((s) => s.nickname);
  const [result] = useState(loadResultSummary);
  const [groupLink] = useState(loadGroupSessionSummary);
  const [draft] = useState(() => {
    const d = loadDraftSummary();
    return d?.purposeFirst ? d : null;
  });

  useEffect(() => { trackEvent('home_hub_view'); }, []);

  function start(mode: 'solo' | 'group') {
    if (mode === 'group' && groupLink) {
      const ok = window.confirm('친구들에게 보낸 초대 링크가 아직 진행 중이에요.\n새로 만들면 그 링크는 취소돼요. 새로 만들까요?');
      if (!ok) return;
      cancelGroupSessionOnServer(groupLink.sessionId, groupLink.hostToken);
      try { localStorage.removeItem(GROUP_SESSION_KEY); } catch { /* ignore */ }
    }
    trackEvent('home_start', { mode });
    navigateApp(`/app/recommend?new=${mode}`);
  }

  function resume(kind: 'result' | 'group' | 'draft') {
    trackEvent('home_resume', { kind });
    navigateApp(kind === 'result' ? '/app/result' : '/app/recommend');
  }

  const hasResume = !!(result || groupLink || draft);

  return (
    <div className="max-w-md mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="text-[22px] font-black text-mint-500 tracking-tight">MINT</h1>
      <p className="mt-3 text-[20px] font-black leading-snug text-gray-900">
        {isMember && nickname ? `${nickname}님, ` : ''}오늘은 어디서 만날까요?
      </p>
      <p className="mt-1 text-sm text-gray-500">조건만 고르면 딱 맞는 곳을 골라드려요.</p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          onClick={() => start('solo')}
          className="flex flex-col items-start gap-1 rounded-2xl bg-mint-500 p-4 text-left text-white shadow-lg shadow-mint-500/30 active:scale-[0.98] transition-transform"
        >
          <Icon name="user" className="text-xl" />
          <span className="mt-1 text-base font-black">혼자 정하기</span>
          <span className="text-xs text-white/80">내가 조건을 다 고를게요</span>
        </button>
        <button
          onClick={() => start('group')}
          className="flex flex-col items-start gap-1 rounded-2xl border border-mint-500/40 bg-white p-4 text-left active:scale-[0.98] transition-transform"
        >
          <Icon name="users" className="text-xl text-mint-600" />
          <span className="mt-1 text-base font-black text-gray-900">다같이 정하기</span>
          <span className="text-xs text-gray-500">링크로 친구 취향 모으기</span>
        </button>
      </div>

      {hasResume && (
        <>
          <p className="mt-7 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">이어서 하기</p>
          <div className="flex flex-col gap-2">
            {result && (
              <ResumeRow icon="pin" title="보던 추천 이어보기" sub={result.title} onClick={() => resume('result')} />
            )}
            {groupLink && (
              <ResumeRow
                icon="users"
                title="친구들 입력 기다리는 중"
                sub={groupLink.purposeFirst ? `${groupLink.purposeFirst} 모임 · 입력 현황 보기` : '입력 현황 보기'}
                onClick={() => resume('group')}
              />
            )}
            {draft && !groupLink && (
              <ResumeRow
                icon="clipboard"
                title="입력하던 추천 이어서"
                sub={`${draft.appMode === 'group' ? '다같이' : '혼자'} · ${draft.purposeFirst}`}
                onClick={() => resume('draft')}
              />
            )}
          </div>
        </>
      )}

      <p className="mt-7 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">내 기록</p>
      {isMember ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => navigateApp('/app/profile')}
            className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-white p-4 text-sm font-bold text-gray-800 active:scale-[0.98] transition-transform"
          >
            <Icon name="clock" className="text-mint-600" />지난 추천
          </button>
          <button
            onClick={() => navigateApp('/app/profile')}
            className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-white p-4 text-sm font-bold text-gray-800 active:scale-[0.98] transition-transform"
          >
            <Icon name="heart" className="text-mint-600" />찜한 곳
          </button>
        </div>
      ) : ready ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-4">
          <p className="text-sm font-bold text-gray-800">로그인하면 찜과 지난 추천을 모아볼 수 있어요</p>
          <button
            onClick={() => void signInWithKakao()}
            className="mt-3 w-full rounded-2xl bg-kakao py-3 text-sm font-black text-[#191919] active:scale-[0.99] transition-transform"
          >
            카카오로 로그인
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ResumeRow({ icon, title, sub, onClick }: {
  icon: 'pin' | 'users' | 'clipboard'; title: string; sub: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left active:scale-[0.99] transition-transform"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
        <Icon name={icon} className="text-lg" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-gray-900">{title}</span>
        <span className="block truncate text-xs text-gray-500">{sub}</span>
      </span>
      <span className="text-gray-300" aria-hidden>›</span>
    </button>
  );
}
