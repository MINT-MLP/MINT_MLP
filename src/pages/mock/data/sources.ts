import { MOCK_MEETINGS, type MockMeeting } from '@/pages/mock/data/meetings';
import { MOCK_GEMS, type MockGem } from '@/pages/mock/data/gems';
import { MOCK_COUPONS, type MintCoupon } from '@/pages/mock/data/coupons';

// 목업(퍼블리싱) 페이지의 데이터 출처를 한곳에 모은다. 페이지는 이 함수만 부르고 샘플 상수를 직접 읽지 않는다.
// 실제 데이터가 생기면 각 함수 안만 API 호출로 바꾸면 된다(페이지는 그대로).
// VITE_SAMPLE_DATA=off 로 빌드하면 샘플을 비워 빈 화면을 확인할 수 있다.
export const SAMPLE_DATA_ON = import.meta.env.VITE_SAMPLE_DATA !== 'off';

export function loadMeetings(): MockMeeting[] {
  return SAMPLE_DATA_ON ? MOCK_MEETINGS : [];
}

export function loadGems(): MockGem[] {
  return SAMPLE_DATA_ON ? MOCK_GEMS : [];
}

export function loadCoupons(): MintCoupon[] {
  return SAMPLE_DATA_ON ? MOCK_COUPONS : [];
}
