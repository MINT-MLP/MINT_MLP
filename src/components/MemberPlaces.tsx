import { useEffect, useState } from 'react';
import {
  fetchWishlist, fetchHistory, removeWish, restorePlaces, slotSource,
  type WishRow, type HistoryItem, type SlotRow,
} from '@/services/memberData';
import { kakaoPlaceLink, type RestoredPlace } from '@/services/restore';
import { Icon } from '@/components/icons';

// 회원의 찜·지난 추천 목록. 이름·주소는 저장하지 않아 열 때마다 카카오 재검색으로 채운다.
// 못 찾으면(폐업·검색 결과 변동) 카카오맵 링크만 보여준다.

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

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
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchWishlist();
        if (!alive) return;
        setState({ status: 'ready', data: rows });
        onCountChange?.(rows.length);
        const map = await restorePlaces(rows.map((r) => ({
          key: String(r.id), placeId: r.kakao_place_id, condition: r.condition, source: slotSource(r),
        })));
        if (alive) { setRestored(map); setRestoring(false); }
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  return (
    <div className="flex flex-col gap-2">
      {state.data.map((row) => {
        const r = restored.get(String(row.id));
        return (
          <div key={row.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3">
            <a href={r?.url ?? kakaoPlaceLink(row.kakao_place_id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
              <PlaceLine restored={r} placeId={row.kakao_place_id} pending={restoring} />
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
    </div>
  );
}

function purposeLabel(h: HistoryItem): string {
  const c = h.condition;
  return c.second_purpose ? `${c.first_purpose} → ${c.second_purpose}` : c.first_purpose;
}

export function MemberHistoryList() {
  const [state, setState] = useState<Load<HistoryItem[]>>({ status: 'loading' });
  const [open, setOpen] = useState<HistoryItem | null>(null);

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
        <p className="text-sm leading-relaxed text-gray-500">아직 받은 추천이 없어요.<br />로그인한 뒤 받은 추천이 여기에 쌓여요.</p>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-2">
        {state.data.slice(0, 10).map((h) => (
          <button
            key={h.id}
            onClick={() => setOpen(h)}
            className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-left active:scale-[0.99] transition-transform"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-gray-800">{h.condition.area_label}에서 {purposeLabel(h)}</span>
              <span className="mt-0.5 block text-xs text-gray-400">{dateLabel(h.created_at)} · {h.condition.group_size}</span>
            </span>
            <Icon name="chevronRight" className="shrink-0 text-sm text-gray-300" />
          </button>
        ))}
      </div>
      {open && <HistorySheet item={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const ROLE_ORDER = (s: SlotRow) => (s.course === 'first' ? 0 : 10) + (s.role === 'main' ? 0 : 1) + s.rank / 100;

function HistorySheet({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const slots = [...item.slots].sort((a, b) => ROLE_ORDER(a) - ROLE_ORDER(b));
  const [restored, setRestored] = useState<Map<string, RestoredPlace | null>>(new Map());
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let alive = true;
    void restorePlaces(item.slots.map((s) => ({
      key: String(s.id), placeId: s.kakao_place_id, condition: item.condition, source: slotSource(s),
    }))).then((m) => { if (alive) { setRestored(m); setPending(false); } });
    return () => { alive = false; };
  }, [item]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-h-[80vh] max-w-md flex-col rounded-t-3xl bg-white px-5 pt-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[17px] font-bold text-gray-900">{item.condition.area_label}에서 {purposeLabel(item)}</h3>
          <button onClick={onClose} className="px-2 text-sm font-bold text-gray-400 active:scale-95">닫기</button>
        </div>
        <p className="mb-4 text-xs text-gray-400">{dateLabel(item.created_at)} · {item.condition.group_size} · 가게 정보는 카카오에서 다시 불러와요</p>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {slots.map((s) => {
            const r = restored.get(String(s.id));
            const label = `${s.course === 'first' ? '1차' : '2차'} ${s.role === 'main' ? '추천' : `대안 ${s.rank}`}`;
            return (
              <a
                key={s.id}
                href={r?.url ?? kakaoPlaceLink(s.kakao_place_id)}
                target="_blank"
                rel="noreferrer"
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${s.role === 'main' ? 'border-mint-500/40 bg-mint-50' : 'border-gray-100 bg-white'}`}
              >
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${s.role === 'main' ? 'bg-mint-100 text-mint-800' : 'bg-gray-100 text-gray-500'}`}>{label}</span>
                <span className="min-w-0 flex-1"><PlaceLine restored={r} placeId={s.kakao_place_id} pending={pending} /></span>
                <Icon name="external" className="shrink-0 text-xs text-gray-300" />
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
