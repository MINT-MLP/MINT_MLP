import { useState } from 'react';
import type { GroupMember } from '@/types';

// 그룹 호스트 세션 상태 — 서버 세션 ID·정원·참여자. 상태만 갖는다(폴링·생성은 useGroupActions).
export function useGroupSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // 호스트 비밀값 — 참여자 출발지·취향 조회, 결과 전달, 링크 취소에 쓴다(세션 ID는 게스트도 갖고 있어서)
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [expectedCount, setExpectedCount] = useState<number>(3);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [pendingGroupRecommend, setPendingGroupRecommend] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setSessionId(null);
    setHostToken(null);
    setGroupMembers([]);
  }

  return {
    sessionId, setSessionId, hostToken, setHostToken, expectedCount, setExpectedCount, groupMembers, setGroupMembers,
    pendingGroupRecommend, setPendingGroupRecommend, creatingSession, setCreatingSession,
    groupError, setGroupError, copied, setCopied, reset,
  };
}
export type GroupSession = ReturnType<typeof useGroupSession>;
