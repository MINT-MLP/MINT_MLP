import { useRef, useState } from 'react';
import type { KakaoPlace, LocationEntry } from '@/types';
import AnchoredDropdown from '@/components/AnchoredDropdown';
import SearchSheet from '@/components/SearchSheet';
import PlaceSuggestionList from '@/components/PlaceSuggestionList';
import { Icon } from '@/components/icons';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePlaceSearch } from '@/hooks/usePlaceSearch';

interface Props {
  locations: LocationEntry[];
  onChange: (locations: LocationEntry[]) => void;
}

// 출발지 입력 — 목록에서 고른 장소만 값이 된다(자유 입력 불가). 고르면 입력창 자리에 칩이 들어가고 ✕로만 해제한다.
// 데스크톱: 입력창 + 드롭다운. 모바일: 입력창 모양의 버튼을 누르면 전체 화면 검색 시트(키보드에 가려지지 않는다).
// 행마다 고정 key를 둔다 — 인덱스 key면 검색 중인 행을 지웠을 때 옆 행이 그 결과를 받는다.

interface Row { key: number; place: LocationEntry | null }

const MIN_ROWS = 2;
const MAX_ROWS = 6;

let rowSeq = 0;
const newRow = (place: LocationEntry | null = null): Row => ({ key: rowSeq++, place });

function placeToEntry(p: KakaoPlace, query: string): LocationEntry {
  // 좌표는 중간지점 계산에만 쓴다. 저장되는 건 검색어와 장소 ID뿐
  return { name: p.place_name, lat: parseFloat(p.y), lng: parseFloat(p.x), query: query.trim(), kakaoPlaceId: p.id };
}

export default function LocationInput({ locations, onChange }: Props) {
  const [rows, setRows] = useState<Row[]>(() => {
    const filled = locations.map((l) => newRow(l));
    while (filled.length < MIN_ROWS) filled.push(newRow());
    return filled;
  });
  const isMobile = useIsMobile();
  const [sheetRow, setSheetRow] = useState<number | null>(null);   // 모바일 시트가 채울 행의 key
  const sheetSearch = usePlaceSearch(10);

  // 부모에는 고른 출발지만 올린다. 마운트 때는 부르지 않는다 — 부모가 이미 같은 값을 갖고 있다.
  function commit(next: Row[]) {
    setRows(next);
    onChange(next.filter((r) => r.place).map((r) => r.place as LocationEntry));
  }
  const setPlace = (key: number, place: LocationEntry | null) =>
    commit(rows.map((r) => (r.key === key ? { ...r, place } : r)));

  const closeSheet = () => { sheetSearch.reset(); setSheetRow(null); };

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      {rows.map((row, i) => (
        <OriginRow
          key={row.key}
          index={i}
          place={row.place}
          isMobile={isMobile}
          removable={rows.length > MIN_ROWS}
          onPick={(p, q) => setPlace(row.key, placeToEntry(p, q))}
          onClear={() => setPlace(row.key, null)}
          onRemove={() => commit(rows.filter((r) => r.key !== row.key))}
          onOpenSheet={() => setSheetRow(row.key)}
        />
      ))}

      {rows.length < MAX_ROWS && (
        <button
          type="button"
          onClick={() => setRows([...rows, newRow()])}
          className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-mint-500/60 text-mint-500 text-sm font-medium hover:bg-mint-100 transition-colors"
        >
          <Icon name="plus" className="text-base" strokeWidth={2.4} />
          출발지 추가
        </button>
      )}

      <SearchSheet
        open={sheetRow !== null}
        title="출발지 검색"
        placeholder="역·장소 이름"
        query={sheetSearch.query}
        onQueryChange={sheetSearch.setQuery}
        searching={sheetSearch.searching}
        onClose={closeSheet}
        hasResults={sheetSearch.results.length > 0}
        emptyHint="출발하는 역이나 장소 이름을 입력하세요. 예: 성수역, 합정역"
        noResultHint="검색 결과가 없어요. 역이나 장소 이름으로 다시 검색해 보세요"
      >
        <PlaceSuggestionList
          places={sheetSearch.results}
          variant="sheet"
          onPick={(p) => {
            if (sheetRow !== null) setPlace(sheetRow, placeToEntry(p, sheetSearch.query));
            closeSheet();
          }}
        />
      </SearchSheet>
    </div>
  );
}

function OriginRow({
  index, place, isMobile, removable, onPick, onClear, onRemove, onOpenSheet,
}: {
  index: number;
  place: LocationEntry | null;
  isMobile: boolean;
  removable: boolean;
  onPick: (p: KakaoPlace, query: string) => void;
  onClear: () => void;
  onRemove: () => void;
  onOpenSheet: () => void;
}) {
  const search = usePlaceSearch(5);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const placeholder = index === 0 ? '예: 성수역, 합정역...' : '예: 강남역, 이태원...';

  function clear() {
    search.reset();
    onClear();
    if (!isMobile) setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-7 h-7 rounded-full bg-mint-100 border border-mint-500/50 text-mint-500 text-xs font-black flex items-center justify-center flex-shrink-0">
        {index + 1}
      </span>
      <div ref={wrapperRef} className="flex-1 min-w-0 relative">
        {place ? (
          <div role="status" className="w-full flex items-center gap-2 pl-4 pr-2 py-2.5 rounded-xl border-2 border-mint-500 bg-mint-100">
            <Icon name="check" className="shrink-0 text-sm text-mint-800" strokeWidth={2.4} />
            <span className="flex-1 min-w-0 truncate text-sm font-bold text-gray-800" title={place.name}>{place.name}</span>
            <button
              type="button"
              onClick={clear}
              aria-label={`${index + 1}번 출발지 지우기`}
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-white active:scale-95 transition-all"
            >
              <Icon name="close" className="text-sm" strokeWidth={2.4} />
            </button>
          </div>
        ) : isMobile ? (
          <button
            type="button"
            onClick={onOpenSheet}
            aria-haspopup="dialog"
            className="w-full text-left pl-4 pr-9 py-3.5 rounded-xl border-2 border-gray-200 text-sm text-gray-400 bg-white active:bg-mint-50 transition-colors"
          >
            {placeholder}
          </button>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              onFocus={() => setTimeout(() => inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
              onBlur={() => setTimeout(() => search.reset(), 150)}
              placeholder={placeholder}
              aria-label={`${index + 1}번 출발지 검색`}
              className="w-full pl-4 pr-9 py-3.5 rounded-xl border-2 border-gray-200 text-sm outline-none transition-all duration-200 bg-white focus:border-mint-500"
            />
            {search.searching && (
              <div className="absolute inset-y-0 right-3 flex items-center">
                <div className="w-4 h-4 border-2 border-mint-500 border-t-transparent rounded-full animate-spin-slow" />
              </div>
            )}
            <AnchoredDropdown open={search.results.length > 0} getAnchor={() => wrapperRef.current}>
              <PlaceSuggestionList places={search.results} onPick={(p) => { const q = search.query; search.reset(); onPick(p, q); }} />
            </AnchoredDropdown>
          </>
        )}
      </div>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${index + 1}번 출발지 칸 삭제`}
          className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
        >
          <Icon name="close" className="text-xs" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
