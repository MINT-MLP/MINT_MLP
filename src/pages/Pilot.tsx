import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/services/supabase';
import {
  getPilotHandoffs, markPilotHandoffUsed, summaryLine, topPlaceName, relativeTime,
} from '@/storage/pilotHandoff';
import type { PilotHandoff, CoursePick, PilotPrizeReward } from '@/types';
import { Icon } from '@/components/icons';

type Phase = 'detect' | 'form-auto' | 'form-manual' | 'spinning' | 'reward' | 'soldout' | 'reclaim' | 'done';

const BUCKET = 'pilot-feedback';

type VisitChoice = { choice: string; otherName: string }; // choice: placeName | '__other' | '__none'

const REASON_OPTS = ['메뉴', '거리·위치', '가격', '분위기', '리뷰·평점', '인증 뱃지'];
const ISSUE_OPTS = ['맛', '가격', '웨이팅', '서비스', '분위기', '추천 설명과 달랐어요'];
const BUDGET_OPTS = [{ v: 'ok', l: '예산 안에서 해결' }, { v: 'slightly', l: '약간 초과' }, { v: 'over', l: '많이 초과' }];
const REUSE_OPTS = [{ v: 'always', l: '무조건 쓸래요' }, { v: 'conditional', l: '조건 맞으면' }, { v: 'no', l: '글쎄요' }];

function makeId(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = 'pf';
  for (let i = 0; i < 14; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function fileLabel(files: File[]): string {
  if (files.length === 0) return '이미지 선택';
  if (files.length === 1) return files[0].name;
  return `${files.length}개 선택됨`;
}

async function uploadFiles(id: string, group: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const path = `${id}/${group}/${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '31536000', contentType: file.type || 'image/jpeg', upsert: false,
    });
    if (error) throw new Error(`이미지 업로드에 실패했어요: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

export default function Pilot() {
  const handoffs = useMemo(() => getPilotHandoffs(), []);
  const [phase, setPhase] = useState<Phase>(() => (getPilotHandoffs().length > 0 ? 'detect' : 'form-manual'));
  const [selected, setSelected] = useState<PilotHandoff | null>(null);

  // 공통 결과
  const [prize, setPrize] = useState<PilotPrizeReward | null>(null);
  const [claimCode, setClaimCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 인증 + 평가 공통
  const [paymentFiles, setPaymentFiles] = useState<File[]>([]);
  const [fitRating, setFitRating] = useState(0);
  const [fitText, setFitText] = useState('');

  // auto 전용
  const [visited, setVisited] = useState<Record<string, VisitChoice>>({});
  const [reason, setReason] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [budget, setBudget] = useState<string | null>(null);
  const [vibeFit, setVibeFit] = useState(0);
  const [reuse, setReuse] = useState<string | null>(null);

  // manual 전용
  const [manualPlace, setManualPlace] = useState('');

  async function runSubmit(payload: Record<string, unknown>) {
    setSubmitting(true); setError(null);
    const id = makeId();
    try {
      const paymentImagePaths = await uploadFiles(id, 'payment', paymentFiles);
      const res = await fetch('/api/pilot-feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, paymentImagePaths, fitRating, fitText: fitText.trim(), ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '제출에 실패했어요. 잠시 후 다시 시도해주세요.');
      if (selected) markPilotHandoffUsed(selected.serial);
      setClaimCode(data.claimCode ?? '');
      if (data.prize) { setPrize(data.prize); setPhase('spinning'); } else { setPhase('soldout'); }
    } catch (e) {
      setError((e as Error).message);
    } finally { setSubmitting(false); }
  }

  // ── 라우팅 ──
  if (phase === 'spinning') return <Roulette onDone={() => setPhase('reward')} />;
  if (phase === 'reward' && prize) return <RewardView prize={prize} onClose={() => setPhase('done')} />;
  if (phase === 'soldout') return <SoldOutView claimCode={claimCode} onClose={() => setPhase('done')} />;
  if (phase === 'reclaim') return <ReclaimView onBack={() => setPhase(handoffs.length > 0 ? 'detect' : 'form-manual')} />;
  if (phase === 'done') return <DoneView claimCode={claimCode} />;

  if (phase === 'detect') {
    return (
      <Shell onReclaim={() => setPhase('reclaim')}>
        <Hero />
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-black text-gray-800 mb-1">어떤 추천으로 다녀오셨어요?</p>
          <p className="text-xs text-gray-400 mb-4">최근 받으신 추천이에요. 맞는 걸 고르면 조건 입력 없이 바로 인증할 수 있어요.</p>
          <div className="flex flex-col gap-2.5">
            {handoffs.map((h) => (
              <button key={h.serial} onClick={() => {
                  setSelected(h);
                  setVisited({}); setReason([]); setIssues([]); setBudget(null); setVibeFit(0); setReuse(null); setFitRating(0); setFitText('');
                  setPhase('form-auto');
                }}
                className="text-left border-2 border-gray-200 rounded-2xl p-4 hover:border-mint-500 active:scale-[0.99] transition-all">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-base font-black text-gray-800 truncate"><Icon name="meal" className="mr-1" />{topPlaceName(h)}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{relativeTime(h.createdAt)}</span>
                </div>
                <p className="text-xs text-mint-600 font-bold">{summaryLine(h.conditions) || '추천 조건'}</p>
              </button>
            ))}
          </div>
          <button onClick={() => setPhase('form-manual')} className="w-full mt-3 py-2.5 text-sm font-bold text-gray-400">
            여기 없어요 / 다른 방법으로 참여
          </button>
        </section>
      </Shell>
    );
  }

  if (phase === 'form-auto' && selected) {
    const groups = groupByCourse(selected.coursePicks);
    const primaryCourse = groups[0]?.[0] ?? null;
    const primaryAnswered = primaryCourse ? !!visited[primaryCourse]?.choice : true;
    const canSubmit = paymentFiles.length > 0 && fitRating > 0 && primaryAnswered && !submitting;

    function submit() {
      if (!canSubmit) { setError('실제 방문 장소, 만족도 별점, 결제 인증을 채워주세요.'); return; }
      const visitedArr = Object.entries(visited).map(([course, v]) => ({
        course, choice: v.choice, ...(v.choice === '__other' && v.otherName ? { otherName: v.otherName.trim().slice(0, 60) } : {}),
      }));
      const firstChosen = Object.values(visited).find((v) => v.choice && v.choice !== '__other' && v.choice !== '__none')?.choice
        ?? selected!.conditions.region ?? null;
      runSubmit({
        serial: selected!.serial,
        entryType: 'auto',
        recSnapshot: { conditions: selected!.conditions, coursePicks: selected!.coursePicks },
        visited: visitedArr,
        qaAnswers: { reason, issues: fitRating <= 3 ? issues : [], budget, vibeFit: vibeFit || null, reuse },
        placeName: firstChosen,
      });
    }

    return (
      <Shell onReclaim={() => setPhase('reclaim')}>
        <button onClick={() => setPhase('detect')} className="text-xs font-bold text-gray-400 mb-3">← 다시 고르기</button>

        {/* 확인 */}
        <section className="bg-mint-100 border border-mint-500/30 rounded-2xl p-5 mb-4">
          <p className="text-sm font-black text-mint-600 mb-1">이 추천으로 다녀오신 거 맞죠?</p>
          <p className="text-xs text-mint-600/80 mb-3">{summaryLine(selected.conditions) || '추천 조건'}</p>
          <div className="flex flex-wrap gap-1.5">
            {selected.coursePicks.map((p) => (
              <span key={`${p.course}-${p.rank}`} className="text-[11px] font-bold text-mint-600 bg-white border border-mint-500/30 px-2.5 py-1 rounded-full">
                {p.course} {p.rank}. {p.placeName}
              </span>
            ))}
          </div>
        </section>

        {/* 실제 방문 */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-black text-gray-800">실제로 어디 다녀오셨어요?</p>
              <p className="text-xs text-gray-400 mt-0.5">추천 중에 실제 방문한 곳을 골라주세요.</p>
            </div>
            <span className="text-[10px] font-bold text-red-400 bg-red-50 px-2 py-0.5 rounded-full">필수</span>
          </div>
          {groups.map(([course, picks]) => {
            const v = visited[course] ?? { choice: '', otherName: '' };
            const setChoice = (choice: string) => setVisited((prev) => ({ ...prev, [course]: { choice, otherName: prev[course]?.otherName ?? '' } }));
            return (
              <div key={course} className="mb-3 last:mb-0">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">{course}</p>
                <div className="flex flex-col gap-1.5">
                  {picks.map((p) => (
                    <VisitOpt key={p.placeName} on={v.choice === p.placeName} onClick={() => setChoice(p.placeName)} label={`${p.rank}. ${p.placeName}`} sub={p.category ?? undefined} />
                  ))}
                  <VisitOpt on={v.choice === '__other'} onClick={() => setChoice('__other')} label="다른 곳에 갔어요" />
                  <VisitOpt on={v.choice === '__none'} onClick={() => setChoice('__none')} label="이 코스는 안 갔어요" />
                  {v.choice === '__other' && (
                    <input value={v.otherName} onChange={(e) => setVisited((prev) => ({ ...prev, [course]: { choice: '__other', otherName: e.target.value } }))}
                      placeholder="실제 가신 가게 이름 (선택)" maxLength={60}
                      className="mt-1 w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-mint-500" />
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Q&A */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4 flex flex-col gap-5">
          <div>
            <QLabel required>다녀온 곳, 어떠셨어요?</QLabel>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setFitRating(n)} aria-label={`${n}점`}
                  className={`w-11 h-11 rounded-xl border-2 text-xl transition-all active:scale-95 ${fitRating >= n ? 'border-mint-500 bg-mint-100 text-mint-600' : 'border-gray-200 bg-white text-gray-300'}`}><Icon name="star" className={fitRating >= n ? 'fill-current' : undefined} /></button>
              ))}
            </div>
            {fitRating > 0 && fitRating <= 3 && (
              <div className="mt-3">
                <p className="text-[11px] text-gray-400 mb-2">아쉬웠던 점 (여러 개 가능)</p>
                <ChipRow opts={ISSUE_OPTS} sel={issues} onToggle={(o) => toggle(setIssues, issues, o)} />
              </div>
            )}
          </div>

          <div>
            <QLabel>그곳을 고른 결정적 이유는? <span className="text-gray-300">· 최대 2개</span></QLabel>
            <ChipRow opts={REASON_OPTS} sel={reason} onToggle={(o) => toggleMax(setReason, reason, o, 2)} />
          </div>

          <div>
            <QLabel>입력하신 예산과 실제 지출은?</QLabel>
            <div className="grid grid-cols-3 gap-2">
              {BUDGET_OPTS.map((o) => <PickBtn key={o.v} on={budget === o.v} onClick={() => setBudget(budget === o.v ? null : o.v)} label={o.l} />)}
            </div>
          </div>

          <div>
            <QLabel>원하신 분위기랑 실제로 얼마나 맞았나요?</QLabel>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setVibeFit(n)} aria-label={`${n}점`}
                  className={`flex-1 h-10 rounded-xl border-2 text-sm font-bold transition-all active:scale-95 ${vibeFit >= n ? 'border-mint-500 bg-mint-100 text-mint-600' : 'border-gray-200 bg-white text-gray-300'}`}>{n}</button>
              ))}
            </div>
          </div>

          <div>
            <QLabel>다음 모임도 MINT 추천으로?</QLabel>
            <div className="grid grid-cols-3 gap-2">
              {REUSE_OPTS.map((o) => <PickBtn key={o.v} on={reuse === o.v} onClick={() => setReuse(reuse === o.v ? null : o.v)} label={o.l} />)}
            </div>
          </div>

          <div>
            <QLabel>딱 하나만 고친다면? <span className="text-gray-300">· 선택</span></QLabel>
            <textarea value={fitText} onChange={(e) => setFitText(e.target.value)} placeholder="한 줄이면 충분해요. 건너뛰어도 돼요."
              className="w-full min-h-16 resize-none border-2 border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-mint-500" />
          </div>
        </section>

        <PaymentBox files={paymentFiles} onChange={setPaymentFiles} />
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 text-center my-3">{error}</div>}
        <SubmitBtn onClick={submit} disabled={!canSubmit} submitting={submitting} />
      </Shell>
    );
  }

  // ── 수동 폴백 (일련번호 없이 온 유저) ──
  const canSubmitManual = paymentFiles.length > 0 && fitRating > 0 && !submitting;
  function submitManual() {
    if (!canSubmitManual) { setError('다녀온 곳, 만족도 별점, 결제 인증을 채워주세요.'); return; }
    runSubmit({ entryType: 'manual', placeName: manualPlace.trim() || null });
  }

  return (
    <Shell onReclaim={() => setPhase('reclaim')}>
      <Hero />
      {handoffs.length > 0 && (
        <button onClick={() => setPhase('detect')} className="text-xs font-bold text-mint-600 bg-mint-100 border border-mint-500/30 px-3 py-2 rounded-xl mb-4 w-full">
          ← 최근 추천 기록으로 간편하게 참여하기
        </button>
      )}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <p className="text-sm font-black text-gray-800 mb-1">어디 다녀오셨어요?</p>
        <p className="text-xs text-gray-400 mb-3">MINT 추천으로 방문한 가게 이름을 적어주세요.</p>
        <input value={manualPlace} onChange={(e) => setManualPlace(e.target.value)} placeholder="예: ○○집 (홍대)" maxLength={60}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-mint-500" />
      </section>
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <QLabel required>다녀온 곳, 어떠셨어요?</QLabel>
        <div className="flex gap-1.5 mb-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setFitRating(n)} aria-label={`${n}점`}
              className={`w-11 h-11 rounded-xl border-2 text-xl transition-all active:scale-95 ${fitRating >= n ? 'border-mint-500 bg-mint-100 text-mint-600' : 'border-gray-200 bg-white text-gray-300'}`}><Icon name="star" className={fitRating >= n ? 'fill-current' : undefined} /></button>
          ))}
        </div>
        <textarea value={fitText} onChange={(e) => setFitText(e.target.value)} placeholder="조건에 잘 맞았는지, 아쉬운 점은 없었는지 한 줄이면 충분해요."
          className="w-full min-h-20 resize-none border-2 border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-mint-500" />
      </section>
      <PaymentBox files={paymentFiles} onChange={setPaymentFiles} />
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 text-center my-3">{error}</div>}
      <SubmitBtn onClick={submitManual} disabled={!canSubmitManual} submitting={submitting} />
    </Shell>
  );
}

// ───────────────────────── 레이아웃/소품 ─────────────────────────
function Shell({ children, onReclaim }: { children: ReactNode; onReclaim: () => void }) {
  return (
    <div className="min-h-[100dvh] bg-mint-50">
      <div className="max-w-md mx-auto px-5 pt-5 pb-10">
        <header className="flex items-center justify-between mb-6">
          <button onClick={() => { window.location.href = '/'; }} className="text-xl font-black text-mint-500 tracking-tight">MINT</button>
          <div className="flex items-center gap-2">
            <button onClick={onReclaim} className="text-xs font-bold text-mint-600 bg-mint-100 border border-mint-500/30 px-3 py-1.5 rounded-full active:scale-95">당첨코드로 다시 받기</button>
            <button onClick={() => { window.location.href = '/pilot-admin'; }} className="text-xs font-bold text-gray-400 bg-white border border-gray-100 px-3 py-1.5 rounded-full active:scale-95">관리자</button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="mb-5">
      <div className="inline-flex items-center gap-1.5 bg-mint-100 border border-mint-500/30 text-mint-600 text-xs font-bold px-3 py-1 rounded-full mb-3">✦ MINT 선발대</div>
      <h1 className="text-3xl font-black text-gray-800 leading-tight mb-2">다녀온 인증만 하면<br />그 자리에서 100% 당첨</h1>
      <p className="text-sm text-gray-500 leading-relaxed">MINT 추천으로 다녀온 곳을 인증하고 짧은 후기를 남기면, <strong className="text-mint-600">꽝 없는 룰렛</strong>으로 기프티콘을 바로 받아요.</p>
    </section>
  );
}

function QLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <p className="text-sm font-black text-gray-800">{children}</p>
      {required && <span className="text-[10px] font-bold text-red-400 bg-red-50 px-2 py-0.5 rounded-full">필수</span>}
    </div>
  );
}

function VisitOpt({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`flex items-center justify-between text-left rounded-xl border-2 px-4 py-2.5 transition-all active:scale-[0.99] ${on ? 'border-mint-500 bg-mint-100' : 'border-gray-200 bg-white'}`}>
      <span className={`text-sm font-bold ${on ? 'text-mint-600' : 'text-gray-700'}`}>{label}{sub && <span className="text-gray-400 font-medium"> · {sub}</span>}</span>
      <span className={`w-4 h-4 rounded-full border-2 ${on ? 'border-mint-500 bg-mint-500' : 'border-gray-300'}`} />
    </button>
  );
}

function ChipRow({ opts, sel, onToggle }: { opts: string[]; sel: string[]; onToggle: (o: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((o) => {
        const on = sel.includes(o);
        return (
          <button key={o} onClick={() => onToggle(o)}
            className={`px-3 py-1.5 rounded-full border-2 text-xs font-bold transition-all active:scale-95 ${on ? 'border-mint-500 bg-mint-100 text-mint-600' : 'border-gray-200 bg-white text-gray-600'}`}>{o}</button>
        );
      })}
    </div>
  );
}

function PickBtn({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`py-2.5 rounded-xl border-2 text-xs font-bold transition-all active:scale-95 ${on ? 'border-mint-500 bg-mint-100 text-mint-600' : 'border-gray-200 bg-white text-gray-600'}`}>{label}</button>
  );
}

function PaymentBox({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-black text-gray-800">결제 인증 이미지</p>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">영수증·카드 승인·결제 내역 등 방문 결제가 보이는 이미지.</p>
        </div>
        <span className="text-[10px] font-bold text-red-400 bg-red-50 px-2 py-0.5 rounded-full shrink-0">필수</span>
      </div>
      <label className="block border-2 border-dashed border-mint-500/60 rounded-2xl bg-mint-50 px-4 py-5 text-center active:scale-[0.99] transition-all cursor-pointer">
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onChange(Array.from(e.target.files ?? []))} />
        <span className="block text-2xl mb-1">＋</span>
        <span className="block text-sm font-black text-mint-600 truncate">{fileLabel(files)}</span>
      </label>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {files.map((file) => (
            <span key={`${file.name}-${file.size}`} className="max-w-full truncate text-xs font-bold text-mint-600 bg-mint-100 px-2.5 py-1 rounded-full">{file.name}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function SubmitBtn({ onClick, disabled, submitting }: { onClick: () => void; disabled: boolean; submitting: boolean }) {
  return (
    <>
      <button onClick={onClick} disabled={disabled}
        className={`w-full mt-3 py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${!disabled ? 'bg-mint-500 text-white shadow-lg shadow-mint-500/30 hover:bg-mint-600' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
        {submitting ? '제출 중...' : <><Icon name="gift" className="mr-1" />제출하고 룰렛 돌리기</>}
      </button>
      <p className="text-center text-[11px] text-gray-400 mt-2">꽝 없는 룰렛 · 제출하면 그 자리에서 100% 당첨돼요</p>
    </>
  );
}

// ───────────────────────── 헬퍼 ─────────────────────────
function groupByCourse(picks: CoursePick[]): [string, CoursePick[]][] {
  const m = new Map<string, CoursePick[]>();
  for (const p of picks) {
    const arr = m.get(p.course) ?? [];
    arr.push(p); m.set(p.course, arr);
  }
  return [...m.entries()];
}
function toggle(set: (v: string[]) => void, cur: string[], o: string) {
  set(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
}
function toggleMax(set: (v: string[]) => void, cur: string[], o: string, max: number) {
  if (cur.includes(o)) set(cur.filter((x) => x !== o));
  else if (cur.length < max) set([...cur, o]);
}

// ───────────────────────── 룰렛 (꽝 칸은 있지만 확률 0%) ─────────────────────────
const SLICES = 8;
const SLICE_DEG = 360 / SLICES;
const PRIZE_INDEX = 0;

function Roulette({ onDone }: { onDone: () => void }) {
  const [rot, setRot] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    const center = PRIZE_INDEX * SLICE_DEG + SLICE_DEG / 2;
    const target = 360 * 6 + (360 - center);
    const t = setTimeout(() => setRot(target), 60);
    const fallback = setTimeout(() => { if (!firedRef.current) { firedRef.current = true; onDone(); } }, 5200);
    return () => { clearTimeout(t); clearTimeout(fallback); };
  }, [onDone]);

  const gradient = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i < SLICES; i++) parts.push(`${i % 2 === 0 ? 'rgb(var(--mint-500))' : '#E5E7EB'} ${i * SLICE_DEG}deg ${(i + 1) * SLICE_DEG}deg`);
    return `conic-gradient(${parts.join(', ')})`;
  }, []);

  return (
    <div className="min-h-[100dvh] bg-mint-50 flex flex-col items-center justify-center px-6">
      <p className="text-2xl font-black text-gray-800 mb-1"><Icon name="party" className="mr-1" />꽝 없는 룰렛</p>
      <p className="text-sm text-gray-500 mb-8">100% 당첨! 어떤 상품이 걸릴까요?</p>
      <div className="relative w-72 h-72">
        <div className="absolute left-1/2 -top-2 -translate-x-1/2 z-20"
          style={{ width: 0, height: 0, borderLeft: '14px solid transparent', borderRight: '14px solid transparent', borderTop: '22px solid #FF6B6B' }} />
        <div className="absolute inset-0 rounded-full border-8 border-white shadow-xl"
          style={{ background: gradient, transform: `rotate(${rot}deg)`, transition: 'transform 4.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
          onTransitionEnd={() => { if (!firedRef.current) { firedRef.current = true; onDone(); } }}>
          {Array.from({ length: SLICES }).map((_, i) => {
            const angle = i * SLICE_DEG + SLICE_DEG / 2;
            const prize = i % 2 === 0;
            return (
              <div key={i} className="absolute left-1/2 top-1/2" style={{ transform: `rotate(${angle}deg) translateY(-92px)` }}>
                <span className="block -translate-x-1/2 text-lg font-black" style={{ transform: `rotate(${-angle}deg)`, color: prize ? '#fff' : '#9CA3AF' }}>
                  {prize ? <Icon name="gift" /> : '꽝'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white shadow-md border-2 border-mint-500 flex items-center justify-center z-10 text-xl"><Icon name="target" /></div>
      </div>
    </div>
  );
}

// ───────────────────────── 수령 / 소진 / 재수령 / 완료 ─────────────────────────
function RewardView({ prize, onClose, reclaimed = false }: { prize: PilotPrizeReward; onClose: () => void; reclaimed?: boolean }) {
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  function copyCode() { navigator.clipboard?.writeText(prize.claimCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }
  async function finish() {
    if (!reclaimed && contact.trim()) {
      setSaving(true);
      try { await fetch('/api/pilot-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-contact', code: prize.claimCode, contact: contact.trim() }) }); } catch { /* 선택사항 */ }
      setSaving(false);
    }
    onClose();
  }
  return (
    <div className="min-h-[100dvh] bg-mint-50 flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-mint-500/30 shadow-xl shadow-mint-500/10 px-6 py-7 text-center animate-fade-in-up">
        <div className="inline-flex items-center gap-1.5 bg-mint-100 text-mint-600 text-xs font-black px-3 py-1 rounded-full mb-3"><Icon name="party" />100% 당첨</div>
        <p className="text-2xl font-black text-gray-800 mb-1">{prize.title}</p>
        <p className="text-xs text-gray-400 mb-4">지금 <strong className="text-mint-600">스크린샷으로 저장</strong>하세요!</p>
        {prize.imageUrl ? (
          <a href={prize.imageUrl} target="_blank" rel="noreferrer" className="block rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 mb-4">
            <img src={prize.imageUrl} alt={prize.title} className="w-full object-contain max-h-80" />
          </a>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 py-10 mb-4 text-sm text-gray-400">이미지를 불러오지 못했어요.<br />아래 당첨코드로 다시 받아주세요.</div>
        )}
        <div className="bg-mint-50 border border-mint-500/30 rounded-2xl px-4 py-3 mb-4">
          <p className="text-[11px] text-gray-400 mb-1">당첨코드 (재수령용 · 꼭 보관)</p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-xl font-black tracking-widest text-mint-600">{prize.claimCode}</span>
            <button onClick={copyCode} className="text-xs font-bold text-mint-600 bg-mint-100 border border-mint-500/30 px-2.5 py-1 rounded-full active:scale-95">{copied ? '복사됨!' : '복사'}</button>
          </div>
        </div>
        {!reclaimed && (
          <div className="mb-4 text-left">
            <p className="text-[11px] text-gray-400 mb-1">혹시 몰라 재발송 받을 연락처 <span className="text-gray-300">(선택)</span></p>
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="카톡ID / 이메일 / 전화 (안 적어도 돼요)" maxLength={100}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-mint-500" />
          </div>
        )}
        <button onClick={finish} disabled={saving} className="w-full py-4 rounded-2xl bg-mint-500 text-white font-black text-base active:scale-95 transition-all disabled:opacity-60">
          {saving ? '저장 중...' : reclaimed ? '닫기' : '저장했어요, 완료'}
        </button>
      </div>
    </div>
  );
}

function SoldOutView({ claimCode, onClose }: { claimCode: string; onClose: () => void }) {
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!contact.trim()) { setErr('연락처를 입력해주세요.'); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/pilot-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-contact', code: claimCode, contact: contact.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장에 실패했어요.');
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <div className="min-h-[100dvh] bg-mint-50 flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-mint-500/30 shadow-xl shadow-mint-500/10 px-6 py-7 text-center animate-fade-in-up">
        <Icon name="gift" className="text-4xl mb-3 text-mint-500" />
        <p className="text-2xl font-black text-gray-800 mb-1">당첨 확정!</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-4">상품이 잠시 품절이라 <strong className="text-mint-600">충전 즉시 보내드릴게요.</strong> 이번만 연락처를 남겨주세요.</p>
        <div className="bg-mint-50 border border-mint-500/30 rounded-2xl px-4 py-3 mb-4">
          <p className="text-[11px] text-gray-400 mb-1">당첨코드 (꼭 보관 · 이 코드로도 수령 가능)</p>
          <span className="text-xl font-black tracking-widest text-mint-600">{claimCode}</span>
        </div>
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="카톡ID / 이메일 / 전화번호" maxLength={100}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-mint-500 mb-1 text-center" />
        {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
        <button onClick={save} disabled={saving} className="w-full mt-3 py-4 rounded-2xl bg-mint-500 text-white font-black text-base active:scale-95 transition-all disabled:opacity-60">{saving ? '저장 중...' : '연락처 남기기'}</button>
      </div>
    </div>
  );
}

function ReclaimView({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prize, setPrize] = useState<PilotPrizeReward | null>(null);
  const [pending, setPending] = useState(false);
  async function lookup() {
    const c = code.trim().toUpperCase();
    if (!/^MINT-[A-Z0-9]{5}$/.test(c)) { setErr('MINT-XXXXX 형식의 당첨코드를 입력해주세요.'); return; }
    setLoading(true); setErr(null); setPending(false);
    try {
      const res = await fetch('/api/pilot-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reclaim', code: c }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '조회에 실패했어요.');
      if (data.pending) { setPending(true); return; }
      if (data.prize) setPrize({ ...data.prize, claimCode: c });
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }
  if (prize) return <RewardView prize={prize} onClose={onBack} reclaimed />;
  return (
    <div className="min-h-[100dvh] bg-mint-50 flex items-center justify-center px-5">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-gray-100 shadow-sm px-6 py-8 text-center">
        <Icon name="ticket" className="text-3xl mb-3 text-mint-500" />
        <h1 className="text-lg font-black text-gray-800 mb-1">당첨코드로 다시 받기</h1>
        <p className="text-sm text-gray-400 mb-5">받았던 당첨코드(MINT-XXXXX)를 입력하면 기프티콘을 다시 보여드려요.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MINT-XXXXX" maxLength={10} onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-center text-lg font-black tracking-widest uppercase text-mint-600 placeholder-gray-300 focus:outline-none focus:border-mint-500" />
        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
        {pending && <p className="text-xs text-mint-600 mt-2">아직 상품 충전 대기 중이에요. 곧 지급되면 이 코드로 받을 수 있어요.</p>}
        <button onClick={lookup} disabled={loading} className="w-full mt-4 py-3.5 rounded-xl bg-mint-500 text-white font-black active:scale-95 transition-all disabled:opacity-60">{loading ? '조회 중...' : '기프티콘 받기'}</button>
        <button onClick={onBack} className="w-full mt-2 py-2 text-sm font-bold text-gray-400">돌아가기</button>
      </div>
    </div>
  );
}

function DoneView({ claimCode }: { claimCode: string }) {
  return (
    <div className="min-h-[100dvh] bg-mint-50 flex items-center justify-center px-5">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-mint-500/30 shadow-xl shadow-mint-500/10 px-6 py-8 text-center animate-fade-in-up">
        <div className="w-20 h-20 rounded-full bg-mint-500 mx-auto mb-5 flex items-center justify-center shadow-lg shadow-mint-500/30">
          <span className="text-white text-4xl font-black">✓</span>
        </div>
        <p className="text-2xl font-black text-gray-800 mb-2">참여 완료!</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-2">소중한 선발대 데이터 정말 감사합니다.</p>
        {claimCode && (
          <p className="text-sm text-gray-500 leading-relaxed mb-6">당첨코드 <strong className="text-mint-600">{claimCode}</strong> 는 꼭 보관하세요.<br />언제든 <strong>당첨코드로 다시 받기</strong>로 재수령할 수 있어요.</p>
        )}
        <button onClick={() => { window.location.href = '/'; }} className="w-full py-4 rounded-2xl bg-mint-500 text-white font-black text-base active:scale-95 transition-all">MINT로 돌아가기</button>
      </div>
    </div>
  );
}
