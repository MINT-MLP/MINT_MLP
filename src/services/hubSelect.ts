import type { Coordinates } from '@/types';
import { transitMinutesTo } from '@/services/travelTime';

// 하이브리드 상권 선택 — 거리로 좁힌 후보 2곳을 '실측 대중교통 시간'으로 최종 결정한다.
// 기준은 거리 때와 동일한 minimax: '가장 멀리 오는 사람의 시간'이 더 작은 후보. 직선거리로는 비슷해도
// 지하철 연결성에 따라 실제 체감이 갈리는 걸 반영. 단, 한 명이라도 실측이 안 되면(ODsay 실패·미설정)
// 공정한 비교가 불가하므로 거리 1순위(candidates[0])를 그대로 쓴다 — 반쪽 데이터로 뒤집지 않는다.
export async function refineHubByTransit(
  candidates: { name: string; lat: number; lng: number }[],
  departures: Coordinates[],
): Promise<{ name: string; lat: number; lng: number }> {
  if (candidates.length < 2 || departures.length === 0) return candidates[0];
  try {
    const worstTransit = await Promise.all(
      candidates.map(async (h) => {
        const mins = await transitMinutesTo(h, departures);
        return mins.some((m) => m == null) ? null : Math.max(...(mins as number[]));
      }),
    );
    if (worstTransit.some((m) => m == null)) return candidates[0]; // 실측 불완전 → 거리 결과 유지
    let best = 0;
    for (let i = 1; i < worstTransit.length; i++) {
      if ((worstTransit[i] as number) < (worstTransit[best] as number)) best = i;
    }
    return candidates[best];
  } catch {
    return candidates[0];
  }
}
