import type { KakaoPlace } from '@/types';
import { Icon } from '@/components/icons';

// 출발지 제안 목록의 항목. 데스크톱 드롭다운과 모바일 검색 시트가 같이 쓴다. 시트는 손가락 목표가 커야 해서 항목이 더 높다.

interface Props {
  places: KakaoPlace[];
  onPick: (p: KakaoPlace) => void;
  variant?: 'dropdown' | 'sheet';
}

export default function PlaceSuggestionList({ places, onPick, variant = 'dropdown' }: Props) {
  const rowCls = variant === 'sheet' ? 'px-5 py-4' : 'px-4 py-3';
  return (
    <>
      {places.map((p) => (
        <button
          key={p.id}
          type="button"
          // 드롭다운은 input blur보다 먼저 잡아야 해서 mousedown, 시트는 일반 click
          {...(variant === 'dropdown' ? { onMouseDown: () => onPick(p) } : { onClick: () => onPick(p) })}
          className={`w-full text-left ${rowCls} hover:bg-mint-100 active:bg-mint-100 transition-colors border-b border-gray-100 last:border-0 flex items-start gap-2`}
        >
          <Icon name="pin" className="mt-0.5 text-sm text-gray-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-800">{p.place_name}</span>
            <span className="mt-0.5 block truncate text-xs text-gray-400">{p.road_address_name || p.address_name}</span>
          </span>
        </button>
      ))}
    </>
  );
}
