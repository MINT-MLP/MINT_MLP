import { useState, useEffect } from 'react';
import { getDeviceId } from '@/storage/device';
import { getBalance, getLedger } from '@/storage/points';
import { loadHistory, openHistoryEntry } from '@/storage/history';
import { signInWithKakao, signOut, syncProfile, deleteAccount } from '@/services/auth';
import { clearMemberCache } from '@/services/memberData';
import { useUserStore } from '@/stores/userStore';
import { Icon, IconUserCircle, IconGift, PointsBadge } from '@/components';
import { MemberHistoryList, MemberWishList } from '@/components/MemberPlaces';
import type { HistoryEntry } from '@/types';

// 문의는 메일 대신 카카오톡 오픈채팅으로 받는다(답장 속도·피드백 수집).
const CONTACT_URL = 'https://open.kakao.com/o/skLK6YGi';

interface Props {
  onChromeChange?: (showTabBar: boolean) => void;
}

// 프로필 탭 — 적립 이력은 실제 데이터(getLedger), 설정은 대부분 목업.
// 로그인은 선택이다. 비로그인 상태의 화면·기능은 로그인 이전과 완전히 동일하게 둔다.
export default function Profile({ onChromeChange }: Props) {
  const [balance] = useState(() => getBalance());
  const [ledger] = useState(() => getLedger());
  const [deviceId] = useState(() => getDeviceId());
  const [history] = useState<HistoryEntry[]>(() => loadHistory());
  const [pushOn, setPushOn] = useState(true);
  const [marketingOn, setMarketingOn] = useState(false);
  const ready = useUserStore((s) => s.ready);
  const user = useUserStore((s) => s.user);
  const nickname = useUserStore((s) => s.nickname);
  const avatarUrl = useUserStore((s) => s.avatarUrl);
  const userId = user?.id ?? null;
  const [signingIn, setSigningIn] = useState(false);

  // 회원이 바뀔 때마다(로그인·계정 전환) 최근 로그인 시각만 갱신한다
  useEffect(() => {
    if (userId) void syncProfile();
  }, [userId]);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithKakao();
    } catch {
      setSigningIn(false);
      alert('로그인을 시작하지 못했어요. 잠시 후 다시 시도해주세요.');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    clearMemberCache();
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('정말 탈퇴하시겠어요? 로그인 정보가 모두 삭제돼요.')) return;
    const r = await deleteAccount();
    if (r.ok) {
      alert('탈퇴가 완료됐어요. 그동안 이용해주셔서 고마워요.');
    } else {
      alert(r.error ?? '탈퇴 처리에 실패했어요. 잠시 후 다시 시도해주세요.');
    }
  };

  return (
    <div className="max-w-md mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="flex items-center gap-2 text-[22px] font-black text-gray-900"><IconUserCircle className="h-[22px] w-[22px] text-mint-600" />프로필</h1>

      {/* 요약 */}
      <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-mint-100">
              <img src="/image/mascot-bird.webp" alt="" aria-hidden="true" className="h-9 w-9 select-none" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-gray-800">{user ? `${nickname ?? '카카오 이용자'}님` : 'MINT 이용자님'}</p>
            {/* 포인트는 아래 PointsBadge가 맡는다 — 같은 데이터를 두 번 말하지 않는다 */}
            <p className="text-xs text-gray-400">방문 인증 {ledger.length}회</p>
          </div>
          {user && (
            <button onClick={() => void handleSignOut()} className="flex min-h-10 shrink-0 items-center px-1 text-[11px] text-gray-400 underline">로그아웃</button>
          )}
        </div>
        {/* 포인트 표기는 홈·민트샵과 같은 공유 컴포넌트로 통일(맨 텍스트 금지) */}
        <div className="mt-3 flex items-center justify-between gap-3">
          {/* 시트가 열리면 하단 탭바를 내린다 — 시트가 탭바에 가리지 않게 */}
          <PointsBadge balance={balance} onOpenChange={(open) => onChromeChange?.(!open)} />
          <p className="min-w-0 truncate text-[10px] text-gray-300">기기 ID · {deviceId}</p>
        </div>
      </div>

      {/* 로그인 유도 — 비로그인 상태에서만. 세션 확인 전에는 숨겨 로그인 버튼이 깜빡이지 않게 */}
      {ready && !user && (
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4">
          <p className="text-sm font-black text-gray-800">찜과 지난 추천을 계정에 모아두세요</p>
          <p className="mt-0.5 text-xs text-gray-400">카카오로 로그인하면 찜한 곳과 받은 추천이 계정에 저장돼 어느 기기에서든 다시 볼 수 있어요.</p>
          <button
            onClick={() => void handleSignIn()}
            disabled={signingIn}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl bg-kakao py-3 text-sm font-black text-[#191919] active:scale-[0.99] transition-transform disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#191919" aria-hidden="true">
              <path d="M12 3C6.99 3 3 6.2 3 10.15c0 2.5 1.65 4.7 4.14 5.97l-.9 3.3c-.09.32.27.58.55.4l3.96-2.6c.4.04.82.06 1.25.06 5.01 0 9-3.2 9-7.13S17.01 3 12 3z" />
            </svg>
            카카오로 로그인
          </button>
          <p className="mt-2 text-[11px] text-gray-400">닉네임과 프로필 사진만 사용해요. 이메일·전화번호는 요구하지 않아요.</p>
        </div>
      )}

      {/* 회원: 계정에 저장된 지난 추천·찜(카카오 재검색으로 이름 복원) */}
      {user && (
        <>
          <p className="mt-6 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">지난 추천</p>
          <MemberHistoryList key={`h-${userId}`} onSheetChange={(open) => onChromeChange?.(!open)} />
          <p className="mt-6 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">찜한 곳</p>
          <MemberWishList key={`w-${userId}`} />
        </>
      )}

      {/* 비회원: 이 기기의 지난 추천(저장 정리 작업 때 걷어낸다) */}
      {ready && !user && history.length > 0 && (
        <>
          <p className="mt-6 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">지난 추천</p>
          <div className="flex flex-col gap-2">
            {history.slice(0, 3).map((h) => (
              <button
                key={h.savedAt}
                onClick={() => openHistoryEntry(h)}
                className="w-full text-left rounded-2xl border border-gray-100 bg-white px-4 py-3 active:scale-[0.99] transition-transform"
              >
                <p className="text-sm font-black text-gray-800 truncate">
                  {h.placeName}{h.secondPlaceName ? ` → ${h.secondPlaceName}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-gray-400 truncate">
                  {h.areaName ? `${h.areaName} · ` : ''}
                  {new Date(h.savedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 적립 이력 */}
      <p className="mt-6 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">적립 내역</p>
      {ledger.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center">
          {/* 다른 탭(내 모임·발견) 빈 상태와 같은 톤의 회색 글리프 */}
          <IconGift className="mx-auto h-8 w-8 text-gray-200" />
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            아직 적립 내역이 없어요.<br />추천받은 곳에 방문하고 인증하면 포인트가 쌓여요.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {ledger.map((e, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gray-800">{e.place_name || '방문 인증'}</p>
                <p className="text-[11px] text-gray-400">
                  {new Date(e.at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                  {e.method === 'gps' ? ' · 위치 인증' : ' · 사진 인증'}
                </p>
              </div>
              <span className="shrink-0 text-sm font-black text-mint-600">+{e.points}P</span>
            </div>
          ))}
        </div>
      )}

      {/* 설정 */}
      <p className="mt-6 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">설정</p>
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <ToggleRow label="모임 알림" desc="약속 확정·응답 알림을 받아요" on={pushOn} onToggle={() => setPushOn((v) => !v)} />
        <div className="h-px bg-gray-100" />
        <ToggleRow label="혜택·소식 알림" desc="새 원석과 쿠폰 소식을 받아요" on={marketingOn} onToggle={() => setMarketingOn((v) => !v)} />
        <div className="h-px bg-gray-100" />
        <LinkRow label="이용약관" onClick={() => alert('이용약관은 출시 준비 중이에요.')} />
        <div className="h-px bg-gray-100" />
        <LinkRow label="개인정보처리방침" onClick={() => alert('개인정보처리방침은 출시 준비 중이에요.')} />
        <div className="h-px bg-gray-100" />
        <a
          href={CONTACT_URL}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-10 items-center justify-between px-4 py-3.5 active:bg-gray-50"
        >
          <span className="text-sm font-bold text-gray-700">문의하기 &amp; 서비스 피드백</span>
          <Icon name="external" className="text-xs text-gray-300" />
        </a>
        {user && (
          <>
            <div className="h-px bg-gray-100" />
            <LinkRow label="로그아웃" onClick={() => void handleSignOut()} />
            <div className="h-px bg-gray-100" />
            <button
              onClick={() => void handleDeleteAccount()}
              className="flex min-h-10 w-full items-center justify-between px-4 py-3.5 text-left active:bg-gray-50"
            >
              <span className="text-sm font-bold text-red-500">회원 탈퇴</span>
              <span className="text-xs text-gray-300">›</span>
            </button>
          </>
        )}
      </div>

      <p className="mt-5 text-center text-[11px] text-gray-400">알림 설정은 아직 저장되지 않아요 · 출시 준비 중</p>
    </div>
  );
}

function ToggleRow({ label, desc, on, onToggle }: { label: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-700">{label}</p>
        <p className="text-[11px] text-gray-400">{desc}</p>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-mint-500' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function LinkRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-10 w-full items-center justify-between px-4 py-3.5 text-left active:bg-gray-50">
      <span className="text-sm font-bold text-gray-700">{label}</span>
      <span className="text-xs text-gray-300">›</span>
    </button>
  );
}
