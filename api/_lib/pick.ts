// 최종 선택·스코프 판정용 순수 함수. 외부 I/O 없음.

// 문자열 시드 → 결정론 난수. 같은 세션키면 새로고침마다 같은 결과, 세션이 바뀌면 다른 결과.
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 점수 비례 가중 샘플링(비복원). softmax(score / temperature).
// temperature가 작을수록 최고점에 쏠리고, 클수록 균등에 가깝다. 0 이하면 점수순 상위 k.
export function weightedPick<T>(
  items: T[],
  score: (item: T) => number,
  k: number,
  rnd: () => number,
  temperature = 8,
): T[] {
  const pool = [...items];
  const out: T[] = [];
  if (temperature <= 0) {
    return pool.sort((a, b) => score(b) - score(a)).slice(0, k);
  }
  while (out.length < k && pool.length > 0) {
    const max = Math.max(...pool.map(score));
    const weights = pool.map((it) => Math.exp((score(it) - max) / temperature));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rnd() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// 행정단위 스코프 — 주소에 토큰이 전부 들어 있어야 통과. 공백 차이("미추홀구" vs "미추홀 구")는 무시.
export function addressInScope(address: string | undefined, tokens: string[]): boolean {
  const a = (address ?? '').replace(/\s+/g, '');
  if (!a) return false;
  return tokens.every((t) => a.includes(t.replace(/\s+/g, '')));
}
