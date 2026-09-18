import { useRef, useState } from 'react';
import { getDeviceId } from '@/storage/device';
import { placeKey, haversineMeters, creditVisit, VISIT_POINTS, CERT_RADIUS_M } from '@/storage/points';
import { trackEvent } from '@/services/analytics';

interface CertPlace {
  placeName?: string;
  address?: string;
  area?: string;
  lat?: number | null;
  lng?: number | null;
}

type Stage = 'ask' | 'checking' | 'success' | 'photo';

// 방문 인증 — GPS 근접(300m) 즉시 인증, 실패 시 사진 촬영 폴백(파일은 저장 안 함).
// 인증 성공 시 포인트 적립. 노쇼 방어는 벌이 아니라 당근.
export default function VisitCertModal({
  place, source, onClose, onCertified,
}: {
  place: CertPlace;
  source: 'result' | 'shared';
  onClose: () => void;
  onCertified: (newBalance: number) => void;
}) {
  const key = placeKey(place);
  const [stage, setStage] = useState<Stage>('ask');
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);

  function complete(method: 'gps' | 'photo', distance_m?: number) {
    const balance = creditVisit({
      place_key: key,
      place_name: place.placeName ?? '',
      points: VISIT_POINTS,
      method,
    });
    trackEvent('visit_cert_done', {
      device_id: getDeviceId(), place_key: key, method,
      distance_m: distance_m ?? null, points: VISIT_POINTS, source,
    });
    onCertified(balance);
    setStage('success');
  }

  function certifyByGps() {
    setError(null);
    if (!('geolocation' in navigator)) { fallbackToPhoto('gps_denied'); return; }
    const hasCoords = place.lat != null && place.lng != null && place.lat !== 0;
    setStage('checking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!hasCoords) { complete('gps'); return; } // 장소 좌표가 없으면 위치 요청 성공만으로 인증
        const dist = haversineMeters(pos.coords.latitude, pos.coords.longitude, place.lat!, place.lng!);
        if (dist <= CERT_RADIUS_M) {
          complete('gps', Math.round(dist));
        } else {
          trackEvent('visit_cert_fail', { device_id: getDeviceId(), place_key: key, reason: 'too_far', distance_m: Math.round(dist) });
          setStage('photo');
          setError(`아직 ${Math.round(dist).toLocaleString()}m 떨어져 있어요. 도착 후 다시 시도하거나 사진으로 인증해주세요.`);
        }
      },
      () => { fallbackToPhoto('gps_denied'); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  function fallbackToPhoto(reason: 'gps_denied' | 'too_far') {
    trackEvent('visit_cert_fail', { device_id: getDeviceId(), place_key: key, reason });
    setStage('photo');
    setError(reason === 'gps_denied' ? '위치 확인이 어려워요. 사진으로 인증해주세요.' : null);
  }

  function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    // 파일은 업로드·저장하지 않는다 — 촬영/선택 완료 사실만 기록(서버 부담 0, 자기신고)
    if (e.target.files && e.target.files.length > 0) complete('photo');
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-white rounded-t-3xl sm:rounded-3xl px-6 pt-6 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] text-center animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'success' ? (
          <>
            <div className="text-5xl mb-3">🎉</div>
            <p className="text-lg font-black text-gray-900">방문 인증 완료!</p>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              <span className="font-black text-mint-600">+{VISIT_POINTS}P</span> 적립됐어요.<br />
              쌓인 포인트는 곧 쿠폰·기프티콘으로 바꿀 수 있어요.
            </p>
            <button onClick={onClose} className="w-full mt-5 py-3.5 rounded-2xl bg-mint-500 text-white font-black active:scale-[0.98] transition-transform">
              확인
            </button>
          </>
        ) : (
          <>
            <div className="text-4xl mb-2">📍</div>
            <p className="text-lg font-black text-gray-900 leading-snug">
              {place.placeName ? `${place.placeName}에` : '이곳에'} 오셨나요?
            </p>
            <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
              위치만 확인하면 끝이에요. 인증하면 <span className="font-black text-mint-600">{VISIT_POINTS}P</span>를 드려요.
            </p>

            {error && <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2 mt-3 leading-relaxed">{error}</p>}

            {stage === 'checking' ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
                <div className="w-4 h-4 border-2 border-mint-500 border-t-transparent rounded-full animate-spin" />
                위치 확인 중...
              </div>
            ) : (
              <div className="flex flex-col gap-2 mt-5">
                {stage !== 'photo' && (
                  <button onClick={certifyByGps} className="w-full py-3.5 rounded-2xl bg-mint-500 text-white font-black active:scale-[0.98] transition-transform">
                    📍 위치로 인증하기
                  </button>
                )}
                <button
                  onClick={() => photoRef.current?.click()}
                  className={`w-full py-3.5 rounded-2xl font-black active:scale-[0.98] transition-transform ${
                    stage === 'photo' ? 'bg-mint-500 text-white' : 'bg-mint-100 text-mint-600'
                  }`}
                >
                  📷 사진으로 인증하기
                </button>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPhotoPicked}
                />
                <button onClick={onClose} className="w-full py-2 text-sm text-gray-400 font-bold">나중에</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
