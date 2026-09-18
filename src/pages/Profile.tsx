import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { getDeviceId } from '@/storage/device';
import { getBalance, getLedger } from '@/storage/points';
import { loadHistory, openHistoryEntry } from '@/storage/history';
import {
  getSession, onAuthChange, signInWithKakao, signOut, syncProfile, deleteAccount,
  getNickname, getAvatarUrl, backfillHistoryIfNeeded, getActivityHistory, clearActivityCache,
} from '@/services/auth';
import { IconUserCircle, IconGift, PointsBadge } from '@/components';
import type { HistoryEntry, ActivityRow } from '@/types';

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
  const [user, setUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [serverRows, setServerRows] = useState<ActivityRow[]>([]);
  const [serverCount, setServerCount] = useState<number | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState(false);

  useEffect(() => {
    let alive = true;

    // 로그인 사용자만: 최초 1회 로컬 기록을 계정으로 올린 뒤 계정 기록을 읽는다.
    const loadServerHistory = async () => {
      if (!alive) return;
      setServerLoading(true);
      setServerError(false);
      await backfillHistoryIfNeeded();
      try {
        const r = await getActivityHistory();
        if (!alive || !r) return;
        setServerRows(r.rows);
        setServerCount(r.count);
      } catch {
        if (alive) setServerError(true);
      } finally {
        if (alive) setServerLoading(false);
      }
    };

    void getSession().then((s) => {
      if (!alive) return;
      setUser(s?.user ?? null);
      if (s?.user) { void syncProfile(); void loadServerHistory(); }
    });
    const unsubscribe = onAuthChange((s) => {
      if (!alive) return;
      setUser(s?.user ?? null);
      if (s?.user) { void syncProfile(); void loadServerHistory(); }
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  const retryServerHistory = async () => {
    setServerLoading(true);
    setServerError(false);
    try {
      const r = await getActivityHistory(true);
      if (r) { setServerRows(r.rows); setServerCount(r.count); }
    } catch {
      setServerError(true);
    } finally {
      setServerLoading(false);
    }
  };

  // Section A가 화면에 그리는 항목과 겹치는 서버 기록은 숨긴다.
  // 서버 created_at과 로컬 savedAt은 별도 Date.now()라 정확히 일치하지 않으므로 장소명으로만 맞춘다.
  const shownLocalKeys = new Set(
    history.slice(0, 3).map((h) => `${h.placeName}|${h.secondPlaceName ?? ''}`),
  );
  const remoteOnlyRows = serverRows.filter(
    (r) => !shownLocalKeys.has(`${r.place_name ?? ''}|${r.second_place_name ?? ''}`),
  );

  const nickname = getNickname(user);
  const avatarUrl = getAvatarUrl(user);

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
    setUser(null);
    // 다른 계정으로 재로그인할 때 이전 계정 기록이 잠깐 보이지 않도록
    clearActivityCache();
    setServerRows([]);
    setServerCount(null);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('정말 탈퇴하시겠어요? 로그인 정보가 모두 삭제돼요.')) return;
    const r = await deleteAccount();
    if (r.ok) {
      setUser(null);
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
            {/* 로딩·에러 중에는 이 줄 자체를 숨긴다 — 틀린 숫자를 잠깐이라도 보여주지 않기 위해 */}
            {user && !serverLoading && !serverError && serverCount !== null && (
              <p className="mt-0.5 text-[11px] text-gray-400">
                {serverCount >= 1
                  ? `카카오 계정으로 총 ${serverCount}번째 모임이에요`
                  : '이 계정은 아직 첫 모임 전이에요. 다음 추천부터 자동으로 기록돼요.'}
              </p>
            )}
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

      {/* 로그인 유도 — 비로그인 상태에서만. 로그인은 어디까지나 선택이다. */}
      {!user && (
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4">
          {/* 지키지 못할 약속은 쓰지 않는다 — 계정에 남는 건 장소 기록뿐이고 찜·포인트는 아직 로컬이다 */}
          <p className="text-sm font-black text-gray-800">다른 기기에서도 지난 모임을 보고 싶다면</p>
          <p className="mt-0.5 text-xs text-gray-400">카카오로 로그인하면 어떤 곳으로 갔는지는 계정에 남아요. 찜·포인트·방문 인증은 아직 이 기기에만 저장돼요.</p>
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

      {/* 지난 추천 — 스냅샷 복원 */}
      {history.length > 0 && (
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

      {/* 계정에 저장된 모임 — 서버엔 스냅샷이 없어 복원 불가. 읽기 전용임을 시각적으로 먼저 알린다. */}
      {user && (serverLoading || serverError || remoteOnlyRows.length > 0) && (
        <>
          <p className="mt-6 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">계정에 저장된 모임</p>
          {serverLoading ? (
            /* 스피너는 VisitCertModal의 로딩 패턴과 동일한 문법 */
            <div className="flex items-center gap-2 px-1 text-xs text-gray-400">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-mint-500 border-t-transparent" />
              기록을 불러오는 중이에요…
            </div>
          ) : serverError ? (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-xs text-gray-400">기록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>
              <button onClick={() => void retryServerHistory()} className="flex min-h-10 shrink-0 items-center px-1 text-[11px] text-gray-400 underline">다시 시도</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {remoteOnlyRows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => alert('다른 기기에서 만든 기록이라 지금 기기에서는 다시 볼 수 없어요. 장소명은 계정에 안전하게 남아있어요.')}
                  className="w-full text-left rounded-2xl border border-gray-100 bg-white px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-bold text-gray-400">
                      {r.place_name ?? '이름 없는 장소'}{r.second_place_name ? ` → ${r.second_place_name}` : ''}
                    </p>
                    <span className="shrink-0 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] text-gray-400">읽기 전용</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-300 truncate">
                    {r.area_name ? `${r.area_name} · ` : ''}
                    {new Date(r.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                  </p>
                </button>
              ))}
            </div>
          )}
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
          <span aria-hidden className="text-xs text-gray-300">↗</span>
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
