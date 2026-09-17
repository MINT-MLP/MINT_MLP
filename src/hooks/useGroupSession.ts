import { useState } from 'react';
import type { GroupMember } from '@/types';

// 그룹 호스트 세션 상태 — 서버 세션 ID·정원·참여자. 상태만 갖는다(폴링·생성은 useGroupActions).
export function useGroupSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expectedCount, setExpectedCount] = useState<number>(3);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [pendingGroupRecommend, setPendingGroupRecommend] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setSessionId(null);
    setGroupMembers([]);
  }

  return {
    sessionId, setSessionId, expectedCount, setExpectedCount, groupMembers, setGroupMembers,
    pendingGroupRecommend, setPendingGroupRecommend, creatingSession, setCreatingSession,
    groupError, setGroupError, copied, setCopied, reset,
  };
}
export type GroupSession = ReturnType<typeof useGroupSession>;
