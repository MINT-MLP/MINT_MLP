import type { ReactElement } from 'react';
import type { MintCoupon } from '@/pages/mock/data/coupons';
import { IconMapPin, IconClock, IconUtensils, IconBell, IconCheck } from '@/components';
import type { IconProps } from '@/components';

interface Props {
  coupon: MintCoupon;
  applied: boolean;
  benefitIcon: (p: IconProps) => ReactElement; // MintShop의 BENEFIT_ICON을 그대로 넘겨받는다(중복 매핑 방지)
  onClose: () => void;
  onToggleNotify: () => void;
  onReserve: () => void;
  onPurchase: () => void;
}

// 쿠폰 상세 — 가게 정보를 먼저 보여주고 예약으로 잇는다.
// 정보량이 많아 센터 모달이 아니라 바텀시트다(TreasurerPlanSheet와 같은 헤더/본문/CTA 3분할).
export default function CouponDetailSheet({
  coupon, applied, benefitIcon: BenefitIcon, onClose, onToggleNotify, onReserve, onPurchase,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-h-[85dvh] max-w-md flex-col rounded-t-3xl bg-mint-50 animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <span className="rounded-full bg-mint-100 px-3 py-1 text-xs font-black text-mint-600">
            {coupon.category}
          </span>
          <button onClick={onClose} className="px-2 text-sm font-bold text-gray-400 active:scale-95">닫기</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          <h2 className="text-[20px] font-black leading-snug text-gray-900 break-keep">{coupon.shopName}</h2>
          <p className="mt-0.5 text-sm text-gray-400">{coupon.area} · {coupon.category}</p>
          <p className="mt-1 text-xs text-gray-500">⭐ {coupon.rating.toFixed(1)}</p>

          <div className="mt-4 flex flex-col gap-2.5 rounded-2xl border border-gray-100 bg-white p-4">
            <InfoRow icon={<IconMapPin className="h-4 w-4" />} label="주소" value={coupon.address} />
            <InfoRow icon={<IconClock className="h-4 w-4" />} label="영업시간" value={coupon.openingHours} />
            <InfoRow icon={<IconUtensils className="h-4 w-4" />} label="대표메뉴" value={coupon.signatureMenu.join(' · ')} />
          </div>

          <div className="mt-3 rounded-2xl border border-mint-500/30 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
                <BenefitIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-black leading-snug text-gray-900 break-keep">{coupon.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500 break-keep">{coupon.description}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm font-black text-mint-600">{coupon.pointCost.toLocaleString()}P</span>
              {applied && (
                <span className="flex items-center gap-0.5 text-[11px] font-bold text-mint-600">
                  <IconCheck className="h-3 w-3" strokeWidth={2.6} />
                  신청됨
                </span>
              )}
            </div>
          </div>

          {/* 알림 신청 — 카드 탭이 상세 열기로 바뀌었으니 토글은 여기로 내려온다 */}
          <button
            onClick={onToggleNotify}
            aria-pressed={applied}
            className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border py-3 text-sm font-bold transition-colors active:scale-[0.98] ${
              applied ? 'border-mint-500 bg-mint-100 text-mint-600' : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            <IconBell className="h-4 w-4" />
            {applied ? '알림 신청했어요 · 눌러서 취소' : '출시하면 가장 먼저 알림 받기'}
          </button>
        </div>

        {/* 하단 고정 CTA — 진짜 동작하는 예약은 채운 민트, 아직 못 여는 구매는 아웃라인 */}
        <div className="flex shrink-0 gap-2 border-t border-gray-100 bg-white px-5 pt-3 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
          <button
            onClick={onReserve}
            className="flex-1 rounded-2xl bg-mint-500 py-3.5 text-sm font-black text-white shadow-lg shadow-mint-500/25 transition-transform active:scale-95"
          >
            예약하기
          </button>
          <button
            onClick={onPurchase}
            className="flex-1 rounded-2xl border-2 border-mint-500/40 bg-white py-3.5 text-sm font-black text-mint-600 transition-transform active:scale-95"
          >
            쿠폰 구매하기
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactElement; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>
      <p className="text-sm leading-relaxed text-gray-700 break-keep">
        <span className="text-gray-400">{label} </span>{value}
      </p>
    </div>
  );
}
