import type { RegionSuggestion, RegionLevel } from '@/types';
import { Icon, type IconName } from '@/components/icons';

// 지역 제안 목록의 항목 렌더. 데스크톱 드롭다운(AnchoredDropdown 안)과 모바일 검색 시트가 같이 쓴다.
// variant='sheet'는 손가락 목표가 커야 해서 항목이 더 높다.

const LEVEL_BADGE: Record<RegionLevel, { icon?: IconName; text: string; cls: string }> = {
  city:     { text: '시 전체', cls: 'bg-mint-100 text-mint-600' },
  district: { text: '구 전체', cls: 'bg-blue-50 text-blue-500' },
  dong:     { text: '동',      cls: 'bg-amber-50 text-amber-600' },
};

function badgeFor(s: RegionSuggestion): { icon?: IconName; text: string; cls: string } {
  if (s.kind === 'hotplace') return { icon: 'flame', text: '핫플', cls: 'bg-rose-50 text-rose-500' };
  if (s.kind === 'station') return { icon: 'subway', text: '역', cls: 'bg-indigo-50 text-indigo-500' };
  return LEVEL_BADGE[s.level];
}

interface Props {
  suggestions: RegionSuggestion[];
  onPick: (s: RegionSuggestion) => void;
  variant?: 'dropdown' | 'sheet';
}

export default function RegionSuggestionList({ suggestions, onPick, variant = 'dropdown' }: Props) {
  const rowCls = variant === 'sheet' ? 'px-5 py-4' : 'px-4 py-3';
  return (
    <>
      {suggestions.map((s) => {
        const badge = badgeFor(s);
        return (
          <button
            key={`${s.level}:${s.label}`}
            type="button"
            // 드롭다운은 input blur보다 먼저 잡아야 해서 mousedown, 시트는 일반 click
            {...(variant === 'dropdown' ? { onMouseDown: () => onPick(s) } : { onClick: () => onPick(s) })}
            className={`w-full text-left ${rowCls} hover:bg-mint-100 active:bg-mint-100 transition-colors border-b border-gray-100 last:border-0 flex items-center gap-2`}
          >
            <Icon name="pin" className="text-sm text-gray-400" />
            <span className="text-sm font-medium text-gray-800 flex-1 truncate">{s.label}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.cls}`}>{badge.icon && <Icon name={badge.icon} className="mr-0.5" />}{badge.text}</span>
          </button>
        );
      })}
    </>
  );
}
