import { useState, type ReactNode } from 'react';
import { supabase } from '@/utils/supabase';
import type { CoursePick, PilotPrize } from '@/types';

interface PilotFeedback {
  id: string;
  createdAt: string;
  fitRating: number;
  fitText: string;
  extraText: string;
  contact: string | null;
  sessionKey: string | null;
  selections: Selections | null;
  placeName: string | null;
  claimCode: string | null;
  serial: string | null;
  entryType: string | null;
  recSnapshot: RecSnapshot | null;
  visited: VisitedItem[] | null;
  qaAnswers: QaAnswers | null;
  recommendationImageUrls: string[];
  paymentImageUrls: string[];
}
interface Selections { purpose?: string | null; relation?: string | null; region?: string; vibes?: string[]; source?: string }
interface RecSnapshot { conditions?: { purpose?: string | null; relation?: string | null; region?: string | null; vibes?: string[]; budget?: string | null }; coursePicks?: CoursePick[] }
interface VisitedItem { course: string; choice: string; otherName?: string }
interface QaAnswers { reason?: string[]; issues?: string[]; budget?: string | null; vibeFit?: number | null; reuse?: string | null }
interface PilotSummary { count: number; avgFitRating: number | null; distribution: number[] }
interface PrizeCounts { available: number; assigned: number; redeemed: number; void: number }

type Tab = 'feedback' | 'stock' | 'status';
const EMPTY_SUMMARY: PilotSummary = { count: 0, avgFitRating: null, distribution: [0, 0, 0, 0, 0] };
const EMPTY_COUNTS: PrizeCounts = { available: 0, assigned: 0, redeemed: 0, void: 0 };
const PRIZE_BUCKET = 'pilot-prizes';

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/pilot-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청에 실패했어요.');
  return data as T;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PilotAdmin() {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<Tab>('feedback');

  const [records, setRecords] = useState<PilotFeedback[]>([]);
  const [summary, setSummary] = useState<PilotSummary>(EMPTY_SUMMARY);
  const [prizes, setPrizes] = useState<PilotPrize[]>([]);
  const [counts, setCounts] = useState<PrizeCounts>(EMPTY_COUNTS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll(pw = password) {
    setLoading(true); setError(null);
    try {
      const [fb, pz] = await Promise.all([
        api<{ feedback: PilotFeedback[]; summary: PilotSummary }>({ action: 'admin-list', password: pw }),
        api<{ prizes: PilotPrize[]; counts: PrizeCounts }>({ action: 'admin-prize-list', password: pw }).catch(() => ({ prizes: [], counts: EMPTY_COUNTS })),
      ]);
      setRecords(Array.isArray(fb.feedback) ? fb.feedback : []);
      setSummary(fb.summary ?? EMPTY_SUMMARY);
      setPrizes(Array.isArray(pz.prizes) ? pz.prizes : []);
      setCounts(pz.counts ?? EMPTY_COUNTS);
      setUnlocked(true);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  async function reloadPrizes() {
    try {
      const pz = await api<{ prizes: PilotPrize[]; counts: PrizeCounts }>({ action: 'admin-prize-list', password });
      setPrizes(pz.prizes ?? []); setCounts(pz.counts ?? EMPTY_COUNTS);
    } catch (e) { setError((e as Error).message); }
  }

  if (!unlocked) {
    return (
      <div className="min-h-[100dvh] bg-[#F5FBF8] flex items-center justify-center px-4">
        <form onSubmit={(e) => { e.preventDefault(); if (password.trim()) loadAll(password.trim()); }}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-xs text-center">
          <div className="text-3xl mb-3">🔒</div>
          <h1 className="text-lg font-black text-gray-800 mb-1">선발대 어드민</h1>
          <p className="text-sm text-gray-400 mb-6">비밀번호를 입력해주세요</p>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" autoFocus
            className={`w-full px-4 py-3 rounded-xl border-2 text-center text-lg tracking-widest outline-none transition-all ${error ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-[#36CFA0]'}`} />
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          <button type="submit" disabled={loading} className="w-full mt-4 bg-[#36CFA0] text-white font-black py-3 rounded-xl hover:bg-[#2AB58C] transition-colors disabled:bg-gray-200 disabled:text-gray-400">{loading ? '확인 중...' : '입장'}</button>
        </form>
      </div>
    );
  }

  const lowStock = counts.available <= 3;

  return (
    <div className="min-h-[100dvh] bg-[#F5FBF8]">
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-16">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-[#2AB5A0]">선발대 어드민</h1>
            <p className="text-sm text-gray-400">데이터 수집 · 기프티콘 지급 운영</p>
          </div>
          <button onClick={() => loadAll(password)} className="text-xs bg-white border border-gray-200 text-gray-500 px-2.5 py-1 rounded-full hover:border-[#36CFA0] hover:text-[#36CFA0] transition-colors">새로고침</button>
        </header>

        {/* 탭 */}
        <div className="flex gap-2 mb-5">
          {([['feedback', `제출 ${records.length}`], ['stock', '재고 등록'], ['status', `지급 현황`]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${tab === t ? 'bg-[#3CDBC0] text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
              {label}{t === 'stock' && lowStock ? ' ⚠️' : ''}
            </button>
          ))}
        </div>

        {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">{error}</div>}
        {lowStock && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-700 font-bold flex items-center gap-2">
            ⚠️ 남은 재고 {counts.available}개! 품절대기가 생기기 전에 기프티콘을 충전해주세요.
          </div>
        )}

        {tab === 'feedback' && <FeedbackTab records={records} summary={summary} />}
        {tab === 'stock' && <StockTab password={password} onDone={reloadPrizes} prizes={prizes} counts={counts} onVoid={async (id) => { await api({ action: 'admin-prize-void', password, id }); reloadPrizes(); }} />}
        {tab === 'status' && <StatusTab counts={counts} prizes={prizes} onVoid={async (id) => { await api({ action: 'admin-prize-void', password, id }); reloadPrizes(); }} />}
      </div>
    </div>
  );
}

// ───────────────────────── 제출 데이터 탭 ─────────────────────────
function FeedbackTab({ records, summary }: { records: PilotFeedback[]; summary: PilotSummary }) {
  return (
    <>
      {summary.count > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-4 mb-4">
            <div>
              <div className="text-xs text-gray-400 mb-0.5">평균 적합도</div>
              <div className="text-3xl font-black text-[#2AB5A0]">{summary.avgFitRating != null ? summary.avgFitRating.toFixed(1) : '—'}<span className="text-base text-gray-300 font-bold"> /5</span></div>
            </div>
            <div className="h-10 w-px bg-gray-100" />
            <div>
              <div className="text-xs text-gray-400 mb-0.5">제출 건수</div>
              <div className="text-3xl font-black text-gray-700">{summary.count}<span className="text-base text-gray-300 font-bold"> 건</span></div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {[5, 4, 3, 2, 1].map((score) => {
              const cnt = summary.distribution[score - 1] ?? 0;
              const pct = summary.count > 0 ? Math.round((cnt / summary.count) * 100) : 0;
              return (
                <div key={score} className="flex items-center gap-2 text-xs">
                  <span className="w-8 text-gray-400 font-bold shrink-0">{score}점</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#36CFA0] rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                  <span className="w-14 text-right text-gray-500 shrink-0">{cnt}건 ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {records.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-100"><div className="text-4xl mb-3">📋</div><p className="text-gray-400">아직 제출된 피드백이 없어요.</p></div>
      ) : (
        <div className="flex flex-col gap-4">
          {records.map((r) => (
            <article key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-xs text-gray-400">{formatDate(r.createdAt)}</p>
                  <h2 className="text-lg font-black text-gray-800 mt-0.5">적합도 {r.fitRating}/5점</h2>
                  {r.contact && <p className="text-xs text-[#2AB5A0] font-bold mt-1">연락처: {r.contact}</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {r.claimCode && <span className="text-[10px] font-black text-white bg-[#3CDBC0] px-2.5 py-1 rounded-full">{r.claimCode}</span>}
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${r.entryType === 'auto' ? 'bg-[#E8F8F5] text-[#2AB5A0]' : 'bg-gray-100 text-gray-400'}`}>
                    {r.entryType === 'auto' ? `일련번호 ${r.serial ?? ''}` : '수동'}
                  </span>
                </div>
              </div>

              {/* 입력 조건 (일련번호 경로면 DB 원본, 아니면 자기신고) */}
              {(() => {
                const c = r.recSnapshot?.conditions ?? null;
                const purpose = c?.purpose ?? r.selections?.purpose;
                const relation = c?.relation ?? r.selections?.relation;
                const region = c?.region ?? r.selections?.region ?? r.placeName;
                const vibes = c?.vibes ?? r.selections?.vibes ?? [];
                if (!purpose && !relation && !region && vibes.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {purpose && <Chip>🍽️ {purpose}</Chip>}
                    {relation && <Chip>👥 {relation}</Chip>}
                    {region && <Chip>📍 {region}</Chip>}
                    {c?.budget && <Chip>💰 {c.budget}</Chip>}
                    {vibes.map((v) => <Chip key={v}>#{v}</Chip>)}
                  </div>
                );
              })()}

              {/* 추천 vs 실제 방문 */}
              {r.recSnapshot?.coursePicks && r.recSnapshot.coursePicks.length > 0 && (
                <div className="bg-[#F5FBF8] rounded-2xl px-4 py-3 mb-3">
                  <p className="text-[11px] font-bold text-[#2AB5A0] uppercase tracking-widest mb-2">추천 → 실제 방문</p>
                  {groupCourses(r.recSnapshot.coursePicks).map(([course, picks]) => {
                    const v = (r.visited ?? []).find((x) => x.course === course);
                    return (
                      <div key={course} className="mb-1.5 last:mb-0">
                        <span className="text-[11px] font-bold text-gray-500">{course}: </span>
                        {picks.map((p) => {
                          const went = v?.choice === p.placeName;
                          return <span key={p.placeName} className={`text-[11px] mr-1.5 ${went ? 'font-black text-[#2AB5A0]' : 'text-gray-400'}`}>{went ? '✅ ' : ''}{p.rank}.{p.placeName}</span>;
                        })}
                        {v?.choice === '__other' && <span className="text-[11px] font-black text-orange-500">→ 다른 곳{v.otherName ? `: ${v.otherName}` : ''}</span>}
                        {v?.choice === '__none' && <span className="text-[11px] text-gray-400">→ 안 감</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Q&A 요약 */}
              {r.qaAnswers && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {r.qaAnswers.reason?.map((x) => <span key={x} className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">이유·{x}</span>)}
                  {r.qaAnswers.issues?.map((x) => <span key={x} className="text-[10px] text-red-500 bg-red-50 px-2 py-0.5 rounded-full">불만·{x}</span>)}
                  {r.qaAnswers.budget && <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">예산·{({ ok: '안에서', slightly: '약간초과', over: '많이초과' } as Record<string, string>)[r.qaAnswers.budget] ?? r.qaAnswers.budget}</span>}
                  {r.qaAnswers.vibeFit != null && <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">분위기부합·{r.qaAnswers.vibeFit}/5</span>}
                  {r.qaAnswers.reuse && <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">재이용·{({ always: '무조건', conditional: '조건부', no: '글쎄' } as Record<string, string>)[r.qaAnswers.reuse] ?? r.qaAnswers.reuse}</span>}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <TextBlock title="한 줄 후기" text={r.fitText} />
                {r.extraText ? <TextBlock title="추가 의견" text={r.extraText} /> : <div />}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <ImageGroup title="MINT 추천 인증" urls={r.recommendationImageUrls} />
                <ImageGroup title="결제 인증" urls={r.paymentImageUrls} />
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

// ───────────────────────── 재고 등록 탭 ─────────────────────────
interface Staged { file: File; title: string; tier: string; }
function StockTab({ password, onDone, prizes, counts, onVoid }: { password: string; onDone: () => void; prizes: PilotPrize[]; counts: PrizeCounts; onVoid: (id: string) => void }) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function addFiles(files: File[]) {
    const lastTitle = staged[staged.length - 1]?.title ?? '';
    const lastTier = staged[staged.length - 1]?.tier ?? 'basic';
    setStaged([...staged, ...files.map((file) => ({ file, title: lastTitle, tier: lastTier }))]);
  }
  function update(i: number, patch: Partial<Staged>) { setStaged(staged.map((s, idx) => idx === i ? { ...s, ...patch } : s)); }
  function remove(i: number) { setStaged(staged.filter((_, idx) => idx !== i)); }

  async function register() {
    if (staged.length === 0) return;
    if (staged.some((s) => !s.title.trim())) { setErr('모든 이미지에 상품명을 입력해주세요.'); return; }
    setUploading(true); setErr(null); setMsg(null);
    try {
      const { slots } = await api<{ slots: { path: string; token: string }[] }>({ action: 'admin-prize-upload-url', password, count: staged.length });
      if (!slots || slots.length !== staged.length) throw new Error('업로드 슬롯 발급에 실패했어요.');
      const items: { path: string; title: string; tier: string }[] = [];
      for (let i = 0; i < staged.length; i++) {
        const { error } = await supabase.storage.from(PRIZE_BUCKET).uploadToSignedUrl(slots[i].path, slots[i].token, staged[i].file, { contentType: staged[i].file.type || 'image/jpeg' });
        if (error) throw new Error(`업로드 실패: ${error.message}`);
        items.push({ path: slots[i].path, title: staged[i].title.trim(), tier: staged[i].tier.trim() || 'basic' });
      }
      const { added } = await api<{ added: number }>({ action: 'admin-prize-register', password, items });
      setMsg(`${added}개 기프티콘을 재고로 등록했어요!`);
      setStaged([]);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setUploading(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-black text-gray-800 mb-1">기프티콘 재고 등록</p>
        <p className="text-xs text-gray-400 mb-3 leading-relaxed">카카오톡 선물하기에서 산 기프티콘 <strong>스크린샷</strong>을 올리세요. 비공개 버킷에 저장되고, 당첨자에게만 서명 URL로 노출돼요. 남은 재고 <strong className="text-[#2AB5A0]">{counts.available}개</strong>.</p>
        <label className="block border-2 border-dashed border-[#3CDBC0]/60 rounded-2xl bg-[#F0FDF9] px-4 py-6 text-center cursor-pointer active:scale-[0.99] transition-all">
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ''; }} />
          <span className="block text-2xl mb-1">＋</span>
          <span className="block text-sm font-black text-[#2AB5A0]">기프티콘 스크린샷 선택 (여러 장)</span>
        </label>

        {staged.length > 0 && (
          <div className="flex flex-col gap-2 mt-4">
            {staged.map((s, i) => (
              <div key={i} className="flex items-center gap-2 bg-[#F5FBF8] rounded-xl p-2">
                <img src={URL.createObjectURL(s.file)} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-100" />
                <input value={s.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="상품명 (예: 스타벅스 아메리카노)" maxLength={60}
                  className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3CDBC0]" />
                <select value={s.tier} onChange={(e) => update(i, { tier: e.target.value })} className="border-2 border-gray-200 rounded-lg px-2 py-2 text-xs font-bold text-gray-600 focus:outline-none focus:border-[#3CDBC0]">
                  <option value="basic">기본</option><option value="rare">레어</option><option value="epic">에픽</option>
                </select>
                <button onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 px-1 text-lg">×</button>
              </div>
            ))}
            <button onClick={register} disabled={uploading} className="mt-2 w-full py-3.5 rounded-xl bg-[#3CDBC0] text-white font-black active:scale-95 transition-all disabled:opacity-60">
              {uploading ? '업로드 중...' : `${staged.length}개 재고 등록`}
            </button>
          </div>
        )}
        {msg && <p className="text-sm text-[#2AB5A0] font-bold mt-3">{msg}</p>}
        {err && <p className="text-sm text-red-500 mt-3">{err}</p>}
      </div>

      <PrizeList prizes={prizes} onVoid={onVoid} />
    </div>
  );
}

// ───────────────────────── 지급 현황 탭 ─────────────────────────
function StatusTab({ counts, prizes, onVoid }: { counts: PrizeCounts; prizes: PilotPrize[]; onVoid: (id: string) => void }) {
  const cards = [
    { label: '남은 재고', v: counts.available, color: 'text-[#2AB5A0]' },
    { label: '지급됨', v: counts.assigned, color: 'text-gray-700' },
    { label: '사용됨', v: counts.redeemed, color: 'text-gray-400' },
    { label: '무효', v: counts.void, color: 'text-red-400' },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl px-3 py-4 text-center shadow-sm">
            <p className={`text-3xl font-black ${c.color}`}>{c.v}</p>
            <p className="text-[11px] text-gray-400 mt-1">{c.label}</p>
          </div>
        ))}
      </div>
      <PrizeList prizes={prizes} onVoid={onVoid} showAssigned />
    </div>
  );
}

function PrizeList({ prizes, onVoid, showAssigned }: { prizes: PilotPrize[]; onVoid: (id: string) => void; showAssigned?: boolean }) {
  const list = showAssigned ? prizes.filter((p) => p.status !== 'available') : prizes;
  if (list.length === 0) return <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 text-sm text-gray-400">{showAssigned ? '아직 지급 내역이 없어요.' : '등록된 재고가 없어요.'}</div>;
  const badge: Record<string, string> = { available: 'bg-[#E8F8F5] text-[#2AB5A0]', assigned: 'bg-amber-50 text-amber-600', redeemed: 'bg-gray-100 text-gray-400', void: 'bg-red-50 text-red-400' };
  const label: Record<string, string> = { available: '재고', assigned: '지급됨', redeemed: '사용됨', void: '무효' };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {list.map((p) => (
          <div key={p.id} className="border border-gray-100 rounded-xl overflow-hidden">
            {p.imageUrl ? <img src={p.imageUrl} alt={p.title} className="w-full h-28 object-cover bg-gray-50" loading="lazy" /> : <div className="w-full h-28 bg-gray-50 flex items-center justify-center text-gray-300 text-xs">이미지 없음</div>}
            <div className="p-2.5">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-xs font-black text-gray-700 truncate">{p.title}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${badge[p.status] ?? ''}`}>{label[p.status] ?? p.status}</span>
              </div>
              {p.claimCode && <p className="text-[10px] font-bold text-[#2AB5A0]">{p.claimCode}</p>}
              {(p.status === 'available' || p.status === 'assigned') && (
                <button onClick={() => { if (confirm('이 기프티콘을 무효 처리할까요?')) onVoid(p.id); }} className="mt-1 text-[10px] text-red-400 font-bold">무효 처리</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── 공용 소품 ─────────────────────────
function Chip({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-bold text-[#2AB5A0] bg-[#E8F8F5] border border-[#3CDBC0]/30 px-2.5 py-1 rounded-full">{children}</span>;
}
function groupCourses(picks: CoursePick[]): [string, CoursePick[]][] {
  const m = new Map<string, CoursePick[]>();
  for (const p of picks) { const a = m.get(p.course) ?? []; a.push(p); m.set(p.course, a); }
  return [...m.entries()];
}
function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="bg-[#F5FBF8] rounded-2xl px-4 py-3">
      <p className="text-[11px] font-bold text-[#2AB5A0] uppercase tracking-widest mb-2">{title}</p>
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
function ImageGroup({ title, urls }: { title: string; urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {urls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-gray-100 bg-gray-50 aspect-square">
            <img src={url} alt={title} className="w-full h-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}
