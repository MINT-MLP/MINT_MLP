import type { ReactElement } from 'react';
import { trackEvent } from '@/utils/analytics';
import { getDeviceId } from '@/utils/points';
import type { TabKey } from '@/types';

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

// 아이콘은 전부 인라인 SVG — currentColor 상속으로 활성/비활성 색을 부모가 정한다.
function IconHome({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 10.5 12 3.6l8.5 6.9" />
      <path d="M5.6 9.6V19a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1V9.6" />
      {active && <rect x="10" y="14.6" width="4" height="5.4" rx="0.7" fill="currentColor" stroke="none" />}
    </svg>
  );
}

function IconCalendar({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2.4" />
      <path d="M8 3.2v3.6M16 3.2v3.6" />
      <path d="M3.5 10h17" />
      {active && <rect x="4.6" y="6.1" width="14.8" height="3.6" rx="1.1" fill="currentColor" fillOpacity="0.18" stroke="none" />}
    </svg>
  );
}

// 나침반 — '발굴'은 캐는 게 아니라 아직 안 알려진 곳을 찾아 나서는 것에 가깝다.
function IconCompass({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.4 8.6l-1.9 5.1-5.1 1.9 1.9-5.1 5.1-1.9Z"
        fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.2 : 0} />
    </svg>
  );
}

function IconGift({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="8.5" width="17" height="4" rx="1.1" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.18 : 0} />
      <path d="M12 8.5V21" />
      <path d="M19 12.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6.5" />
      <path d="M8.2 8.5a2.6 2.6 0 1 1 0-5.2c2.7 0 3.8 5.2 3.8 5.2" />
      <path d="M15.8 8.5a2.6 2.6 0 1 0 0-5.2c-2.7 0-3.8 5.2-3.8 5.2" />
    </svg>
  );
}

function IconProfile({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.1" r="3.6" fill={active ? 'currentColor' : 'none'} />
      <path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0" />
    </svg>
  );
}

type Tab = { key: TabKey; Icon: (p: { active: boolean }) => ReactElement; label: string };

const TABS: Tab[] = [
  { key: 'home', Icon: IconHome, label: '홈' },
  { key: 'meetings', Icon: IconCalendar, label: '내 모임' },
  { key: 'discover', Icon: IconCompass, label: '발굴' },
  { key: 'shop', Icon: IconGift, label: '민트샵' },
  { key: 'profile', Icon: IconProfile, label: '프로필' },
];

// 하단 탭바 — 다섯 탭을 같은 무게로 둔다.
// '발굴'을 튀어나온 FAB로 강조했더니 앱이 게임처럼 보였다. 탭바는 이동 수단이지 광고판이 아니다.
export default function BottomTabBar({ active, onChange }: Props) {
  function go(tab: TabKey) {
    onChange(tab);
    trackEvent('tab_click', { device_id: getDeviceId(), tab });
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-md grid grid-cols-5 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {TABS.map((t) => (
          <TabButton key={t.key} tab={t} active={active === t.key} onClick={() => go(t.key)} />
        ))}
      </div>
    </nav>
  );
}

function TabButton({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={tab.label}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col items-center justify-center gap-0.5 py-1 active:scale-95 transition-transform ${active ? 'text-[#2AB5A0]' : 'text-gray-400'}`}
    >
      <span className={`flex items-center justify-center rounded-xl px-2.5 py-1 transition-colors duration-200 ${active ? 'bg-[#E8F8F5]' : 'bg-transparent'}`}>
        <tab.Icon active={active} />
      </span>
      <span className="text-[11px] font-bold">{tab.label}</span>
    </button>
  );
}
