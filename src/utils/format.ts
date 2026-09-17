// 표시용 포맷 — 비율·시간·날짜. 어드민에서 시작했지만 화면 어디서든 쓰는 순수 함수.

// 분모가 0이면 비율은 존재하지 않는다 — '0.0'으로 찍으면 "성과가 0"으로 읽혀서
// (기간 필터로 유입만 0이 된 소스처럼) 정반대 결론을 유도한다.
export function pct(numer: number, denom: number): string {
  if (denom <= 0) return '—';
  return ((numer / denom) * 100).toFixed(1);
}

// 화면에 그대로 박는 표기용 — 비율이 없을 땐 '—%'가 되지 않게 %를 떼고 내보낸다.
export function pctLabel(numer: number, denom: number): string {
  const v = pct(numer, denom);
  return v === '—' ? v : `${v}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}분 ${s}초` : `${m}분`;
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}

// 피드백은 "언제 왔나"보다 "얼마나 따끈한가"가 먼저다 — 하루 넘으면 날짜로 돌아간다.
export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return formatDate(iso);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return formatDate(iso);
}
