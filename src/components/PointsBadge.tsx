import { useState } from 'react';
import { getDeviceId } from '@/storage/device';
import { getBalance, getLedger } from '@/storage/points';
import { trackEvent } from '@/services/analytics';
import { Icon } from '@/components/icons';

// 헤더 포인트 배지 + 탭 시 적립 내역 시트. 스토어는 아직 없음 — "곧 쓸 수 있다" 예고만.
// onOpenChange: 시트 열림 상태를 부모에 알린다(탭 화면에서 하단 탭바를 내리기 위해).
// 선택 prop이라 넘기지 않으면 동작·외형 모두 이전과 완전히 동일하다.
export default function PointsBadge({
  balance,
  onOpenChange,
}: {
  balance: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  function setSheetOpen(v: boolean) {
    setOpen(v);
    onOpenChange?.(v);
  }

  return (
    <>
      <button
        onClick={() => setSheetOpen(true)}
        aria-label="내 포인트"
        className="flex items-center gap-1 rounded-full bg-mint-100 border border-mint-500/40 px-2.5 py-1.5 text-xs font-black text-mint-600 active:scale-95 transition-transform"
      >
        <Icon name="leaf" className="text-sm" />
        {balance.toLocaleString()}P
      </button>
      {open && <PointsSheet onClose={() => setSheetOpen(false)} />}
    </>
  );
}

function PointsSheet({ onClose }: { onClose: () => void }) {
  const balance = getBalance();
  const ledger = getLedger();
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto bg-white rounded-t-3xl px-5 pt-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] max-h-[80vh] flex flex-col animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-black text-gray-900"><Icon name="leaf" className="mr-1" />내 포인트</h3>
          <button onClick={onClose} className="text-gray-400 text-sm font-bold px-2 active:scale-95">닫기</button>
        </div>
        <p className="text-3xl font-black text-mint-600 mb-3">{balance.toLocaleString()}P</p>

        {/* 스토어 예고 — 수요 검증(탭 계측) */}
        <button
          onClick={() => trackEvent('points_store_teaser_click', { device_id: getDeviceId(), balance })}
          className="w-full text-left bg-gradient-to-r from-mint-100 to-yellow-50 border border-mint-500/30 rounded-2xl px-4 py-3 mb-3 active:scale-[0.99] transition-transform"
        >
          <p className="text-sm font-black text-gray-800"><Icon name="gift" className="mr-1" />포인트 스토어 준비 중</p>
          <p className="text-xs text-gray-500 mt-0.5">방문 인증으로 쌓은 포인트를 곧 기프티콘·골목 쿠폰으로 바꿀 수 있어요.</p>
        </button>

        {ledger.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            아직 적립 내역이 없어요.<br />추천받은 곳에 방문하고 인증하면 포인트가 쌓여요.
          </p>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-2">
            {ledger.map((e, i) => (
              <div key={i} className="flex items-center justify-between bg-mint-50 border border-gray-100 rounded-xl px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{e.place_name || '방문 인증'}</p>
                  <p className="text-[11px] text-gray-400">
                    {new Date(e.at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                    {e.method === 'gps' ? ' · 위치 인증' : ' · 사진 인증'}
                  </p>
                </div>
                <span className="text-sm font-black text-mint-600 shrink-0">+{e.points}P</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
