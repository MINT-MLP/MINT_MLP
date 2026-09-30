import SearchSheet from '@/components/SearchSheet';
import RegionSuggestionList from '@/components/RegionSuggestionList';
import { useRegionSearch } from '@/hooks/useRegionSearch';
import type { RegionSuggestion } from '@/types';

// 모바일용 지역 검색 시트 — 검색 로직은 useRegionSearch(데스크톱 드롭다운과 동일), 껍데기는 SearchSheet.
// 고르거나 닫을 때 검색어를 비워 다음에 열면 빈 상태에서 시작한다.

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (s: RegionSuggestion, typed: string) => void;   // typed: 사용자가 친 글자(복원 때 같은 검색을 하려고 저장)
}

export default function RegionSearchSheet({ open, onClose, onPick }: Props) {
  const search = useRegionSearch();

  const close = () => { search.reset(); onClose(); };
  const pick = (s: RegionSuggestion) => { const typed = search.query; search.reset(); onPick(s, typed); };

  return (
    <SearchSheet
      open={open}
      title="지역 검색"
      placeholder="시·구·동 또는 동네 이름"
      query={search.query}
      onQueryChange={search.setQuery}
      searching={search.searching}
      onClose={close}
      hasResults={search.suggestions.length > 0}
      emptyHint="시·구·동 이름이나 동네 이름을 입력하세요. 예: 인계동, 홍대, 인천 미추홀구"
      noResultHint="검색 결과가 없어요. 시·구·동 이름으로 다시 검색해 보세요"
    >
      <RegionSuggestionList suggestions={search.suggestions} onPick={pick} variant="sheet" />
    </SearchSheet>
  );
}
