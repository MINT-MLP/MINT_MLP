import { useState, type FormEvent } from 'react';

// 어드민 비밀번호 변경 카드.
// 현재 비밀번호는 부모의 password state를 재사용하지 않고 사용자가 방금 친 값을 받는다
// (방치된 탭을 남이 잡아 비밀번호를 바꿔버리는 걸 막는다).
export default function AdminPasswordChangeCard({ onChange, source }: {
  onChange: (current: string, next: string) => Promise<void>;
  source: 'db' | 'env' | null;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const inputClass = 'w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-mint-500 outline-none transition-all text-sm';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setMsg(null);

    // 서버와 같은 문구로 먼저 걸러낸다 — 왕복 한 번을 아끼려는 게 아니라 문구가 갈리면 안 되기 때문.
    if (!current.trim()) return setMsg({ kind: 'err', text: '현재 비밀번호를 입력해주세요.' });
    if (next.trim().length < 8) return setMsg({ kind: 'err', text: '비밀번호는 8자 이상이어야 해요.' });
    if (next !== confirm) return setMsg({ kind: 'err', text: '새 비밀번호가 서로 달라요.' });
    if (next.trim() === current.trim()) {
      return setMsg({ kind: 'err', text: '현재 비밀번호와 다른 비밀번호를 입력해주세요.' });
    }

    setBusy(true);
    try {
      await onChange(current.trim(), next.trim());
      setCurrent(''); setNext(''); setConfirm('');
      setMsg({
        kind: 'ok',
        text: '비밀번호를 바꿨어요. 이 화면은 계속 쓸 수 있고, 다음 로그인부터 새 비밀번호를 입력하세요. 선발대 어드민에도 같은 비밀번호가 적용돼요.',
      });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs text-gray-400 mb-4">
        {source === 'env'
          ? '지금은 Vercel 환경변수 값으로 로그인 중이에요. 한 번 바꾸면 여기서 직접 관리돼요.'
          : '바꾼 비밀번호는 이 어드민과 선발대 어드민에 함께 적용돼요.'}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">현재 비밀번호</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">새 비밀번호 (8자 이상)</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">새 비밀번호 확인</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </div>
        {msg && (
          <div className={`text-xs rounded-xl p-3 ${msg.kind === 'ok' ? 'bg-mint-100 text-mint-600' : 'bg-red-50 text-red-500'}`}>
            {msg.text}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-mint-500 text-white font-black py-3 rounded-xl hover:bg-mint-600 transition-colors disabled:bg-gray-200 disabled:text-gray-400"
        >
          {busy ? '변경 중...' : '변경'}
        </button>
      </form>
    </div>
  );
}
