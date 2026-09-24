import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { searchAddress } from '@/services/kakaoMap';
import type { KakaoPlace, LocationEntry } from '@/types';
import { trackEvent } from '@/services/analytics';

interface Props {
  locations: LocationEntry[];
  onChange: (locations: LocationEntry[]) => void;
}

interface InputState {
  value: string;
  suggestions: KakaoPlace[];
  loading: boolean;
  selected: boolean;
  lat?: number;
  lng?: number;
}

function SuggestionDropdown({
  suggestions,
  anchorEl,
  onSelect,
}: {
  suggestions: KakaoPlace[];
  anchorEl: HTMLDivElement | null;
  onSelect: (place: KakaoPlace) => void;
}) {
  if (!suggestions.length || !anchorEl) return null;
  const rect = anchorEl.getBoundingClientRect();
  return createPortal(
    <div
      style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
    >
      {suggestions.map((place) => (
        <button
          key={place.id}
          onMouseDown={() => onSelect(place)}
          className="w-full text-left px-4 py-3 hover:bg-mint-100 transition-colors border-b border-gray-100 last:border-0"
        >
          <div className="text-sm font-medium text-gray-800">{place.place_name}</div>
          <div className="text-xs text-gray-400 mt-0.5">{place.road_address_name || place.address_name}</div>
        </button>
      ))}
    </div>,
    document.body
  );
}

export default function LocationInput({ locations, onChange }: Props) {
  const [inputs, setInputs] = useState<InputState[]>(
    locations.length >= 2
      // 좌표까지 옮겨야 한다 — 재마운트(뒤로 가기) 직후 마운트 effect가 이 배열을 부모에 되돌려 쓰기 때문
      ? locations.map((l) => ({ value: l.name, suggestions: [], loading: false, selected: true, lat: l.lat, lng: l.lng }))
      : [
          { value: '', suggestions: [], loading: false, selected: false },
          { value: '', suggestions: [], loading: false, selected: false },
        ]
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wrapperRefs = useRef<(HTMLDivElement | null)[]>([]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function handleFocus(index: number) {
    const el = inputRefs.current[index];
    if (!el) return;
    setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
  }

  function update(index: number, partial: Partial<InputState>) {
    setInputs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...partial };
      return next;
    });
  }

  function addInput() {
    setInputs((prev) => [...prev, { value: '', suggestions: [], loading: false, selected: false }]);
  }

  function removeInput(index: number) {
    setInputs((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleChange(index: number, value: string) {
    update(index, { value, selected: false, suggestions: [] });
    clearTimeout(timers.current[index]);
    if (value.length < 1) return;
    update(index, { loading: true });
    timers.current[index] = setTimeout(async () => {
      try {
        const results = await searchAddress(value);
        // 결과 0건 = 사용자가 친 지명 표현과 카카오 커버리지의 갭(별칭 사전 개선 신호). 검색어를 payload로 남긴다.
        if (results.length === 0) trackEvent('location_search_zero', { query: value.slice(0, 100) });
        update(index, { suggestions: results.slice(0, 5), loading: false });
      } catch {
        trackEvent('location_search_error'); // 검색 API 실패율
        update(index, { loading: false });
      }
    }, 200);
  }

  function selectPlace(index: number, place: KakaoPlace) {
    // 출발지는 사용자가 고른 정확한 좌표를 그대로 사용 (중간지점 계산 정확도)
    update(index, {
      value: place.place_name,
      suggestions: [],
      selected: true,
      loading: false,
      lat: parseFloat(place.y),
      lng: parseFloat(place.x),
    });
  }

  useEffect(() => {
    const selected = inputs
      .filter((i) => i.selected && i.value)
      .map((i) => ({ name: i.value, lat: i.lat, lng: i.lng }));
    onChange(selected);
  }, [inputs]);

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      {inputs.map((inp, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-mint-100 border border-mint-500/50 text-mint-500 text-xs font-black flex items-center justify-center flex-shrink-0">
            {i + 1}
          </span>
          <div
            ref={(el) => { wrapperRefs.current[i] = el; }}
            className="flex-1 relative"
          >
            <input
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              value={inp.value}
              onChange={(e) => handleChange(i, e.target.value)}
              onFocus={() => handleFocus(i)}
              placeholder={i === 0 ? '예: 성수역, 합정역...' : '예: 강남역, 이태원...'}
              className={`w-full pl-4 pr-9 py-3.5 rounded-xl border-2 text-sm outline-none transition-all duration-200 bg-white ${
                inp.selected ? 'border-mint-500 bg-mint-100' : 'border-gray-200 focus:border-mint-500'
              }`}
            />
            {inp.loading && (
              <div className="absolute inset-y-0 right-3 flex items-center">
                <div className="w-4 h-4 border-2 border-mint-500 border-t-transparent rounded-full animate-spin-slow" />
              </div>
            )}
            {inp.selected && !inp.loading && (
              <div className="absolute inset-y-0 right-3 flex items-center">
                <span className="text-mint-500 text-sm font-bold">✓</span>
              </div>
            )}
          </div>
          {inputs.length > 2 && (
            <button
              onClick={() => removeInput(i)}
              className="w-7 h-7 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center hover:bg-red-50 hover:text-red-400 transition-colors text-sm flex-shrink-0"
            >
              ×
            </button>
          )}
          <SuggestionDropdown
            suggestions={inp.suggestions}
            anchorEl={wrapperRefs.current[i] ?? null}
            onSelect={(place) => selectPlace(i, place)}
          />
        </div>
      ))}

      {inputs.length < 6 && (
        <button
          onClick={addInput}
          className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-mint-500/60 text-mint-500 text-sm font-medium hover:bg-mint-100 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          출발지 추가
        </button>
      )}
    </div>
  );
}
