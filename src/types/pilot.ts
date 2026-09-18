// 파일럿 캠페인 — 추천→피드백 인계(handoff)와 경품
// 캠페인이 끝나면 이 파일과 Pilot* 페이지·컴포넌트를 함께 지운다.

export interface CoursePick {
  course: string;        // '1차' | '2차' | '3차'
  rank: number;          // 코스 내 순위(1~3), 3차는 1
  placeName: string;
  category: string | null;
}

export interface PilotConditions {
  purpose: string | null;
  relation: string | null;
  region: string | null;
  vibes: string[];
  budget: string | null;
}

export interface PilotHandoff {
  serial: string;
  createdAt: number;
  conditions: PilotConditions;
  coursePicks: CoursePick[];
}

// 참가자에게 보여주는 당첨 경품 (api/pilot-feedback claim 응답)
export interface PilotPrizeReward {
  title: string;
  tier: string;
  imageUrl: string | null;
  claimCode: string;
}

// 어드민 재고 행 (pilot_prizes 테이블 원형)
export interface PilotPrize {
  id: string; title: string; tier: string; status: string; claimCode: string | null;
  assignedFeedbackId: string | null; assignedAt: string | null; createdAt: string; imageUrl: string | null;
}
