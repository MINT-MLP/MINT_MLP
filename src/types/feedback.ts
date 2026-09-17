// 상시 유저 피드백 — 시트 입력부터 서버 전송 페이로드까지

export type FeedbackCategory = 'bug' | 'pain' | 'idea' | 'praise';

export interface FeedbackDraft {
  text: string;
  category: FeedbackCategory | null;
  contact: string;
  savedAt: number;
}

export interface FeedbackPayload {
  id: string;
  text: string;
  category: FeedbackCategory | null;
  contact: string | null;
  context: {
    route: string;
    tab: string;
    sessionKey: string | null;
    deviceId: string;
    viewport: string;
  };
}

export interface FeedbackInput {
  text: string;
  category: FeedbackCategory | null;
  contact: string | null;
  tab: string;
}
