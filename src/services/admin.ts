// 어드민 API 호출 — 비밀번호는 서버(ADMIN_PASSWORD)에서만 검증한다
export async function callAdmin(password: string, extra: Record<string, unknown> = {}) {
  const res = await fetch('/api/admin-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}
