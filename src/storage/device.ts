// 기기 영구 식별자 — 로그인 없는 서비스에서 "누가"를 잇는 유일한 열쇠(발굴 소급·포인트 복구·피드백·A/B 배정).
// points.ts에서 분리(2026-09-18): 21개 파일 중 13개가 이것 하나 때문에 포인트 모듈을 끌어오고 있었다.
const DEVICE_KEY = 'mint_device_id';

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'd_anon';
  }
}
