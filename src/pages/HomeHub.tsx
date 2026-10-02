import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import type { IconName } from '@/components/icons';
import { HistorySheet } from '@/components/MemberPlaces';
import { trackEvent } from '@/services/analytics';
import { signInWithKakao } from '@/services/auth';
import { fetchHistory, fetchWishlist, restorePlaces, slotSource, type HistoryItem, type WishRow } from '@/services/memberData';
import { kakaoPlaceLink, type RestoredPlace } from '@/services/restore';
import { loadDraftSummary, loadGroupSessionSummary, loadResultSummary } from '@/storage/history';
import { useUserStore } from '@/stores/userStore';
import { navigateApp } from '@/utils/appRoute';

// 앱 홈(/app) — 10-02 시안 비교에서 고른 '카드' 안. 큰 인사 + 추천 시작하기, 이어서 하기 띠,
// 회원은 찜·지난 추천을 옆으로 넘기는 카드로 2개씩(더 있으면 '더 보기'), 비회원은 로그인 안내.
const PREVIEW = 2;
const stagger = (i: number) => ({ ['--i' as string]: i }) as CSSProperties;

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

export default function HomeHub() {
  const ready = useUserStore((s) => s.ready);
  const isMember = useUserStore((s) => s.isMember);
  const nickname = useUserStore((s) => s.nickname);
  const userId = useUserStore((s) => s.user?.id ?? null);
  const [resume] = useState(loadResumeItems);

  useEffect(() => { trackEvent('home_hub_view'); }, []);

  function start() {
    trackEvent('home_start');
    navigateApp('/app/recommend?new=1');
  }

  return (
    <div className="max-w-md mx-auto pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="home-enter px-5" style={stagger(0)}>
        <p className="text-sm font-bold text-mint-600">{isMember && nickname ? `안녕하세요 ${nickname}님` : '안녕하세요'}</p>
        <p className="mt-1 text-[28px] font-black leading-[1.2] tracking-tight text-gray-900">약속은 잡았는데<br />어디서 만나지?</p>
        <button
          onClick={start}
          className="home-press mt-5 inline-flex items-center gap-2 rounded-full bg-gray-900 px-6 py-3.5 text-sm font-black text-white"
        >
          <Icon name="sparkle" className="text-mint-500" />추천 시작하기
        </button>
      </div>

      {resume.length > 0 && (
        <div className="home-enter home-scroll mt-7 flex gap-2 overflow-x-auto px-5" style={stagger(1)}>
          {resume.map((r) => (
            <button
              key={r.kind}
              onClick={() => { trackEvent('home_resume', { kind: r.kind }); navigateApp(r.kind === 'result' ? '/app/result' : '/app/recommend'); }}
              className={`home-press flex shrink-0 items-center gap-3 rounded-2xl bg-mint-800 p-4 text-left text-white ${resume.length > 1 ? 'w-[85%]' : 'w-full'}`}
            >
              <Icon name={r.icon} className="text-xl text-mint-200" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black">{r.title}</span>
                <span className="block truncate text-xs text-white/75">{r.sub}</span>
              </span>
              <span aria-hidden className="text-white/60">›</span>
            </button>
          ))}
        </div>
      )}

      {isMember && userId ? (
        <MemberShelves key={userId} />
      ) : ready ? (
        <div className="home-enter mx-5 mt-7 rounded-2xl border border-gray-100 bg-white p-4" style={stagger(2)}>
          <p className="text-sm font-black text-gray-900">찜한 곳과 지난 추천을 모아보세요</p>
          <p className="mt-0.5 text-xs text-gray-500">카카오로 로그인하면 어느 기기에서든 다시 볼 수 있어요.</p>
          <button
            onClick={() => void signInWithKakao()}
            className="home-press mt-3 w-full rounded-2xl bg-kakao py-3 text-sm font-black text-[#191919]"
          >
            카카오로 로그인
          </button>
        </div>
      ) : null}
      <div className="h-6" />
    </div>
  );
}

// ── 이어서 하기 ── 보던 결과, 진행 중인 그룹 초대 링크(호스트), 입력하던 초안(그룹 링크가 없을 때만)
type ResumeItem = { kind: 'result' | 'group' | 'draft'; icon: IconName; title: string; sub: string };

function loadResumeItems(): ResumeItem[] {
  const items: ResumeItem[] = [];
  const result = loadResultSummary();
  if (result) items.push({ kind: 'result', icon: 'pin', title: '보던 추천 이어보기', sub: result.title });
  const group = loadGroupSessionSummary();
  if (group) items.push({ kind: 'group', icon: 'users', title: '친구들 입력 기다리는 중', sub: group.purposeFirst ? `${group.purposeFirst} 모임 · 입력 현황 보기` : '입력 현황 보기' });
  const draft = loadDraftSummary();
  if (draft?.purposeFirst && !group) {
    items.push({ kind: 'draft', icon: 'clipboard', title: '입력하던 추천 이어서', sub: `${draft.appMode === 'group' ? '다같이' : '혼자'} · ${draft.purposeFirst}` });
  }
  return items;
}

// ── 회원: 찜·지난 추천 ── 이름은 저장하지 않아 카카오 재검색으로 채운다(앞의 2개만)
function MemberShelves() {
  const [wishes, setWishes] = useState<Load<WishRow[]>>({ status: 'loading' });
  const [history, setHistory] = useState<Load<HistoryItem[]>>({ status: 'loading' });
  const [places, setPlaces] = useState<Map<string, RestoredPlace | null>>(new Map());
  const [placesPending, setPlacesPending] = useState(true);
  const [openHistory, setOpenHistory] = useState<HistoryItem | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [w, h] = await Promise.allSettled([fetchWishlist(), fetchHistory()]);
      if (!alive) return;
      const wishRows = w.status === 'fulfilled' ? w.value : null;
      const historyRows = h.status === 'fulfilled' ? h.value : null;
      setWishes(wishRows ? { status: 'ready', data: wishRows } : { status: 'error' });
      setHistory(historyRows ? { status: 'ready', data: historyRows } : { status: 'error' });
      const items = [
        ...(wishRows ?? []).slice(0, PREVIEW).map((r) => ({ key: `w${r.id}`, placeId: r.kakao_place_id, condition: r.condition, source: slotSource(r) })),
        ...(historyRows ?? []).slice(0, PREVIEW).flatMap((it) => {
          const top = firstMain(it);
          return top ? [{ key: `h${it.id}`, placeId: top.kakao_place_id, condition: it.condition, source: slotSource(top) }] : [];
        }),
      ];
      const map = await restorePlaces(items).catch(() => new Map<string, RestoredPlace | null>());
      if (alive) { setPlaces(map); setPlacesPending(false); }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <>
      <Shelf title="찜한 곳" style={stagger(2)} state={wishes} empty="아직 찜한 곳이 없어요. 추천 결과에서 하트를 눌러 저장해보세요.">
        {(rows) => rows.slice(0, PREVIEW).map((row) => {
          const p = places.get(`w${row.id}`);
          return (
            <a
              key={row.id}
              href={p?.url ?? kakaoPlaceLink(row.kakao_place_id)}
              target="_blank"
              rel="noreferrer"
              className="home-press w-44 shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-white text-left"
            >
              <span className="flex h-20 items-center justify-center bg-mint-100">
                <Icon name={iconFor(p?.category, row.course)} className="text-3xl text-mint-600" />
              </span>
              <span className="block p-3">
                {placesPending ? (
                  <span className="block h-4 w-28 animate-pulse rounded bg-gray-100" />
                ) : (
                  <span className="block truncate text-sm font-black text-gray-900">{p?.name ?? '카카오맵에서 보기'}</span>
                )}
                <span className="block truncate text-xs text-gray-500">{p?.category ? `${p.category} · ` : ''}{row.condition.area_label}</span>
              </span>
            </a>
          );
        })}
      </Shelf>

      <Shelf title="지난 추천" style={stagger(3)} state={history} empty="아직 받은 추천이 없어요. 로그인한 뒤 받은 추천이 여기에 쌓여요.">
        {(rows) => rows.slice(0, PREVIEW).map((it) => {
          const c = it.condition;
          const top = places.get(`h${it.id}`);
          return (
            <button
              key={it.id}
              onClick={() => setOpenHistory(it)}
              className="home-press w-52 shrink-0 rounded-2xl border border-gray-100 bg-white p-4 text-left"
            >
              <span className="block text-[11px] font-bold text-gray-400">{dateLabel(it.created_at)}</span>
              <span className="mt-1 block truncate text-base font-black text-gray-900">{c.area_label}</span>
              <span className="mt-0.5 inline-block rounded-full bg-mint-100 px-2 py-0.5 text-[11px] font-bold text-mint-600">
                {c.second_purpose ? `${c.first_purpose} → ${c.second_purpose}` : c.first_purpose}
              </span>
              {placesPending ? (
                <span className="mt-2 block h-3.5 w-32 animate-pulse rounded bg-gray-100" />
              ) : (
                <span className="mt-2 block truncate text-xs text-gray-500">
                  {top ? `${top.name}${it.slots.length > 1 ? ` 외 ${it.slots.length - 1}곳` : ''}` : `추천 ${it.slots.length}곳`}
                </span>
              )}
            </button>
          );
        })}
      </Shelf>

      {openHistory && <HistorySheet item={openHistory} onClose={() => setOpenHistory(null)} />}
    </>
  );
}

function Shelf<T>({ title, style, state, empty, children }: {
  title: string; style: CSSProperties; state: Load<T[]>; empty: string; children: (rows: T[]) => ReactNode;
}) {
  const more = state.status === 'ready' && state.data.length > PREVIEW;
  return (
    <section className="home-enter mt-7" style={style}>
      <div className="mb-2 flex items-center justify-between px-5">
        <p className="text-base font-black text-gray-900">{title}</p>
        {state.status === 'ready' && state.data.length > 0 && (
          <button onClick={() => navigateApp('/app/profile')} className="text-xs font-bold text-gray-400">전체 보기</button>
        )}
      </div>
      {state.status === 'loading' && (
        <div className="flex gap-2 px-5">
          {[0, 1].map((i) => <span key={i} className="h-32 w-44 shrink-0 animate-pulse rounded-2xl bg-white" />)}
        </div>
      )}
      {state.status === 'error' && <p className="px-5 text-xs text-gray-400">불러오지 못했어요. 잠시 후 다시 열어주세요.</p>}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="mx-5 rounded-2xl border border-gray-100 bg-white px-4 py-5 text-center text-xs leading-relaxed text-gray-500">{empty}</p>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <div className="home-scroll flex gap-2 overflow-x-auto px-5 pb-1">
          {children(state.data)}
          {more && (
            <button
              onClick={() => navigateApp('/app/profile')}
              className="home-press flex w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-gray-200 text-xs font-bold text-gray-400"
            >
              <span aria-hidden className="text-lg">›</span>더 보기
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function firstMain(it: HistoryItem) {
  return it.slots.find((s) => s.course === 'first' && s.role === 'main') ?? it.slots[0];
}

function iconFor(category: string | undefined, course: 'first' | 'second'): IconName {
  if (category && /카페|디저트|베이커리|제과/.test(category)) return 'cafe';
  if (category && /술|주점|호프|바|포차|와인|이자카야|맥주/.test(category)) return 'wine';
  return course === 'second' ? 'wine' : 'meal';
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
