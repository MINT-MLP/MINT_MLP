import { useEffect, useRef } from 'react';
import { ensureKakaoMaps } from '@/utils/kakaoLoader';
import type { MapPin } from '@/types';
import { MINT_HEX } from '@/constants/colors';

interface Props {
  lat: number;
  lng: number;
  placeName: string;
  /** 있으면 코스 전체(1차·2차·대안)를 한 지도에 그린다. 없으면 단일 핀(기존 동작). */
  pins?: MapPin[];
}

// 지도 위에 얹는 오버레이 HTML — 1차/2차는 색 필 배지, 대안은 회색 점
function pinContent(pin: MapPin): string {
  if (pin.kind === 'alt') {
    return `<div title="${pin.name}" style="width:11px;height:11px;border-radius:50%;background:#9CA3AF;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);"></div>`;
  }
  // 카카오 지도 오버레이/폴리라인은 CSS 변수를 못 읽어 헥스 상수를 쓴다 (constants/colors.ts)
  const bg = pin.kind === 'first' ? MINT_HEX[500] : pin.kind === 'third' ? MINT_HEX[900] : MINT_HEX[800];
  const label = pin.kind === 'first' ? '1차' : pin.kind === 'third' ? '3차' : '2차';
  const shortName = pin.name.length > 10 ? `${pin.name.slice(0, 10)}…` : pin.name;
  return `<div style="display:flex;align-items:center;gap:4px;background:${bg};color:#fff;font-weight:800;font-size:11px;padding:3px 9px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.28);font-family:'Pretendard',sans-serif;white-space:nowrap;transform:translateY(-6px);">${label} · ${shortName}</div>`;
}

interface KakaoMapObj {
  setCenter(latlng: unknown): void;
  setLevel(level: number): void;
  setBounds(bounds: unknown, ...padding: number[]): void;
}

export default function MiniMap({ lat, lng, placeName, pins }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // 오버레이/폴리라인을 모아뒀다가 다음 렌더에서 일괄 제거
  const mapInstance = useRef<KakaoMapObj | null>(null);
  const overlaysRef = useRef<{ setMap: (m: unknown) => void }[]>([]);

  const effectivePins: MapPin[] =
    pins && pins.length > 0 ? pins : [{ lat, lng, name: placeName, kind: 'first' }];

  function renderMap() {
    if (!mapRef.current || !window.kakao?.maps) return;
    const kakao = window.kakao;
    const center = new kakao.maps.LatLng(effectivePins[0].lat, effectivePins[0].lng);

    if (!mapInstance.current) {
      mapInstance.current = new kakao.maps.Map(mapRef.current, { center, level: 4 });
    }
    const map = mapInstance.current;
    if (!map) return;

    // 이전 오버레이 정리
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    // 1차→2차 도보 동선 (점선) — 오버레이보다 먼저 그려 배지가 위에 오게
    const first = effectivePins.find((p) => p.kind === 'first');
    const second = effectivePins.find((p) => p.kind === 'second');
    if (first && second) {
      const line = new kakao.maps.Polyline({
        map,
        path: [
          new kakao.maps.LatLng(first.lat, first.lng),
          new kakao.maps.LatLng(second.lat, second.lng),
        ],
        strokeWeight: 3,
        strokeColor: MINT_HEX[500],
        strokeOpacity: 0.85,
        strokeStyle: 'shortdash',
      });
      overlaysRef.current.push(line);
    }

    // 대안(회색 점)을 먼저, 1차/2차 배지를 나중에 올려 겹칠 때 배지가 위로
    const ordered = [...effectivePins].sort((a, b) => (a.kind === 'alt' ? -1 : 1) - (b.kind === 'alt' ? -1 : 1));
    for (const pin of ordered) {
      const overlay = new kakao.maps.CustomOverlay({
        map,
        position: new kakao.maps.LatLng(pin.lat, pin.lng),
        content: pinContent(pin),
        yAnchor: pin.kind === 'alt' ? 0.5 : 1,
        zIndex: pin.kind === 'alt' ? 1 : pin.kind === 'second' ? 2 : 3,
      });
      overlaysRef.current.push(overlay);
    }

    // 핀이 여러 개면 전부 들어오게 화면 맞춤, 하나면 센터 고정
    if (effectivePins.length > 1) {
      const bounds = new kakao.maps.LatLngBounds();
      effectivePins.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
      map.setBounds(bounds, 36, 36, 36, 36);
    } else {
      map.setCenter(center);
      map.setLevel(4);
    }
  }

  useEffect(() => {
    let active = true;
    ensureKakaoMaps()
      .then(() => { if (active) renderMap(); })
      .catch(() => { /* SDK 로드 실패 시 지도 없이 링크만 노출 */ });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, placeName, JSON.stringify(pins ?? [])]);

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
      <div ref={mapRef} className="w-full h-52" />
      <a
        href={`https://map.kakao.com/link/map/${encodeURIComponent(placeName)},${lat},${lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 py-2.5 bg-kakao text-[#3A1D1D] text-sm font-bold hover:bg-[#FFD700] transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
        </svg>
        카카오맵에서 길찾기
      </a>
    </div>
  );
}
