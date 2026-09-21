import { useState, useRef, useEffect } from 'react';
import { searchRegions, matchHotplaces } from '@/services/kakaoMap';
import type { RegionSuggestion, RegionLevel, MeetingLocation } from '@/types';
import { ensureKakaoMaps } from '@/services/kakaoLoader';
import AnchoredDropdown from '@/components/AnchoredDropdown';

interface Props {
  value: MeetingLocation | null;
  onSelect: (loc: MeetingLocation | null) => void;
}

const HOT_REGIONS = [
  { id: 'seongsu',    label: '성수/건대', desc: '성수역·건대입구·뚝섬' },
  { id: 'hongdae',    label: '홍대/마포', desc: '홍대입구·합정·망원'   },
  { id: 'myeongdong', label: '명동/시청', desc: '명동·을지로·중구'      },
];

const MORE_REGIONS = [
  { id: 'gangnam',  label: '강남/서초',   desc: '강남역·서초역·교대'   },
  { id: 'itaewon',  label: '이태원/한남', desc: '이태원역·한남동'       },
  { id: 'jongno',   label: '종로/혜화',   desc: '종각역·인사동·광화문' },
  { id: 'yeouido',  label: '여의도',      desc: '여의도역·IFC몰'        },
  { id: 'sinchon',  label: '신촌/연대',   desc: '신촌역·이대역·연세대' },
  { id: 'jamsil',   label: '잠실/송파',   desc: '잠실역·롯데월드'       },
];

// 레벨 배지 라벨/색상 — 시(전체)/구/동 범위를 한눈에
const LEVEL_BADGE: Record<RegionLevel, { text: string; cls: string }> = {
  city:     { text: '시 전체', cls: 'bg-mint-100 text-mint-600' },
  district: { text: '구 전체', cls: 'bg-blue-50 text-blue-500' },
  dong:     { text: '동',      cls: 'bg-amber-50 text-amber-600' },
};

function badgeFor(s: RegionSuggestion): { text: string; cls: string } {
  if (s.kind === 'hotplace') return { text: '🔥 핫플', cls: 'bg-rose-50 text-rose-500' };
  if (s.kind === 'station') return { text: '🚇 역', cls: 'bg-indigo-50 text-indigo-500' };
  return LEVEL_BADGE[s.level];
}

// 행정단위(시/구/동) 자동완성 드롭다운 — 위치 추적(리사이즈·스크롤·줌)은 AnchoredDropdown이 맡는다
function SuggestionDropdown({
  suggestions,
  getAnchor,
  onPick,
}: {
  suggestions: RegionSuggestion[];
  getAnchor: () => HTMLElement | null;
  onPick: (s: RegionSuggestion) => void;
}) {
  return (
    <AnchoredDropdown open={suggestions.length > 0} getAnchor={getAnchor} maxHeight={320}>
      {suggestions.map((s) => {
        const badge = badgeFor(s);
        return (
          <button
            key={`${s.level}:${s.label}`}
            onMouseDown={() => onPick(s)}
            className="w-full text-left px-4 py-3 hover:bg-mint-100 transition-colors border-b border-gray-100 last:border-0 flex items-center gap-2"
          >
            <span className="text-sm">📍</span>
            <span className="text-sm font-medium text-gray-800 flex-1 truncate">{s.label}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.cls}`}>{badge.text}</span>
          </button>
        );
      })}
    </AnchoredDropdown>
  );
}

export default function MeetingLocationSelect({ value, onSelect }: Props) {
  // 검색어는 검색에만 쓴다. 확정된 지역은 value(부모)에만 있고, 확정 상태에서는 입력창 대신 칩을 그린다 —
  // 자유 입력이 값이 될 수 없으므로 없는 지역이 들어가거나, 글자를 지웠는데 선택이 남는 일이 구조적으로 없다.
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<RegionSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  // 카카오 SDK 프리로드 — 첫 타이핑에서 스크립트 로딩 지연이 없게 미리 붙인다
  useEffect(() => { ensureKakaoMaps().catch(() => {}); }, []);

  // 직접 입력 검색으로 좌표가 확정된 상태인지
  const customSelected =
    value?.type === 'manual' && value.regionId === '' && value.lat != null && value.lng != null;

  function handleSearchChange(v: string) {
    setSearch(v);
    // 타이핑을 시작하면 자동·프리셋 선택은 해제 — 검색으로 갈아타는 중이므로 제안을 고를 때까지 '다음'을 잠근다
    if (value) onSelect(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const t = v.trim();
    if (t.length < 1) { setSuggestions([]); setSearching(false); return; }
    // 1단계(즉시): 핫플레이스는 네트워크 없이 같은 프레임에 바로 노출
    setSuggestions(matchHotplaces(t));
    setSearching(true);
    const seq = ++reqSeq.current;
    // 2단계(150ms 디바운스): 카카오 결과까지 합쳐 갱신 (팝업을 비우지 않고 교체)
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchRegions(t);
        if (seq === reqSeq.current && results.length) setSuggestions(results);
      } catch { /* ignore */ }
      finally { if (seq === reqSeq.current) setSearching(false); }
    }, 150);
  }

  // 시/구/동 제안 선택 → 그 행정단위 스코프로 확정 (추천이 그 범위 안에서만 검색됨)
  function pickPlace(s: RegionSuggestion) {
    setSearch(s.label);
    setSuggestions([]);
    setSearching(false);
    onSelect({
      type: 'manual',
      regionId: '',
      area: s.label,
      lat: s.lat,
      lng: s.lng,
      scope: { level: s.level, matchTokens: s.matchTokens, searchAreas: s.searchAreas },
    });
  }

  function isManualSelected(regionId: string) {
    return value?.type === 'manual' && (value as { type: 'manual'; regionId: string }).regionId === regionId;
  }

  // 칩의 ✕ — 확정 해제 후 빈 검색창으로 복귀
  function clearCustom() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearch('');
    setSuggestions([]);
    setSearching(false);
    onSelect(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function selectPreset(id: string, label: string) {
    setSearch('');
    setSuggestions([]);
    onSelect({ type: 'manual', regionId: id, area: label });
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-4">
      {/* 자동 중간지점 카드 */}
      <button
        onClick={() => { setSearch(''); setSuggestions([]); onSelect({ type: 'auto' }); }}
        className={`w-full text-left rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-all shadow-lg shadow-mint-500/25 ${
          value?.type === 'auto'
            ? 'bg-mint-500 border-4 border-mint-600'
            : 'bg-mint-500'
        }`}
      >
        <div className="text-2xl">🧭</div>
        <div className="flex-1">
          <div className="font-black text-white text-base">자동 중간지점 찾기</div>
          <div className="text-xs text-white/80 mt-0.5">모두의 이동거리를 계산해 가장 공평한 곳으로</div>
        </div>
        <div className="text-xs font-bold text-mint-500 bg-white px-2.5 py-1 rounded-full flex-shrink-0">
          추천
        </div>
      </button>

      <div className="bg-white rounded-2xl border-2 border-gray-100 shadow-sm p-4 flex flex-col gap-4">

        {/* 카드 헤더 */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-mint-100 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="stroke-mint-500" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <div className="flex-1">
            <div className="font-black text-gray-800 text-base">직접 입력하기</div>
            <div className="text-xs text-gray-400 mt-0.5">시·구·동 단위로 검색해 목록에서 선택 (범위만큼 추천)</div>
          </div>
        </div>

        {/* 검색창 — 자동완성(출발지 검색과 동일). 확정되면 입력창 자리에 칩이 들어가고 ✕로만 해제한다 */}
        <div ref={wrapperRef} className="relative">
          {customSelected ? (
            <div
              role="status"
              className="w-full flex items-center gap-2 pl-4 pr-2 py-2.5 rounded-xl border-2 border-mint-500 bg-mint-100"
            >
              <span className="text-mint-500 text-sm font-bold shrink-0">✓</span>
              <span className="flex-1 min-w-0 truncate text-sm font-bold text-gray-800" title={(value as { area: string }).area}>
                {(value as { area: string }).area}
              </span>
              <button
                type="button"
                onClick={clearCustom}
                aria-label="선택한 지역 지우기"
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-white active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="예: 인천 · 인천 미추홀구 · 인천 미추홀구 학익동"
                className="w-full pl-4 pr-9 py-3 rounded-xl border-2 border-mint-500 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-mint-500/20 transition-colors bg-white"
              />
              {searching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="w-4 h-4 border-2 border-mint-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <SuggestionDropdown suggestions={suggestions} getAnchor={() => wrapperRef.current} onPick={pickPlace} />
            </>
          )}
        </div>
        {customSelected && (
          <p className="-mt-2 text-xs text-mint-600 font-medium">📍 {(value as { area: string }).area} 범위 안에서 추천해요</p>
        )}

        {/* 핫 지역 */}
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
            🔥 지금 핫한 지역
          </p>
          <div className="grid grid-cols-3 gap-2">
            {HOT_REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => selectPreset(r.id, r.label)}
                className={`rounded-xl border-2 px-3 py-2.5 text-center active:scale-[0.97] transition-all ${
                  isManualSelected(r.id)
                    ? 'border-mint-500 bg-mint-100'
                    : 'border-gray-200 bg-white hover:border-mint-500'
                }`}
              >
                <div className="text-sm font-black text-gray-800 truncate">{r.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 더 많은 지역 */}
        {!showMore ? (
          <button
            onClick={() => setShowMore(true)}
            className="text-center text-xs text-mint-500 font-bold hover:text-mint-600 transition-colors py-0.5"
          >
            다른 지역 선택하기 →
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2 animate-fade-in-up">
            {MORE_REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => selectPreset(r.id, r.label)}
                className={`rounded-xl border-2 px-3 py-2.5 text-center active:scale-[0.97] transition-all ${
                  isManualSelected(r.id)
                    ? 'border-mint-500 bg-mint-100'
                    : 'border-gray-200 bg-white hover:border-mint-500'
                }`}
              >
                <div className="text-sm font-black text-gray-800 truncate">{r.label}</div>
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
