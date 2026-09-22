// 어드민 API 호출 — 비밀번호 검증은 전적으로 서버에서만 한다.
// 서버는 Supabase admin_credentials 행을 기준으로 맞춰보고, 그 행이 없을 때만 ADMIN_PASSWORD 환경변수로 폴백한다.
// (어드민에서 비밀번호를 한 번 바꾸면 그 뒤로는 admin_credentials가 기준이 된다.)
export async function callAdmin(password: string, extra: Record<string, unknown> = {}) {
  const res = await fetch('/api/admin/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}
