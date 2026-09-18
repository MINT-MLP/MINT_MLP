import { useState, type FormEvent } from 'react';

export default function AdminPasswordGate({ onUnlock, verifying, error }: {
  onUnlock: (password: string) => void;
  verifying: boolean;
  error: string | null;
}) {
  const [input, setInput] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (input.trim()) onUnlock(input.trim());
  }

  return (
    <div className="min-h-screen bg-mint-50 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-xs text-center">
        <div className="text-3xl mb-3">🔒</div>
        <h1 className="text-lg font-black text-gray-800 mb-1">MINT 어드민</h1>
        <p className="text-sm text-gray-400 mb-6">비밀번호를 입력해주세요</p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="비밀번호"
          autoFocus
          className={`w-full px-4 py-3 rounded-xl border-2 text-center text-lg tracking-widest outline-none transition-all ${error ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-mint-500'}`}
        />
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        <button
          type="submit"
          disabled={verifying}
          className="w-full mt-4 bg-mint-500 text-white font-black py-3 rounded-xl hover:bg-mint-600 transition-colors disabled:bg-gray-200 disabled:text-gray-400"
        >
          {verifying ? '확인 중...' : '입장'}
        </button>
      </form>
    </div>
  );
}
