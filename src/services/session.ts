// 그룹 세션 API (/api/session) — 호스트 측 호출

// 그룹 링크 무효화를 서버에도 알린다 — 알리지 않으면 옛 링크가 계속 살아 있어서,
// 그 링크로 들어온 게스트는 제출까지 마치고도 아무도 보지 않는 세션에서 영원히 결과를 기다린다.
// 실패해도(구버전 서버·오프라인) 로컬 무효화는 그대로 진행해야 하므로 fire-and-forget.
export function cancelGroupSessionOnServer(id: string, hostToken: string | null): void {
  void fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', id, ...(hostToken ? { hostToken } : {}) }),
  }).catch(() => { /* 서버가 cancel을 몰라도 로컬 무효화는 이미 끝났다 */ });
}
