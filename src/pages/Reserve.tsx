import { useState } from 'react';
import { trackEvent } from '@/services/analytics';
import { Icon } from '@/components/icons';

export interface ReservationRecord {
  id: string;
  placeName: string;
  address: string;
  guestName: string;
  people: string;
  arrivalTime: string;
  createdAt: string;
}

interface Props {
  placeName: string;
  address: string;
  openingHours: string;
  onBack: () => void;
}

export default function Reserve({ placeName, address, openingHours, onBack }: Props) {
  // 자체 예약 연동은 준비 중 — 타이핑 없이 원탭으로 '수요'만 집계한다(이름·인원 입력 제거).
  const [requested, setRequested] = useState(false);

  function requestInterest() {
    fetch('/api/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeName, address, guestName: '관심표시', people: '-' }),
    }).catch(() => {});
    trackEvent('reservation_attempt');
    setRequested(true);
  }

  return (
    <div className="min-h-screen bg-mint-50">
      <div className="max-w-md mx-auto px-4 pt-6 pb-16">

        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            aria-label="돌아가기"
            className="w-10 h-10 rounded-2xl border-2 border-gray-200 bg-white flex items-center justify-center text-gray-500 font-bold active:scale-95 transition-transform"
          >
            ←
          </button>
          <h1 className="text-lg font-black text-gray-800">예약하러 가기</h1>
        </div>

        {/* 장소 정보 */}
        <div className="bg-white rounded-2xl border-2 border-gray-100 p-4 mb-4">
          <span className="text-xs font-bold text-mint-500 bg-mint-100 px-2 py-0.5 rounded-full">예약 장소</span>
          <div className="mt-2 font-black text-gray-800 text-lg">{placeName}</div>
          {address && <div className="text-sm text-gray-500 mt-1"><Icon name="pin" className="mr-1" />{address}</div>}
          {openingHours && <div className="text-sm text-gray-500 mt-0.5"><Icon name="clock" className="mr-1" />{openingHours}</div>}
        </div>

        {/* ── 주 CTA: 예약 플랫폼 바로가기 (입점 매장이면 그 자리에서 예약 완료) ── */}
        <div className="bg-white rounded-2xl border-2 border-mint-500/40 p-4 mb-4 shadow-sm">
          <p className="text-base font-black text-gray-800 mb-1"><Icon name="bolt" className="mr-1" />바로 예약하기</p>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">예약 앱에 입점한 매장이면 여기서 바로 예약할 수 있어요</p>
          <div className="flex flex-col gap-2">
            <a
              href={`https://app.catchtable.co.kr/ct/search?keyword=${encodeURIComponent(placeName)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackEvent('reserve_deeplink_catchtable')}
              className="flex items-center justify-center gap-1.5 py-3.5 rounded-xl bg-[#FF3D00]/5 border-2 border-[#FF3D00]/25 text-[#E63600] text-sm font-black active:scale-95 transition-all hover:border-[#FF3D00]/45"
            >
              <Icon name="meal" />캐치테이블에서 예약
            </a>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`https://map.naver.com/p/search/${encodeURIComponent(placeName)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackEvent('reserve_deeplink_naver')}
                className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-naver/5 border-2 border-naver/25 text-[#02A64B] text-sm font-black active:scale-95 transition-all hover:border-naver/45"
              >
                N 네이버
              </a>
              <a
                href={`https://map.kakao.com/link/search/${encodeURIComponent(placeName)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackEvent('reserve_deeplink_kakaomap')}
                className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-kakao/20 border-2 border-kakao text-gray-800 text-sm font-black active:scale-95 transition-all"
              >
                카카오맵
              </a>
            </div>
          </div>
        </div>

        {/* ── 보조: 원탭 수요조사 (타이핑 없음) ── */}
        {requested ? (
          <div className="bg-mint-100 border border-mint-500/30 rounded-2xl px-4 py-4 text-center animate-fade-in-up">
            <Icon name="thanks" className="text-3xl mb-1.5 text-mint-500" />
            <p className="text-sm font-black text-mint-600">관심 감사해요!</p>
            <p className="text-xs text-mint-600/80 mt-0.5 leading-relaxed">
              MINT 안에서 끝나는 예약 연동 우선순위에 반영했어요.
            </p>
          </div>
        ) : (
          <button
            onClick={requestInterest}
            className="w-full bg-white border-2 border-mint-500/40 rounded-2xl px-4 py-3.5 text-left active:scale-[0.99] transition-transform hover:border-mint-500"
          >
            <p className="text-sm font-black text-mint-600"><Icon name="sprout" className="mr-1" />MINT에서 바로 예약하고 싶어요</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              한 번 눌러주시면 자체 예약 연동 우선순위에 반영돼요 (입력 없이 끝!)
            </p>
          </button>
        )}
      </div>
    </div>
  );
}
