import { useEffect, useState } from 'react';
import { congestionDotClass } from '@/services/seoulData';
import { MiniMap, WishlistButton, VisitCertModal } from '@/components';
import { trackEvent } from '@/services/analytics';
import { getDeviceId } from '@/storage/device';
import type { VoteCandidate, SlimPlace, SnapshotPayload } from '@/types';
import { COURSE_TONE, type CourseTone } from '@/constants/colors';
import { cn } from '@/utils/cn';

// 공유 URL에 실려오는 투표 후보 (슬림 포맷: n=이름, c=카테고리, s=적합도)

// 공유 스냅샷의 장소 1곳 — 서버(/shared?id=)와 레거시(?data=) 렌더 경로를 통일

// 투표자 식별 — 기기당 1표 (로그인 없는 서비스라 localStorage 익명 ID)
function getVoterId(): string {
  try {
    let id = localStorage.getItem('mint_voter_id');
    if (!id) {
      id = 'v';
      const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
      for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
      localStorage.setItem('mint_voter_id', id);
    }
    return id;
  } catch {
    return 'vanonymous';
  }
}

function VoteSection({ shareId, candidates }: { shareId: string; candidates: VoteCandidate[] }) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  // 이 기기에서 이미 투표했으면 복원 (기기당 1표)
  const [myChoice, setMyChoice] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(`mint_vote_${shareId}`);
      return saved !== null ? Number(saved) : null;
    } catch {
      return null;
    }
  });
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    fetch(`/api/share-vote?id=${encodeURIComponent(shareId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.disabled) setDisabled(true);
        else if (d.counts) setCounts(d.counts);
      })
      .catch(() => setDisabled(true));
  }, [shareId]);

  function vote(choice: number) {
    if (disabled) return;
    const prev = myChoice;
    if (prev === choice) return; // 같은 후보 재클릭은 무시 (한 기기 1표 유지)
    // 낙관적 업데이트 — 재투표는 이전 표를 옮긴다
    setMyChoice(choice);
    setCounts((c) => {
      const next = { ...c, [choice]: (c[choice] ?? 0) + 1 };
      if (prev !== null) next[prev] = Math.max(0, (next[prev] ?? 1) - 1);
      return next;
    });
    try { localStorage.setItem(`mint_vote_${shareId}`, String(choice)); } catch { /* ignore */ }
    fetch('/api/share-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId, voterId: getVoterId(), choice, placeName: candidates[choice]?.n }),
    }).catch(() => {});
  }

  if (disabled) return null;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm mb-4 animate-fade-in-up">
      <p className="text-sm font-black text-gray-800 mb-0.5">🙌 어디가 제일 좋아요?</p>
      <p className="text-[11px] text-gray-500 mb-3">
        투표하면 모두에게 집계가 보여요{total > 0 ? ` · 지금까지 ${total}표` : ''}
      </p>
      <div className="flex flex-col gap-2">
        {candidates.map((c, i) => {
          const n = counts[i] ?? 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          const mine = myChoice === i;
          return (
            <button
              key={i}
              onClick={() => vote(i)}
              className={`relative overflow-hidden text-left rounded-xl border-2 px-3 py-2.5 transition-all active:scale-[0.99] ${
                mine ? 'border-mint-500 bg-mint-100' : 'border-gray-200 bg-white hover:border-mint-500/50'
              }`}
            >
              {/* 득표율 바 */}
              {total > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-mint-500/10 transition-all"
                  style={{ width: `${pct}%` }}
                />
              )}
              <div className="relative flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-black truncate ${mine ? 'text-mint-800' : 'text-gray-800'}`}>
                    {i === 0 ? '⭐ ' : ''}{c.n}
                  </p>
                  {c.c && <p className="text-[10px] text-gray-500 truncate">{c.c}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.s != null && (
                    <span className="text-[10px] font-bold text-mint-600 bg-white/80 border border-mint-500/30 px-1.5 py-0.5 rounded-full">
                      {c.s}점
                    </span>
                  )}
                  <span className={`text-xs font-black ${mine ? 'text-mint-600' : 'text-gray-500'}`}>
                    👍 {n}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SharedResult() {
  const [result, setResult] = useState<SnapshotPayload | null>(null);
  const [error, setError] = useState(false);
  const [showCert, setShowCert] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    // 신버전: /shared?id=<shareId> → 서버 스냅샷 조회(1·2·3차 풀코스)
    if (id && /^[a-z0-9_-]{6,40}$/i.test(id)) {
      fetch(`/api/share-vote?id=${encodeURIComponent(id)}&type=snapshot`)
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          const p = d?.payload;
          if (!ok || d?.disabled || !p?.first?.placeName || !Array.isArray(p.first.vibeTags)) throw new Error('bad snapshot');
          setResult(p as SnapshotPayload);
        })
        .catch(() => setError(true));
      return;
    }
    // 레거시: /shared?data=<json> → 1차만. 스냅샷 형태로 승격해 렌더 경로를 하나로.
    // (URLSearchParams.get()이 이미 1회 디코드하므로 추가 decodeURIComponent 금지 — '%' 포함 데이터 URIError 방지)
    try {
      const data = params.get('data');
      if (!data) throw new Error('no data');
      const parsed = JSON.parse(data);
      if (!parsed?.placeName || !Array.isArray(parsed.vibeTags)) throw new Error('malformed payload');
      setResult({ first: parsed as SlimPlace, shareId: parsed.shareId, candidates: parsed.candidates });
    } catch {
      setError(true);
    }
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-mint-50 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-4xl mb-4">😔</div>
        <p className="text-gray-600 mb-6">링크가 올바르지 않아요.</p>
        <a href="/" className="px-6 py-3 bg-mint-500 text-white rounded-2xl font-bold">
          MINT로 직접 정하기
        </a>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen bg-mint-50 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-mint-500 border-t-transparent rounded-full animate-spin-slow" />
      </div>
    );
  }

  const f = result.first;
  const mapLink = (p: SlimPlace) =>
    p.kakaoPlaceUrl
    || (p.lat && p.lng
      ? `https://map.kakao.com/link/to/${encodeURIComponent(p.placeName)},${p.lat},${p.lng}`
      : `https://map.kakao.com/link/search/${encodeURIComponent(p.placeName)}`);

  return (
    <div className="min-h-screen bg-mint-50">
      <div className="max-w-md mx-auto px-4 pb-10 pt-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black text-mint-600">MINT</h1>
          <p className="text-sm text-gray-500 mt-1">오늘의 추천 {result.second ? '코스' : '장소'}</p>
        </div>

        {/* 오늘의 총무 */}
        {result.treasurer && (
          <div className="mb-4 bg-yellow-100 border border-yellow-200 rounded-2xl px-4 py-2.5 text-center animate-fade-in-up">
            <p className="text-sm font-bold text-yellow-800">🎲 오늘의 총무는 <strong>{result.treasurer}</strong>에서 출발!</p>
          </div>
        )}

        {/* 메인 카드(1차) */}
        <div className="bg-course-first rounded-3xl overflow-hidden text-white shadow-xl shadow-mint-500/30 mb-4 animate-fade-in-up">
          {f.imageUrl && (
            <img src={f.imageUrl} alt={f.placeName} className="w-full h-40 object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
          <div className="p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold opacity-80 bg-white/20 px-2.5 py-1 rounded-full">
                {result.purposeFirst ? `1차 · ${result.purposeFirst}` : f.category}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {f.congestionLevel && (
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${congestionDotClass(f.congestionLevel as Parameters<typeof congestionDotClass>[0])}`} />
                    <span className="text-xs opacity-90">{f.congestionLevel}</span>
                  </div>
                )}
                <WishlistButton place={f} rank="first" source="shared" tone="onDark" />
              </div>
            </div>

            <h2 className="text-2xl font-black mt-3 mb-1 leading-tight">
              오늘은<br /><span className="text-3xl">{f.placeName}</span>
            </h2>
            {f.description && (
              <p className="text-sm font-semibold opacity-95 mb-3 leading-snug bg-white/15 rounded-xl px-3 py-2">
                💬 {f.description}
              </p>
            )}

            <div className="flex flex-wrap gap-1.5 mb-4">
              {(f.vibeTags ?? []).map((tag) => (
                <span key={tag} className="text-xs bg-white/20 px-2.5 py-1 rounded-full font-medium">#{tag}</span>
              ))}
            </div>

            <div className="bg-white/15 rounded-2xl p-3 flex flex-col gap-1.5">
              <div className="flex items-start gap-2 text-sm">
                <span className="opacity-70 shrink-0">📍</span>
                <span className="opacity-90">{f.address || f.area}</span>
              </div>
              {f.priceRange && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="opacity-70">💰</span>
                  <span className="opacity-90">{f.priceRange}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 멤버 투표 — 공유받은 사람이 후보에 한 표 */}
        {result.shareId && result.candidates && result.candidates.length >= 2 && (
          <VoteSection shareId={result.shareId} candidates={result.candidates} />
        )}

        {/* 2차·3차 코스 — 스냅샷 공유에만 존재(레거시 링크에선 자동 미표시) */}
        {result.second && (
          <CourseCard place={result.second} label={`2차${result.purposeSecond ? ` · ${result.purposeSecond}` : ''}`} tone="second" mapLink={mapLink} />
        )}
        {result.third && (
          <CourseCard place={result.third} label={`3차 · ${result.thirdLabel ?? '이어서'}`} tone="third" mapLink={mapLink} />
        )}

        {f.lat && f.lng && (
          <div className="mb-4 animate-fade-in-up">
            <MiniMap lat={f.lat} lng={f.lng} placeName={f.placeName} />
          </div>
        )}

        {/* 방문 인증 → 포인트 (공유받은 게스트도 방문자) */}
        <button
          onClick={() => { trackEvent('visit_cert_open', { device_id: getDeviceId(), place_key: `${f.placeName}|${f.address ?? ''}`, source: 'shared' }); setShowCert(true); }}
          className="w-full mb-3 py-3.5 rounded-2xl bg-mint-100 border-2 border-mint-500/40 text-mint-600 font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <span className="text-lg">📍</span>
          <span>여기 방문 인증하고 500P 받기</span>
        </button>

        <div className="text-center mb-4">
          <p className="text-xs text-gray-500">AI가 이 모임에 딱 맞는 곳을 골라줬어요</p>
        </div>
        <a href="/app" className="block w-full py-4 rounded-2xl bg-mint-500 text-white font-black text-base text-center shadow-lg shadow-mint-500/30 hover:bg-mint-600 transition-colors active:scale-95">
          🌿 나도 30초 만에 추천받기
        </a>

        {showCert && (
          <VisitCertModal
            place={f}
            source="shared"
            onClose={() => setShowCert(false)}
            onCertified={() => { /* 공유 화면엔 포인트 배지 없음 — 적립은 events/localStorage에 기록 */ }}
          />
        )}
        <a href="/" className="block w-full py-3 text-center text-sm text-gray-500 hover:text-mint-600 transition-colors mt-1">
          MINT가 뭔지 알아보기 →
        </a>
      </div>
    </div>
  );
}

// 2·3차 코스 요약 카드 — 흰 카드 + 코스 색 좌측 보더(결과 화면 3차 카드와 동일 문법). 색은 코스 톤(second/third)으로 받는다
function CourseCard({ place, label, tone, mapLink }: { place: SlimPlace; label: string; tone: Extract<CourseTone, 'second' | 'third'>; mapLink: (p: SlimPlace) => string }) {
  const t = COURSE_TONE[tone];
  return (
    <a
      href={mapLink(place)}
      target="_blank"
      rel="noreferrer"
      className={cn('relative block bg-white rounded-2xl border border-gray-200 border-l-4 p-4 mb-4 shadow-sm active:scale-[0.99] transition-transform', t.borderL)}
    >
      <div className="absolute top-3 right-3">
        <WishlistButton place={place} rank="candidate" source="shared" tone="light" />
      </div>
      <div className="flex items-start gap-3">
        {place.imageUrl && (
          <img src={place.imageUrl} alt={place.placeName} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div className="min-w-0 flex-1 pr-8">
          <span className={cn('inline-block text-[11px] font-bold px-2 py-0.5 rounded-full mb-1', t.text, t.tint)}>{label}</span>
          <p className="text-base font-black text-gray-800 leading-tight">{place.placeName}</p>
          {place.description && <p className="text-xs text-gray-500 leading-snug mt-0.5">{place.description}</p>}
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1.5">
            <span>📍</span><span className="truncate">{place.address || place.area}</span>
          </div>
        </div>
      </div>
    </a>
  );
}
