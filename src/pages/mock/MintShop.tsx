import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { getBalance, getDeviceId } from '@/utils/points';
import { trackEvent } from '@/utils/analytics';
import { MOCK_COUPONS, type CouponBenefitType, type MintCoupon } from '@/pages/mock/data/coupons';
import { getNotifyList, toggleNotify } from '@/pages/mock/couponNotify';
import { PointsBadge } from '@/components';
import Reserve from '@/pages/Reserve';
import CouponDetailSheet from '@/pages/mock/components/CouponDetailSheet';
import CouponPurchasePreparingModal from '@/pages/mock/components/CouponPurchasePreparingModal';
import {
  IconGift, IconUtensils, IconCup, IconTag, IconClock, IconUsers, IconSparkle,
  IconCheck, IconChevronDown, type IconProps,
} from '@/components';

const PAGE_SIZE = 10;

// 페이지 버튼은 40px 터치 타깃이라 320px 폭에서 5개가 다 들어가지 않는다.
// 4페이지 이하는 전부, 5페이지 이상은 [처음 · 현재 · 마지막]으로 축약한다(최대 폭 280px).
function pageItems(current: number, count: number): (number | 'gap')[] {
  if (count <= 4) return Array.from({ length: count }, (_, i) => i + 1);
  const nums = [...new Set([1, current, count])].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('gap');
    out.push(n);
  });
  return out;
}

const BENEFIT_ICON: Record<CouponBenefitType, (p: IconProps) => ReactElement> = {
  side: IconUtensils,
  drink: IconCup,
  discount_amount: IconTag,
  discount_percent: IconTag,
  time: IconClock,
  group: IconUsers,
  first_visit: IconSparkle,
};

const FILTERS: { key: string; label: string; types: CouponBenefitType[] | null }[] = [
  { key: 'all', label: '전체', types: null },
  { key: 'side', label: '사이드메뉴', types: ['side'] },
  { key: 'drink', label: '음료', types: ['drink'] },
  { key: 'discount', label: '할인', types: ['discount_amount', 'discount_percent'] },
  { key: 'time', label: '시간대 혜택', types: ['time'] },
  { key: 'group', label: '모임 혜택', types: ['group'] },
  { key: 'first_visit', label: '첫 방문', types: ['first_visit'] },
];

interface Props {
  onChromeChange?: (showTabBar: boolean) => void;
}

// 민트샵 — 아직 교환은 열리지 않았다(가짜 문). 탭은 '알림 신청'일 뿐 포인트는 절대 차감되지 않는다.
export default function MintShop({ onChromeChange }: Props) {
  const [balance] = useState(() => getBalance());
  const [notified, setNotified] = useState<string[]>(() => getNotifyList());
  const [filterKey, setFilterKey] = useState('all');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedCoupon, setSelectedCoupon] = useState<MintCoupon | null>(null);
  const [reservingCoupon, setReservingCoupon] = useState<MintCoupon | null>(null);
  const [showPurchasePopup, setShowPurchasePopup] = useState(false);

  // 상세 시트나 예약 화면이 떠 있으면 탭바를 내린다 — 시트 하단 CTA가 가리지 않게(PointsBadge와 같은 규칙).
  useEffect(() => {
    onChromeChange?.(!(selectedCoupon || reservingCoupon));
  }, [selectedCoupon, reservingCoupon, onChromeChange]);

  const filtered = useMemo(() => {
    const types = FILTERS.find((f) => f.key === filterKey)?.types;
    return types ? MOCK_COUPONS.filter((c) => types.includes(c.benefitType)) : MOCK_COUPONS;
  }, [filterKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function selectFilter(key: string) {
    setFilterKey(key);
    setPage(1);
    trackEvent('shop_filter_click', { device_id: getDeviceId(), category: key });
  }

  function goPage(next: number) {
    if (next < 1 || next > pageCount || next === current) return;
    setPage(next);
    trackEvent('shop_page_change', { device_id: getDeviceId(), page: next });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 카드 탭은 이제 즉시 신청이 아니라 상세 열기다 — 가게를 보고 예약까지 갈 수 있어야 한다.
  function openDetail(c: MintCoupon) {
    trackEvent('shop_coupon_click', { device_id: getDeviceId(), coupon_id: c.id, shop_name: c.shopName, point_cost: c.pointCost, balance });
    setSelectedCoupon(c);
  }

  function toggleCouponNotify(c: MintCoupon) {
    const { list, applied } = toggleNotify(c.id);
    setNotified(list);
    if (applied) {
      trackEvent('coupon_notify_add', {
        device_id: getDeviceId(), coupon_id: c.id, shop_name: c.shopName, area: c.area,
        category: c.category, benefit_type: c.benefitType, point_cost: c.pointCost, tier: c.tier, balance,
      });
      setToast(`${c.shopName} 쿠폰, 출시하면 가장 먼저 알려드릴게요`);
    } else {
      trackEvent('coupon_notify_remove', { device_id: getDeviceId(), coupon_id: c.id });
      setToast('신청을 취소했어요');
    }
    window.setTimeout(() => setToast(null), 2200);
  }

  function handleReserve(c: MintCoupon) {
    trackEvent('coupon_reserve_click', {
      device_id: getDeviceId(), coupon_id: c.id, shop_name: c.shopName, area: c.area, category: c.category, point_cost: c.pointCost,
    });
    setReservingCoupon(c);
  }

  function handlePurchase(c: MintCoupon) {
    trackEvent('coupon_purchase_click', {
      device_id: getDeviceId(), coupon_id: c.id, shop_name: c.shopName, point_cost: c.pointCost, tier: c.tier, balance,
    });
    setShowPurchasePopup(true);
  }

  // 예약은 기존 Reserve 화면을 그대로 쓴다(Home의 view === 'reserve'와 같은 전체화면 전환).
  // 돌아올 때 selectedCoupon은 남겨둬서 그리드가 아니라 보던 쿠폰 상세로 복귀한다.
  if (reservingCoupon) {
    return (
      <Reserve
        placeName={reservingCoupon.shopName}
        address={reservingCoupon.address}
        openingHours={reservingCoupon.openingHours}
        onBack={() => setReservingCoupon(null)}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-[22px] font-black text-gray-900">
          <IconGift className="h-6 w-6 text-[#2AB5A0]" />
          민트샵
        </h1>
        {/* 시트가 열리면 하단 탭바를 내린다 — 시트가 탭바에 가리지 않게 */}
        <PointsBadge balance={balance} onOpenChange={(open) => onChromeChange?.(!open)} />
      </div>

      {/* 잔액은 헤더 배지가 이미 말한다 — 히어로로 같은 숫자를 반복하지 않는다.
          대신 적립 방법과 "배지를 누를 수 있다"는 발견성만 한 줄로 남긴다. */}
      <p className="mt-1 text-xs text-gray-400 break-keep">
        방문 인증하면 500P씩 쌓여요 · 포인트를 누르면 적립 내역을 볼 수 있어요
      </p>

      {/* 혜택 유형 필터 */}
      <p className="mt-6 px-1 text-sm font-black text-gray-800">어떤 혜택을 찾으세요?</p>
      <div className="relative -mx-5 mt-2.5">
        <div className="overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-2">
            {FILTERS.map((f) => {
              const on = f.key === filterKey;
              return (
                <button
                  key={f.key}
                  onClick={() => selectFilter(f.key)}
                  aria-pressed={on}
                  className={`flex h-10 shrink-0 items-center rounded-full border px-4 text-xs font-bold transition-colors active:scale-95 ${
                    on ? 'border-[#3CDBC0] bg-[#E8F8F5] text-[#2AB5A0]' : 'border-gray-200 bg-white text-gray-700'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* 뒤쪽 칩이 더 있다는 신호 */}
        <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#F5FBF8] to-transparent" />
      </div>

      {/* 쿠폰 그리드 */}
      <p className="mt-6 px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
        동네 골목 쿠폰 · {filtered.length}종
      </p>
      <div className="grid grid-cols-2 gap-3">
        {shown.map((c) => (
          <CouponCard
            key={c.id}
            coupon={c}
            applied={notified.includes(c.id)}
            balance={balance}
            onTap={() => openDetail(c)}
          />
        ))}
      </div>

      {pageCount > 1 && (
        <div className="mt-5 flex items-center justify-center gap-2">
          <PageArrow label="이전 페이지" disabled={current === 1} onClick={() => goPage(current - 1)} direction="prev" />
          {pageItems(current, pageCount).map((item, i) =>
            item === 'gap' ? (
              <span key={`gap-${i}`} className="w-4 shrink-0 text-center text-xs font-bold text-gray-300">…</span>
            ) : (
              <button
                key={item}
                onClick={() => goPage(item)}
                aria-current={item === current ? 'page' : undefined}
                aria-label={`${item}페이지`}
                className={`h-10 w-10 shrink-0 rounded-full border text-xs font-black transition-colors ${
                  item === current
                    ? 'border-[#3CDBC0] bg-[#E8F8F5] text-[#2AB5A0]'
                    : 'border-gray-200 bg-white text-gray-700 active:bg-gray-50'
                }`}
              >
                {item}
              </button>
            ),
          )}
          <PageArrow label="다음 페이지" disabled={current === pageCount} onClick={() => goPage(current + 1)} direction="next" />
        </div>
      )}

      <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400 break-keep">
        신청은 알림용이에요 · 포인트는 차감되지 않아요 · 아직 교환은 열리지 않았어요
      </p>

      {selectedCoupon && (
        <CouponDetailSheet
          coupon={selectedCoupon}
          applied={notified.includes(selectedCoupon.id)}
          benefitIcon={BENEFIT_ICON[selectedCoupon.benefitType]}
          onClose={() => setSelectedCoupon(null)}
          onToggleNotify={() => toggleCouponNotify(selectedCoupon)}
          onReserve={() => handleReserve(selectedCoupon)}
          onPurchase={() => handlePurchase(selectedCoupon)}
        />
      )}

      {showPurchasePopup && <CouponPurchasePreparingModal onClose={() => setShowPurchasePopup(false)} />}

      {/* 토스트는 시트(z-50)·준비중 팝업(z-60)보다 위여야 시트 안에서 눌러도 보인다 */}
      {toast && (
        <div className="fixed bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))] left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-full border border-[#3CDBC0]/35 bg-white/95 px-4 py-2.5 text-center text-xs font-bold text-[#2AB5A0] shadow-xl shadow-[#2AB5A0]/20 backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}

function PageArrow({ label, disabled, onClick, direction }: { label: string; disabled: boolean; onClick: () => void; direction: 'prev' | 'next' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition-colors active:bg-gray-50 disabled:border-gray-100 disabled:bg-white disabled:text-gray-300"
    >
      <IconChevronDown className={`h-4 w-4 ${direction === 'prev' ? 'rotate-90' : '-rotate-90'}`} strokeWidth={2.4} />
    </button>
  );
}

function CouponCard({ coupon, applied, balance, onTap }: { coupon: MintCoupon; applied: boolean; balance: number; onTap: () => void }) {
  const Icon = BENEFIT_ICON[coupon.benefitType];
  const short = coupon.pointCost - balance;
  const enough = short <= 0;

  return (
    <button
      onClick={onTap}
      aria-pressed={applied}
      className={`flex flex-col rounded-2xl border bg-white p-4 text-left transition-transform active:scale-[0.98] ${
        applied ? 'border-[#3CDBC0]' : 'border-gray-100'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#E8F8F5] text-[#2AB5A0]">
          <Icon className="h-5 w-5" />
        </span>
        {applied && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-[#E8F8F5] px-2 py-1 text-[11px] font-bold text-[#2AB5A0]">
            <IconCheck className="h-3 w-3" strokeWidth={2.6} />
            신청됨
          </span>
        )}
      </div>

      {/* 상호(작고 흐리게) → 혜택(크고 진하게)로 위계를 벌리고, 동네·업종은 한 줄로 합친다 */}
      <p className="mt-3 truncate text-[11px] font-bold text-gray-400">
        {coupon.shopName}
      </p>
      <p className="truncate text-[11px] text-gray-400">
        {coupon.area} · {coupon.category}
      </p>
      <p className="mt-1 text-[15px] font-black leading-snug text-gray-900 break-keep">{coupon.title}</p>

      <div className="mt-auto flex items-end justify-between gap-1 pt-3">
        <p className={`text-[15px] font-black ${applied ? 'text-[#2AB5A0]/50' : enough ? 'text-[#2AB5A0]' : 'text-gray-400'}`}>
          {coupon.pointCost.toLocaleString()}P
        </p>
        {!applied && (
          <span className="shrink-0 whitespace-nowrap text-[11px] font-bold text-gray-400">
            자세히 보기
          </span>
        )}
      </div>
      {!enough && !applied && (
        <p className="mt-1 text-[11px] text-gray-400">{short.toLocaleString()}P 더 필요해요</p>
      )}
    </button>
  );
}
