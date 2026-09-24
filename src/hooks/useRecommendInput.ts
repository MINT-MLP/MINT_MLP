import { useState } from 'react';
import type { LocationEntry, MeetingLocation, PurposeValue, VibeState } from '@/types';

// 추천 입력 상태 — 사용자가 스텝에서 고른 값 전부. 상태만 갖는다(영속화는 useHomePersistence).
export function useRecommendInput() {
  const [groupSize, setGroupSize] = useState<'2명' | '3~4명' | '5명 이상'>('2명');
  const [customOccasion, setCustomOccasion] = useState('');
  const [etcRelOpen, setEtcRelOpen] = useState(false); // '기타 콕!' 자유입력 모드
  const [occasionChip, setOccasionChip] = useState<string | null>(null); // 스텝2 2층에서 고른 '특별한 날' 칩 key(선택 표시용)
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  // 그룹 전용: locations와 같은 순서의 '사람 이름' 목록. locations[].name은 지명(프롬프트·총무용)이라
  // 이동시간 표에 쓸 label을 여기 따로 들고 있는다. 혼자 모드에서는 항상 null(= locations[].name 사용).
  const [groupTravelLabels, setGroupTravelLabels] = useState<string[] | null>(null);
  const [purpose, setPurpose] = useState<PurposeValue | null>(null);
  const [vibe, setVibe] = useState<VibeState>({});
  const [budget, setBudget] = useState<string | null>(null);
  const [meetingLocation, setMeetingLocation] = useState<MeetingLocation | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  // 시설형 조건(주차·룸·예약…) — 코스 구분이 없어 vibe와 분리해 들고 있다
  const [conditions, setConditions] = useState<string[]>([]);
  const [vibeCustom, setVibeCustom] = useState<Record<string, string>>({});

  // '처음부터' — groupSize는 원래 초기화 대상이 아니다(기존 동작 유지)
  function reset() {
    setLocations([]);
    setGroupTravelLabels(null);
    setPurpose(null);
    setOccasionChip(null);
    setEtcRelOpen(false);
    setCustomOccasion('');
    setVibe({});
    setBudget(null);
    setKeywords([]);
    setConditions([]);
    setVibeCustom({});
    setMeetingLocation(null);
  }

  return {
    groupSize, setGroupSize, customOccasion, setCustomOccasion, etcRelOpen, setEtcRelOpen,
    occasionChip, setOccasionChip, locations, setLocations, groupTravelLabels, setGroupTravelLabels,
    purpose, setPurpose, vibe, setVibe, budget, setBudget, meetingLocation, setMeetingLocation,
    keywords, setKeywords, conditions, setConditions, vibeCustom, setVibeCustom,
    reset,
  };
}
export type RecommendInput = ReturnType<typeof useRecommendInput>;
