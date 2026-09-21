import { useState, useRef, useEffect } from 'react';
import { searchAddress } from '@/services/kakaoMap';
import type { KakaoPlace, VibeState, GroupResult, GuestCtx } from '@/types';
import { VibeSelect, StepProgress, GroupResultView, AnchoredDropdown } from '@/components';
import { VIBE_KEY_TO_LABEL } from '@/constants/vibeOptions';
// SECOND_KEYWORD_PREFIX는 더 이상 생성하지 않는다(1차/2차 키워드 입력 통합).
// 파싱 쪽(groupAggregate)은 그대로 둔다 — 배포 시점에 구버전 링크로 제출 중인 게스트가 있을 수 있다.
import { EXCLUDE_FOOD_PREFIX, SECOND_VIBE_PREFIX } from '@/utils/groupAggregate';
import { decodeHostContext } from '@/utils/groupLink';
import type { HostContext } from '@/utils/groupLink';
import { trackEvent } from '@/services/analytics';
import { getDeviceId } from '@/storage/device';

type Phase = 'step0' | 'step1' | 'step2' | 'done';

// 출발지 자동완성 드롭다운 — 위치 추적(리사이즈·스크롤·줌)은 AnchoredDropdown이 맡는다
function SuggestionDropdown({
  suggestions,
  getAnchor,
  onSelect,
}: {
  suggestions: KakaoPlace[];
  getAnchor: () => HTMLElement | null;
  onSelect: (place: KakaoPlace) => void;
}) {
  return (
    <AnchoredDropdown open={suggestions.length > 0} getAnchor={getAnchor}>
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
    </AnchoredDropdown>
  );
}

// 호스트가 정한 코스 텍스트 ("밥 → 술") + 지역 텍스트
function courseText(ctx: HostContext | null): string {
  if (!ctx?.purposeFirst) return '';
  const first = ctx.firstGenre ? `${ctx.purposeFirst}(${ctx.firstGenre})` : ctx.purposeFirst;
  const hasSecond = ctx.purposeSecond && ctx.purposeSecond !== '없음';
  if (!hasSecond) return first;
  const second = ctx.secondGenre ? `${ctx.purposeSecond}(${ctx.secondGenre})` : ctx.purposeSecond!;
  return `${first} → ${second}`;
}
function regionText(ctx: HostContext | null): string {
  if (!ctx) return '';
  return ctx.regionType === 'auto' ? '중간지점 자동 계산' : (ctx.regionName || '호스트 지정 지역');
}

// 호스트가 정한 코스·지역을 보여주는 읽기 전용 배너
function HostContextBanner({ ctx }: { ctx: HostContext | null }) {
  if (!ctx?.purposeFirst) return null;
  return (
    <div className="mx-5 mb-1 bg-mint-100 border border-mint-500/40 rounded-2xl px-4 py-3">
      <p className="text-[10px] font-bold text-mint-600 uppercase tracking-widest mb-1.5">호스트가 정한 모임</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1 font-bold text-gray-800">🍀 {courseText(ctx)}</span>
        <span className="flex items-center gap-1 font-bold text-gray-800">📍 {regionText(ctx)}</span>
      </div>
    </div>
  );
}

export default function MemberInput() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('id');
  // 호스트가 링크에 실어 보낸 코스·지역 컨텍스트 (구버전 링크는 null)
  const [hostCtx] = useState<HostContext | null>(() => decodeHostContext(params));
  // 중간지점 자동 모드에서만 출발지 입력을 받는다. 컨텍스트 없는 구버전 링크는 안전하게 출발지 요구.
  const showLocation = !hostCtx || hostCtx.regionType === 'auto';

  const [phase, setPhase] = useState<Phase>('step0');
  const [name, setName] = useState('');

  // 출발지
  const [locValue, setLocValue] = useState('');
  const [locSelected, setLocSelected] = useState(false);
  const [locLat, setLocLat] = useState<number | null>(null);
  const [locLng, setLocLng] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<KakaoPlace[]>([]);
  const [searching, setSearching] = useState(false);

  // 분위기 + 예산 + 키워드 + 편식
  const [vibe, setVibe] = useState<VibeState>({});
  const [budget, setBudget] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [excludeFoods, setExcludeFoods] = useState<string[]>([]);

  // 참석 여부는 따로 묻지 않는다 — 링크를 열고 조건까지 넣어 제출했다면 그게 곧 참석이다.
  // 링크에 실려온 마감시각(rsvp_by)은 "마감 전에 냈는지" 지표로만 남긴다.
  const rsvpBy = (() => { const v = Number(params.get('rsvp_by')); return Number.isFinite(v) && v > 0 ? v : null; })();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 세션 정보 (완료 화면 현황)
  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  const [members, setMembers] = useState<{ member_name: string }[]>([]);
  const [groupResult, setGroupResult] = useState<GroupResult | null>(null); // 호스트가 추천을 받으면 폴링으로 수신
  // 게스트 본인 컨텍스트(출발지·취향) — 제출 시 localStorage에 심어 새로고침(결과 도착 시점) 후에도 살린다.
  // 개인 이동시간·길찾기·"내 취향 반영" 배너의 원천.
  const [guestCtx, setGuestCtx] = useState<GuestCtx | null>(null);
  const [placeChangedToast, setPlaceChangedToast] = useState(false); // 호스트가 장소를 바꾸면 알림
  // 호스트가 링크를 무효화한 세션 — 계속 "다 모이면 추천해요"라고 기다리게 두면 안 된다
  const [cancelled, setCancelled] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const locInputRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevResultNameRef = useRef<string | null>(null); // 폴링 중 1차 상호 변경 감지용

  // 이미 제출했으면 done으로. 제출 시 저장한 게스트 컨텍스트도 복원(새로고침 대비).
  // '제출했음' 플래그는 반드시 localStorage — 카톡 인앱브라우저를 닫으면 sessionStorage는 통째로 사라져서
  // 결과 보러 링크를 다시 누른 게스트에게 입력 화면이 다시 뜨고, 채워 제출하면 정원을 하나 더 먹는 중복 멤버가 된다.
  // (sessionStorage 조회는 배포 직전 버전으로 이미 제출한 탭을 위한 1회성 폴백)
  useEffect(() => {
    if (!sessionId) return;
    if (localStorage.getItem(`mint_joined_${sessionId}`) || sessionStorage.getItem(`mint_joined_${sessionId}`)) setPhase('done');
    try {
      const raw = localStorage.getItem(`mint_guest_ctx_${sessionId}`);
      if (raw) setGuestCtx(JSON.parse(raw) as GuestCtx);
    } catch { /* ignore */ }
  }, [sessionId]);

  // done 화면 폴링 — 결과 도착 전에만 3초 간격으로 돈다.
  // 결과를 받으면 주기 폴링을 멈춘다(호스트 폴링도 결과 화면에선 멈춘다): 결과 화면을 켜둔 게스트마다
  // 분당 6요청이 무기한 쌓였다. 대신 탭으로 돌아올 때만 1회 조회해, 호스트가 재추천으로 장소를 바꾼 경우의
  // 변경 알림은 그대로 살린다.
  // 호스트가 링크를 무효화하면(status==='cancelled') 대기 화면 대신 취소 안내를 띄우고 폴링도 멈춘다.
  const hasResult = !!groupResult;
  useEffect(() => {
    if (phase !== 'done' || !sessionId || cancelled) return;
    let active = true;

    async function poll() {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId!)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        // status는 신버전 서버에만 있다 — 없으면(구버전) 기존 동작 그대로.
        if (data.status === 'cancelled') { setCancelled(true); return; }
        setExpectedCount(data.expected_count ?? null);
        setMembers(Array.isArray(data.members) ? data.members : []);
        // 호스트가 추천을 완료하면 결과가 실려온다 — 게스트 화면을 결과 뷰로 전환(협업 루프 완결)
        const incoming = data.result_json?.first?.placeName as string | undefined;
        if (incoming) {
          // 이미 결과를 보던 중 호스트가 재추천으로 장소를 바꾸면 조용한 교체 대신 알림 토스트
          if (prevResultNameRef.current && prevResultNameRef.current !== incoming) {
            setPlaceChangedToast(true);
            setTimeout(() => setPlaceChangedToast(false), 5000);
          }
          prevResultNameRef.current = incoming;
          setGroupResult(data.result_json as GroupResult);
        }
      } catch { /* ignore */ }
    }

    poll();
    // 결과가 오면 주기 폴링 종료. 탭 복귀 시 1회 조회만 유지(장소 변경 감지용).
    const interval = hasResult ? null : setInterval(poll, 3000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, sessionId, hasResult, cancelled]);

  function handleLocChange(value: string) {
    setLocValue(value);
    setLocSelected(false);
    setLocLat(null);
    setLocLng(null);
    setSuggestions([]);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.length < 1) return;
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchAddress(value);
        setSuggestions(results.slice(0, 5));
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 200);
  }

  function selectPlace(place: KakaoPlace) {
    // 출발지는 사용자가 고른 정확한 좌표를 그대로 사용 (중간지점 계산 정확도)
    setLocValue(place.place_name);
    setLocLat(parseFloat(place.y));
    setLocLng(parseFloat(place.x));
    setLocSelected(true);
    setSuggestions([]);
    setSearching(false);
  }

  const canGoStep1 = name.trim().length > 0 && (!showLocation || (locSelected && locLat != null && locLng != null));

  async function handleSubmit() {
    if (!sessionId) {
      setError('잘못된 링크예요. 호스트에게 링크를 다시 받아주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 멤버가 고른 vibe 전체(분위기·취향 그룹의 1·2차 모두) 수집.
      // 대표 분위기 1개만 vibe_atmosphere로 보내면 취향·2차 선택이 유실되므로,
      // 대표 1개는 집계 투표용으로, 나머지는 라벨로 vibe_keywords에 실어 추천에 빠짐없이 반영한다.
      // 집계(vibe_atmosphere)는 대표 1개만 받으므로 '분위기' 1차의 첫 칩을 대표로 세운다.
      const allFirstKeys = Object.values(vibe).flatMap((g) => g.first);
      const secondVibeKeys = Object.values(vibe).flatMap((g) => g.second);
      const primaryAtm = vibe['분위기']?.first[0] ?? allFirstKeys[0] ?? null;
      // 조건도 여기 실어 보낸다 — 코스 구분이 없어 2차 접두사를 붙이지 않는다
      const extraVibeLabels = [...allFirstKeys.filter((k) => k !== primaryAtm), ...conditions]
        .map((k) => VIBE_KEY_TO_LABEL[k] ?? k);

      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          session_id: sessionId,
          member_name: name.trim(),
          // 같은 기기가 다시 제출하면 새 멤버가 아니라 '수정'으로 처리되게 하는 열쇠.
          // (서버가 device_id를 몰라도 그냥 무시되므로 구버전 서버에서도 안전하다)
          device_id: getDeviceId(),
          // 출발지는 중간지점 모드에서만 전송 — 임의 지역 모드는 좌표 없이 참여
          ...(showLocation && locLat != null && locLng != null
            ? { location_name: locValue, location_lat: locLat, location_lng: locLng }
            : {}),
          // 코스는 호스트가 정한 값을 그대로 실어 멤버 기록을 일관되게 유지
          purpose_first: hostCtx?.purposeFirst ?? null,
          purpose_second: hostCtx?.purposeSecond && hostCtx.purposeSecond !== '없음' ? hostCtx.purposeSecond : null,
          vibe_atmosphere: primaryAtm,
          vibe_budget: budget,
          vibe_keywords: (() => {
            // 대표 외 vibe + 편의시설 키워드 + 편식(접두사) 모두 합쳐 전송. 편식은 호스트가 집계 시 분리.
            const all = [
              ...extraVibeLabels,
              ...secondVibeKeys.map((k) => `${SECOND_VIBE_PREFIX}${k}`),
              ...keywords,
              ...excludeFoods.map((f) => `${EXCLUDE_FOOD_PREFIX}${f}`),
            ];
            return all.length > 0 ? Array.from(new Set(all)) : null;
          })(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '제출에 실패했어요. 다시 시도해주세요.');
      }
      try { localStorage.setItem(`mint_joined_${sessionId}`, '1'); } catch { /* 저장 실패해도 제출은 끝났다 */ }
      // 제출 자체가 참석 확정 — events(그룹 실사용 조사 지표) + localStorage(재진입 시 복원)
      const rsvpValue = 'going';
      trackEvent('rsvp_submit', {
        device_id: getDeviceId(),
        group_key: sessionId,
        rsvp: rsvpValue,
        deadline_at: rsvpBy,
        submitted_before_deadline: rsvpBy == null ? null : Date.now() <= rsvpBy,
      });
      try { localStorage.setItem(`mint_rsvp_${sessionId}`, rsvpValue); } catch { /* ignore */ }
      // 게스트 본인 컨텍스트 저장 — 결과 도착 시점의 새로고침에도 개인 이동시간·취향 배너가 살아남게.
      const myChips = [
        ...Object.values(vibe).flatMap((g) => [...g.first, ...g.second]),
        ...conditions,
      ].map((k) => VIBE_KEY_TO_LABEL[k] ?? k);
      const ctx: GuestCtx = {
        locName: showLocation ? locValue || null : null,
        locLat: showLocation ? locLat : null,
        locLng: showLocation ? locLng : null,
        chips: myChips,
        budget,
        excludeFoods,
      };
      try { localStorage.setItem(`mint_guest_ctx_${sessionId}`, JSON.stringify(ctx)); } catch { /* ignore */ }
      setGuestCtx(ctx);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!sessionId) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-mint-50 px-6 text-center">
        <p className="text-2xl mb-3">🔗</p>
        <p className="font-bold text-gray-800 mb-1">유효하지 않은 링크예요</p>
        <p className="text-sm text-gray-400">호스트에게 참여 링크를 다시 받아주세요.</p>
      </div>
    );
  }

  // 내가 고른 취향 요약 (완료 화면용)
  const myVibeLabels = [
    ...Object.values(vibe).flatMap((g) => [...g.first, ...g.second]),
    ...conditions,
  ].map((k) => VIBE_KEY_TO_LABEL[k] ?? k);

  if (phase === 'done') {
    const total = expectedCount ?? members.length;
    // 이 기기가 호스트(그룹 세션을 만든 사람)인지 판별 — 그러면 입력 후 호스트 화면으로 복귀 CTA를 보여준다.
    const isHostDevice = (() => {
      try {
        const raw = localStorage.getItem('mint_group_session_v1');
        return !!raw && !!sessionId && (JSON.parse(raw) as { sessionId?: string })?.sessionId === sessionId;
      } catch { return false; }
    })();
    // 게스트: 호스트가 추천을 완료했으면 결과 뷰로 전환(호스트는 자기 결과를 앱에서 봄)
    if (!isHostDevice && groupResult) {
      const ctx: GuestCtx = guestCtx ?? {
        locName: showLocation ? locValue || null : null,
        locLat: showLocation ? locLat : null,
        locLng: showLocation ? locLng : null,
        chips: [...myVibeLabels, ...keywords],
        budget,
        excludeFoods,
      };
      return <GroupResultView result={groupResult} guest={ctx} placeChanged={placeChangedToast} />;
    }
    // 호스트가 링크를 무효화했다 — 이미 받은 결과가 있으면 그건 그대로 보여주고(위 분기),
    // 결과 없이 기다리는 중이었다면 여기서 끊어준다. 끝나지 않는 대기 화면이 최악이다.
    if (cancelled) {
      return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-mint-50 px-6 text-center">
          <p className="text-3xl mb-3">🙏</p>
          <p className="font-black text-gray-800 mb-1.5">호스트가 초대를 취소했어요</p>
          <p className="text-sm text-gray-400 leading-relaxed">
            코스나 지역이 바뀌었을 수 있어요.<br />호스트에게 새 링크를 받아주세요.
          </p>
        </div>
      );
    }
    return (
      <div className="min-h-[100dvh] flex flex-col items-center bg-mint-50 px-6 pt-12 pb-10">
        <div className="w-16 h-16 rounded-full bg-mint-500 flex items-center justify-center mb-5 shadow-lg shadow-mint-500/30">
          <span className="text-white text-3xl font-black">✓</span>
        </div>
        <h1 className="text-xl font-black text-gray-800 mb-1">제출 완료!</h1>
        <p className="text-sm text-gray-500 mb-6 text-center">
          {isHostDevice
            ? members.length >= 2
              ? `현재 ${members.length}명 입력 완료! 바로 장소를 추천받아보세요.`
              : `현재 ${members.length}명 입력 완료 · 2명부터 추천받을 수 있어요.`
            : '다 모이면 호스트가 추천을 시작해요. 결과는 단톡방에서 확인하세요!'}
        </p>

        {/* 호스트 전용 — 완료 화면에서 바로 그룹 집계·추천 시작 */}
        {isHostDevice && (
          <button
            onClick={() => {
              if (sessionId && members.length >= 2) {
                window.location.href = `/app?grp=${encodeURIComponent(sessionId)}`;
              }
            }}
            disabled={members.length < 2}
            className={`w-full max-w-xs mb-5 py-3.5 rounded-2xl font-black text-sm transition-all ${
              members.length >= 2
                ? 'bg-mint-500 text-white shadow-lg shadow-mint-500/30 active:scale-95'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {members.length}명으로 추천받기 →
          </button>
        )}

        {/* 호스트가 정한 코스·지역 */}
        {hostCtx?.purposeFirst && (
          <div className="w-full max-w-xs bg-white shadow-sm rounded-2xl px-5 py-4 mb-3">
            <p className="text-[10px] font-bold text-mint-600 uppercase tracking-widest mb-2">이 모임</p>
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center gap-2"><span className="text-gray-400 w-9 flex-shrink-0">코스</span><span className="font-bold text-gray-800">🍀 {courseText(hostCtx)}</span></div>
              <div className="flex items-center gap-2"><span className="text-gray-400 w-9 flex-shrink-0">지역</span><span className="font-bold text-gray-800">📍 {regionText(hostCtx)}</span></div>
            </div>
          </div>
        )}

        {/* 내가 고른 것 */}
        {(myVibeLabels.length > 0 || budget || excludeFoods.length > 0 || keywords.length > 0) && (
          <div className="w-full max-w-xs bg-white shadow-sm rounded-2xl px-5 py-4 mb-3">
            <p className="text-[10px] font-bold text-mint-600 uppercase tracking-widest mb-2">내가 고른 취향</p>
            <div className="flex flex-wrap gap-1.5">
              {myVibeLabels.map((l) => (
                <span key={l} className="bg-mint-100 text-mint-600 text-xs font-bold px-2.5 py-1 rounded-full">{l}</span>
              ))}
              {budget && <span className="bg-mint-100 text-mint-600 text-xs font-bold px-2.5 py-1 rounded-full">💰 {budget}</span>}
              {keywords.map((k) => (
                <span key={k} className="bg-mint-100 text-mint-600 text-xs font-bold px-2.5 py-1 rounded-full">{k}</span>
              ))}
              {excludeFoods.map((f) => (
                <span key={f} className="bg-red-50 text-red-500 text-xs font-bold px-2.5 py-1 rounded-full">🚫 {f}</span>
              ))}
            </div>
          </div>
        )}

        {/* 참여 현황 */}
        <div className="bg-white shadow-sm rounded-2xl px-6 py-5 w-full max-w-xs">
          <p className="text-xs text-gray-400 mb-3 text-center">
            입력 현황 <span className="font-black text-mint-600">{members.length}</span>
            <span className="text-gray-300"> / {total}</span>
          </p>
          <div className="flex flex-col gap-2">
            {Array.from({ length: total }).map((_, i) => {
              const member = members[i];
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl ${
                    member ? 'bg-mint-100' : 'bg-gray-50 border border-dashed border-gray-200'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                      member ? 'bg-mint-500 text-white' : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {member ? '✓' : i + 1}
                  </div>
                  <span className={`text-sm font-bold ${member ? 'text-mint-600' : 'text-gray-300'}`}>
                    {member ? member.member_name : '대기 중...'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-gray-300 mt-4">3초마다 자동 새로고침</p>
      </div>
    );
  }

  const stepIndex = phase === 'step0' ? 0 : phase === 'step1' ? 1 : 2;
  const stepLabels = [showLocation ? '출발지' : '이름', '분위기', '취향', '완료'];

  return (
    <div className="h-[100dvh] bg-mint-50 flex flex-col overflow-hidden" style={{ height: 'var(--mint-app-height, 100dvh)' }}>
      {/* 헤더 */}
      <div className="flex-shrink-0 text-center pt-4 px-4">
        <h1 className="text-2xl font-black text-mint-600 tracking-tight">MINT</h1>
      </div>

      {/* 스텝 프로그레스 — 전 화면 4단계 고정 */}
      <div className="flex-shrink-0">
        <StepProgress current={stepIndex} total={4} labels={stepLabels} />
      </div>

      {/* 호스트가 정한 코스·지역 배너 (스텝 내내 노출) */}
      <div className="flex-shrink-0">
        <HostContextBanner ctx={hostCtx} />
      </div>

      {/* 스텝 제목 */}
      <div className="flex-shrink-0 text-center px-4 pt-2 pb-1">
        <h2 className="text-xl font-black text-gray-800">
          {phase === 'step0' && (showLocation ? '이름과 출발지를 알려주세요' : '이름을 알려주세요')}
          {phase === 'step1' && '원하는 분위기를 골라봐요'}
          {phase === 'step2' && '예산·취향을 더해요'}
        </h2>
        {phase === 'step1' && (
          <p className="text-xs text-gray-400 mt-1">눈치 안 보고 각자 원하는 대로 (많이 고를수록 정확해져요)</p>
        )}
        {phase === 'step2' && (
          <p className="text-xs text-gray-400 mt-1">예산·편의시설·키워드·못 먹는 음식 — 모두 선택사항</p>
        )}
      </div>

      {/* 콘텐츠 — 텍스트 입력 스텝은 키보드가 올라와도 편하게 상단정렬 유지 */}
      <div key={phase} className="flex-1 min-h-0 overflow-y-auto animate-fade-in-up">
        {phase === 'step0' && (
          <div className="px-5 pt-3 pb-4 flex flex-col gap-5">
            {/* 이름 */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">이름</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름을 입력해주세요"
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 bg-white text-sm outline-none focus:border-mint-500 transition-all"
              />
            </div>
            {/* 출발지 — 중간지점 자동 모드에서만 */}
            {showLocation && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">출발지</label>
                <div ref={wrapperRef} className="relative">
                  <input
                    ref={locInputRef}
                    type="text"
                    value={locValue}
                    onChange={(e) => handleLocChange(e.target.value)}
                    onFocus={() => {
                      setTimeout(() => locInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                    }}
                    placeholder="예: 강남역, 합정역..."
                    className={`w-full pl-4 pr-9 py-3 rounded-2xl border-2 text-sm outline-none transition-all bg-white ${
                      locSelected ? 'border-mint-500 bg-mint-100' : 'border-gray-200 focus:border-mint-500'
                    }`}
                  />
                  {searching && (
                    <div className="absolute inset-y-0 right-3 flex items-center">
                      <div className="w-4 h-4 border-2 border-mint-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {locSelected && !searching && (
                    <div className="absolute inset-y-0 right-3 flex items-center">
                      <span className="text-mint-500 text-sm font-bold">✓</span>
                    </div>
                  )}
                  <SuggestionDropdown
                    suggestions={suggestions}
                    getAnchor={() => wrapperRef.current}
                    onSelect={selectPlace}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">전원 출발지로 중간지점을 계산해요</p>
              </div>
            )}
          </div>
        )}

        {phase === 'step1' && (
          <VibeSelect
            value={vibe}
            onChange={setVibe}
            purpose={{ first: hostCtx?.purposeFirst ?? null, second: hostCtx?.purposeSecond ?? null }}
            conditions={conditions}
            onConditionsChange={setConditions}
            section="mood"
          />
        )}

        {phase === 'step2' && (
          <VibeSelect
            value={vibe}
            onChange={setVibe}
            purpose={{ first: hostCtx?.purposeFirst ?? null, second: hostCtx?.purposeSecond ?? null }}
            budget={budget}
            onBudgetChange={setBudget}
            keywords={keywords}
            onKeywordsChange={setKeywords}
            excludeFoods={excludeFoods}
            onExcludeFoodsChange={setExcludeFoods}
            section="extras"
          />
        )}
      </div>

      {/* 에러 */}
      {error && (
        <div className="flex-shrink-0 mx-5 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 text-center">
          {error}
        </div>
      )}

      {/* 하단 버튼 */}
      <div className="flex-shrink-0 px-5 pt-2 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] flex flex-col gap-2">
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (stepIndex === 0) window.location.href = '/';
              else setPhase((['step0', 'step1', 'step2'] as const)[stepIndex - 1]);
            }}
            aria-label="이전 단계로"
            className="w-[92px] py-4 rounded-2xl border-2 border-gray-200 bg-white text-gray-500 font-bold text-sm hover:border-gray-300 transition-all active:scale-95"
          >
            ← 이전
          </button>

          {phase === 'step0' && (
            <button
              onClick={() => setPhase('step1')}
              disabled={!canGoStep1}
              className={`flex-1 py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${
                canGoStep1
                  ? 'bg-mint-500 text-white shadow-lg shadow-mint-500/30 hover:bg-mint-600'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              다음
            </button>
          )}

          {phase === 'step1' && (
            <button
              onClick={() => setPhase('step2')}
              className="flex-1 py-4 rounded-2xl font-black text-base bg-mint-500 text-white shadow-lg shadow-mint-500/30 hover:bg-mint-600 transition-all active:scale-95"
            >
              다음
            </button>
          )}

          {phase === 'step2' && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className={`flex-1 py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${
                !submitting
                  ? 'bg-mint-500 text-white shadow-lg shadow-mint-500/30 hover:bg-mint-600'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {submitting ? '제출 중...' : '제출하기'}
            </button>
          )}
        </div>

        {phase === 'step0' && !canGoStep1 && (
          <p className="text-xs text-gray-400 text-center">
            {showLocation ? '이름과 출발지를 입력해주세요' : '이름을 입력해주세요'}
          </p>
        )}
      </div>
    </div>
  );
}
