import { useEffect } from 'react';
import type { GroupMember, LocationEntry } from '@/types';
import { trackEvent } from '@/services/analytics';
import { encodeHostContext } from '@/utils/groupLink';
import { aggregateVibe, aggregateBudget, splitMemberKeywords } from '@/utils/groupAggregate';
import { GROUP_SESSION_KEY, loadGroupSessionSummary } from '@/storage/history';
import { cancelGroupSessionOnServer } from '@/services/session';
import { shareViaKakaoOrFallback } from '@/services/share';
import { resolveOriginCached } from '@/services/resultRestore';
import type { RecommendFlow } from '@/hooks/useRecommendFlow';
import type { RecommendInput } from '@/hooks/useRecommendInput';
import type { GroupSession } from '@/hooks/useGroupSession';

// 그룹 호스트 동작 — 링크 생성·공유·폴링·집계. 추천 트리거는 플래그(pendingGroupRecommend)로만 넘긴다.
export function useGroupActions({ flow, input, group }: {
  flow: RecommendFlow; input: RecommendInput; group: GroupSession;
}) {
  const { appMode, view, step, isGroup } = flow;
  const {
    purpose, setPurpose, meetingLocation, setLocations, setGroupTravelLabels, setVibe, setKeywords,
    setBudget, setConditions, setVibeCustom, setOccasionChip, setCustomOccasion, setEtcRelOpen,
  } = input;
  const {
    sessionId, setSessionId, hostToken, setHostToken, expectedCount, setExpectedCount, groupMembers, setGroupMembers,
    setPendingGroupRecommend, setCreatingSession, setGroupError, setCopied,
  } = group;

  // 그룹 참여 링크 — 호스트가 정한 코스·지역을 쿼리에 실어 게스트에게 전달
  function groupShareLink(): string {
    if (!sessionId) return '';
    const ctx = encodeHostContext({
      purposeFirst: purpose?.first ?? null,
      firstGenre: purpose?.firstGenre ?? null,
      purposeSecond: purpose?.second ?? null,
      secondGenre: purpose?.secondGenre ?? null,
      relation: purpose?.relation ?? null,
      occasion: purpose?.occasion ?? null,
      regionType: meetingLocation?.type === 'auto' ? 'auto' : 'manual',
      regionName: meetingLocation?.type === 'manual' ? meetingLocation.area : null,
      regionId: meetingLocation?.type === 'manual' ? meetingLocation.regionId : null,
    });
    // 참석 응답 마감시각(기본 24시간 후) — 게스트 카운트다운·마감 판정용. 서버 저장 없이 링크로 전달.
    const rsvpBy = Date.now() + 24 * 60 * 60 * 1000;
    return `${window.location.origin}/join?id=${sessionId}&${ctx}&rsvp_by=${rsvpBy}`;
  }

  // 그룹 대기 화면 폴링 — 입력 플로우(steps)에서만. 결과 화면에선 중단(불필요한 3초 폴링 낭비 방지)
  useEffect(() => {
    if (appMode !== 'group' || !sessionId || view !== 'steps') return;
    let active = true;

    async function poll() {
      if (document.hidden) return; // 백그라운드 탭에서는 폴링 중지
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId!)}`, {
          headers: hostToken ? { 'x-host-token': hostToken } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (typeof data.expected_count === 'number') setExpectedCount(data.expected_count);
        if (Array.isArray(data.members)) {
          const members = await withOrigins(data.members as GroupMember[]);
          if (active) setGroupMembers(members);
        }
      } catch {
        // 폴링 실패는 조용히 무시
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [appMode, sessionId, hostToken, view, setExpectedCount, setGroupMembers]);

  // 호스트가 링크로 돌아왔을 때(?grp=recommend) 멤버가 모이면 자동으로 추천을 시작
  useEffect(() => {
    if (!isGroup || !sessionId || step !== 2) return;
    if (!new URLSearchParams(window.location.search).has('grp')) return;
    if (groupMembers.length < 2 || !meetingLocation) return;
    try { window.history.replaceState(window.history.state, '', '/app/recommend'); } catch { /* ignore */ }
    aggregateGroupMembers();
    // 집계 setState가 커밋된 다음 렌더에서 추천을 시작해야 해서 플래그로 넘긴다(직접 호출은 stale locations/vibe를 읽음)
    setPendingGroupRecommend(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, sessionId, step, groupMembers.length]);

  async function handleCreateSession() {
    // 새로 시작으로 들어와 이전 초대 링크가 아직 살아 있으면, 새 링크가 그 자리를 덮는다 — 묻고 이전 링크를 서버에서 취소한다
    const prev = loadGroupSessionSummary();
    if (prev && prev.sessionId !== sessionId) {
      if (!window.confirm('진행 중인 다른 초대 링크가 있어요.\n새로 만들면 그 링크는 취소돼요. 새로 만들까요?')) return;
      cancelGroupSessionOnServer(prev.sessionId, prev.hostToken);
    }
    setCreatingSession(true);
    setGroupError(null);
    try {
      const hasSecond = !!(purpose?.second && purpose.second !== '없음');
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', expected_count: expectedCount, has_second: hasSecond }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '링크 생성에 실패했어요. 다시 시도해주세요.');
      }
      const data = await res.json();
      setSessionId(data.id);
      setHostToken(typeof data.hostToken === 'string' ? data.hostToken : null);
      setGroupMembers([]);
      trackEvent('group_session_create'); // 그룹 바이럴 루프 분해 — 링크 생성 성공 수
      // appMode/step은 그대로(step 2 공유 화면) — 링크가 생기면 같은 화면이 공유 UI로 전환된다
    } catch (e) {
      setGroupError((e as Error).message);
    } finally {
      setCreatingSession(false);
    }
  }

  function handleCopyLink() {
    const link = groupShareLink();
    if (!link) return;
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // 그룹 초대 링크를 카카오톡 UI로 원터치 공유(복사 버튼과 함께 제공 — 카톡 안 쓰는 층은 복사, 쓰는 층은 원터치).
  function handleShareGroupLink() {
    const link = groupShareLink();
    if (!link) return;
    trackEvent('kakao_share');
    const shareText = [
      '🍀 MINT에서 만날 장소 같이 정해요!',
      '',
      '링크 열고 분위기·취향만 30초 고르면 끝.',
      '코스·지역은 이미 정해뒀어요 👇',
    ].join('\n');
    void shareViaKakaoOrFallback(() => ({
      objectType: 'feed',
      content: {
        title: '🍀 MINT | 어디서 만날지 같이 정해요',
        description: '링크 열고 분위기·취향만 고르면 끝. 다같이 만날 장소를 정해요.',
        imageUrl: `${window.location.origin}/image/step5.png`,
        link: { mobileWebUrl: link, webUrl: link },
      },
      buttons: [
        { title: '참여하고 취향 입력하기', link: { mobileWebUrl: link, webUrl: link } },
      ],
    }), shareText, link);
  }

  // 그룹 링크 생성 후 코스·지역을 바꾸려면 이미 공유된 링크와 어긋난다 → 동의받고 세션을 무효화.
  // (handleBack·스텝바 점프가 공유 헬퍼로 재사용)
  function confirmInvalidateGroupLink(): boolean {
    // window.confirm은 버튼 라벨을 못 바꾼다 — 마지막 문장이 곧 '확인'의 의미가 되게 쓴다.
    // 이미 입력한 친구가 있으면 사라지는 것이 링크만이 아니므로 그 수를 명시한다.
    const msg = groupMembers.length > 0
      ? `코스나 지역을 바꾸면 지금 초대 링크는 못 쓰게 돼요.\n이미 입력한 ${groupMembers.length}명의 취향도 함께 사라지고, 새 링크를 다시 보내야 해요.\n\n초대 링크를 취소하고 다시 설정할까요?`
      : '코스나 지역을 바꾸면 지금 초대 링크는 못 쓰게 돼요.\n이미 링크를 받은 친구들에겐 새 링크를 다시 보내야 해요.\n\n초대 링크를 취소하고 다시 설정할까요?';
    const ok = window.confirm(msg);
    if (!ok) return false;
    if (sessionId) cancelGroupSessionOnServer(sessionId, hostToken); // 서버에도 알려야 옛 링크가 실제로 죽는다
    setSessionId(null);
    setHostToken(null);
    setGroupMembers([]);
    try { localStorage.removeItem(GROUP_SESSION_KEY); } catch { /* ignore */ }
    return true;
  }

  // 그룹 확정 진입 직전: 멤버들이 각자 낸 출발지·분위기·취향을 하나로 집계.
  // 코스·지역은 호스트가 정한 state(purpose·meetingLocation)를 그대로 쓴다(재집계하지 않음).
  function aggregateGroupMembers() {
    const withCoords = groupMembers.filter((m) => m.location_lat != null && m.location_lng != null);
    // locations[].name은 '지명'으로 쓰인다 — AI 프롬프트의 "- 출발지: ○○"와 총무 발표("○○에서 출발하는 분")가
    // 이 값을 그대로 읽는다. 사람 이름을 넣으면 "김철수에서 출발하는 분이 오늘의 총무 당첨!"이
    // 결과·게스트 화면·카톡 공유 카드까지 그대로 나간다. 그래서 실제 출발지명(location_name)을 쓴다.
    // 검색어·장소 ID도 같이 둔다 — 결과 스냅샷이 이것만 저장했다가 새로고침 뒤 다시 찾는다
    const groupLocations: LocationEntry[] = withCoords.map((m) => ({
      name: m.location_name || m.member_name, lat: m.location_lat!, lng: m.location_lng!,
      ...(m.location_query && m.location_place_id ? { query: m.location_query, kakaoPlaceId: m.location_place_id } : {}),
    }));
    setLocations(groupLocations);
    // 반대로 이동시간 표("○○님 25분")의 label은 사람 이름이 맞다 — 같은 배열을 두 용도로 쓰던 걸 여기서 분리한다.
    // groupLocations와 같은 순서·길이라 인덱스로 대응된다.
    setGroupTravelLabels(withCoords.map((m) => m.member_name));
    setVibe(aggregateVibe(groupMembers));
    // 키워드는 1차/2차 분리 집계.
    const { keywords: memberKeywords } = splitMemberKeywords(groupMembers);
    setKeywords(memberKeywords);
    setBudget(aggregateBudget(groupMembers));

    // 혼자 모드 잔여 상태 청소 — 위 5개(locations/vibe/keywords/budget)는 멤버 집계로 덮이지만,
    // 아래 값들은 덮이지 않아 그대로 그룹 프롬프트에 실려 나간다. 그룹 플로우에는 이 값들을 묻는 화면이 아예 없어서
    // (관계·조건·직접입력 키워드는 혼자 모드 step1/step3 전용) 유저는 자기도 모르게 붙은 조건을 볼 방법이 없다.
    // 실제 사고: "혼자 정할게요 → 관계 '연인' 선택 → 다같이 정할게요"면 6명 모임에 "커플 분위기,
    // 프라이빗하고 조용한 공간 선호"가 붙는다. 입력 초안(INPUT_DRAFT_KEY) 복원 탓에 세션을 넘어서도 살아남는다.
    // 남기는 것: 코스(purpose.first/second/genre)·지역(meetingLocation)·정원 — 호스트가 그룹 화면에서 직접 고른 값이다.
    setConditions([]);
    setVibeCustom({});
    setPurpose((prev) => (prev ? { ...prev, relation: null, occasion: null } : prev));
    setOccasionChip(null);   // 관계·특별한날의 UI 표시도 함께 정리(다시 혼자 모드로 가면 빈 상태로 보이게)
    setCustomOccasion('');
    setEtcRelOpen(false);
  }

  function requestGroupRecommend() {
    // 2명 이상 입력이면 진행. meetingLocation은 step1에서 확정·persist되어 항상 존재.
    if (!meetingLocation || groupMembers.length < 2) return;
    aggregateGroupMembers();
    setPendingGroupRecommend(true);
  }

  return { groupShareLink, handleCreateSession, handleCopyLink, handleShareGroupLink, confirmInvalidateGroupLink, aggregateGroupMembers, requestGroupRecommend };
}
export type GroupActions = ReturnType<typeof useGroupActions>;

// 서버엔 출발지 검색어·장소 ID만 있다 — 이름·좌표는 여기서 다시 찾아 메모리에만 채운다
async function withOrigins(members: GroupMember[]): Promise<GroupMember[]> {
  return Promise.all(members.map(async (m) => {
    const o = m.location_query && m.location_place_id ? await resolveOriginCached(m.location_query, m.location_place_id) : null;
    return { ...m, location_name: o?.name ?? null, location_lat: o?.lat ?? null, location_lng: o?.lng ?? null };
  }));
}
