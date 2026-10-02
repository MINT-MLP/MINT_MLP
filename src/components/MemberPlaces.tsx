import { useEffect, useState } from 'react';
import {
  fetchWishlist, fetchHistory, removeWish, restorePlaces, slotSource,
  type WishRow, type HistoryItem,
} from '@/services/memberData';
import { kakaoPlaceLink, type RestoredPlace } from '@/services/restore';
import { Icon } from '@/components/icons';
import { dateLabel, openPastResult, purposeLabel } from '@/utils/memberFormat';

// 회원의 찜·지난 추천 목록. 이름·주소는 저장하지 않아 열 때마다 카카오 재검색으로 채운다.
// 못 찾으면(폐업·검색 결과 변동) 카카오맵 링크만 보여준다.

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

// 찜은 한 번에 5곳씩 이름을 채운다 — 가게마다 카카오를 다시 불러야 해서, 다 채우면 첫 화면이 늦고 호출 한도를 쓴다
const WISH_PAGE = 5;

function PlaceLine({ restored, placeId, pending }: { restored: RestoredPlace | null | undefined; placeId: string; pending: boolean }) {
  if (pending) return <span className="block h-4 w-32 animate-pulse rounded bg-gray-100" />;
  if (!restored) {
    return (
      <span className="block min-w-0">
        <span className="block truncate text-sm font-bold text-gray-500">장소 정보를 다시 찾지 못했어요</span>
        <span className="mt-0.5 block truncate text-xs text-gray-400">카카오맵에서 확인할 수 있어요 · ID {placeId}</span>
      </span>
    );
  }
  return (
    <span className="block min-w-0">
      <span className="block truncate text-sm font-bold text-gray-800">{restored.name}</span>
      <span className="mt-0.5 block truncate text-xs text-gray-400">{restored.category} · {restored.address}</span>
    </span>
  );
}

export function MemberWishList({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [state, setState] = useState<Load<WishRow[]>>({ status: 'loading' });
  const [restored, setRestored] = useState<Map<string, RestoredPlace | null>>(new Map());
  const [shown, setShown] = useState(WISH_PAGE);

  useEffect(() => {
    let alive = true;
    fetchWishlist()
      .then((rows) => {
        if (!alive) return;
        setState({ status: 'ready', data: rows });
        onCountChange?.(rows.length);
      })
      .catch(() => { if (alive) setState({ status: 'error' }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 보이는 것 중 아직 이름을 안 채운 것만 다시 찾는다(이미 찾은 건 restorePlaces가 기억한다)
  const rows = state.status === 'ready' ? state.data.slice(0, shown) : [];
  const missing = rows.filter((r) => !restored.has(String(r.id)));
  const missingKey = missing.map((r) => r.id).join(',');
  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    void restorePlaces(missing.map((r) => ({
      key: String(r.id), placeId: r.kakao_place_id, condition: r.condition, source: slotSource(r),
    })))
      .catch(() => new Map<string, RestoredPlace | null>())
      .then((map) => {
        if (!alive) return;
        setRestored((prev) => {
          const next = new Map(prev);
          for (const r of missing) next.set(String(r.id), map.get(String(r.id)) ?? null);
          return next;
        });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);

  async function remove(row: WishRow) {
    if (!(await removeWish(row.kakao_place_id))) return;
    setState((s) => {
      if (s.status !== 'ready') return s;
      const data = s.data.filter((r) => r.id !== row.id);
      onCountChange?.(data.length);
      return { status: 'ready', data };
    });
  }

  if (state.status === 'loading') return <p className="px-1 text-xs text-gray-400">찜한 곳을 불러오는 중이에요…</p>;
  if (state.status === 'error') return <p className="px-1 text-xs text-gray-400">찜한 곳을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>;
  if (state.data.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center">
        <Icon name="heart" className="mx-auto text-2xl text-gray-200" />
        <p className="mt-3 text-sm leading-relaxed text-gray-500">아직 찜한 곳이 없어요.<br />추천 결과에서 하트를 눌러 저장해보세요.</p>
      </div>
    );
  }
  const rest = state.data.length - rows.length;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const key = String(row.id);
        const r = restored.get(key);
        return (
          <div key={row.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3">
            <a href={r?.url ?? kakaoPlaceLink(row.kakao_place_id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
              <PlaceLine restored={r} placeId={row.kakao_place_id} pending={!restored.has(key)} />
              <span className="mt-1 block text-[11px] text-gray-400">{row.condition.area_label} · {dateLabel(row.created_at)} 찜</span>
            </a>
            <button
              onClick={() => void remove(row)}
              aria-label="찜 해제"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 active:scale-90"
            >
              <Icon name="close" className="text-xs" strokeWidth={2.4} />
            </button>
          </div>
        );
      })}
      {rest > 0 && (
        <button
          onClick={() => setShown((n) => n + WISH_PAGE)}
          className="mt-1 w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-bold text-gray-500 active:scale-[0.99] transition-transform"
        >
          더 보기 ({Math.min(rest, WISH_PAGE)}곳)
        </button>
      )}
    </div>
  );
}

// 지난 추천 목록 — 날짜·지역·목적은 우리 DB에 있어 카카오를 부르지 않는다. 누르면 결과 화면으로
export function MemberHistoryList() {
  const [state, setState] = useState<Load<HistoryItem[]>>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    fetchHistory()
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch(() => { if (alive) setState({ status: 'error' }); });
    return () => { alive = false; };
  }, []);

  if (state.status === 'loading') return <p className="px-1 text-xs text-gray-400">지난 추천을 불러오는 중이에요…</p>;
  if (state.status === 'error') return <p className="px-1 text-xs text-gray-400">지난 추천을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>;
  if (state.data.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center">
        <Icon name="clock" className="mx-auto text-2xl text-gray-200" />
        <p className="mt-3 text-sm leading-relaxed text-gray-500">아직 받은 추천이 없어요.<br />추천을 받으면 여기에 쌓여요.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {state.data.map((h) => (
        <button
          key={h.id}
          onClick={() => openPastResult(h.id)}
          className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left active:scale-[0.99] transition-transform"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-gray-800">{h.condition.area_label}에서 {purposeLabel(h.condition)}</span>
            <span className="mt-0.5 block text-xs text-gray-400">{dateLabel(h.created_at)} · {h.condition.group_size} · 추천 {h.slots.length}곳</span>
          </span>
          <Icon name="chevronRight" className="shrink-0 text-sm text-gray-300" />
        </button>
      ))}
    </div>
  );
}
