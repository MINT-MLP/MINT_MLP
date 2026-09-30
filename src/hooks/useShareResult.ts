import type { PlaceRecommendation } from '@/types';
import { trackEvent } from '@/services/analytics';
import { newShareId, saveShareSnapshot, shareViaKakaoOrFallback } from '@/services/share';
import type { RecommendInput } from '@/hooks/useRecommendInput';
import { resultHasSecond, type ResultState } from '@/hooks/useResultState';

// 결과 카카오톡 공유 — 스냅샷 저장 후 짧은 링크, 실패 시 레거시 ?data= 링크.
export function useShareResult({ input, result: resultState }: { input: RecommendInput; result: ResultState }) {
  const { purpose } = input;
  const { result, resultThird, resultThirdLabel, resultSecondMissing, midpointData, treasurer } = resultState;

  async function handleShare() {
    if (!result || result.length === 0) return;
    trackEvent('kakao_share');
    const primary = result[0];
    const mlpUrl = window.location.origin;
    const hasSecond = resultHasSecond(purpose, resultSecondMissing);
    const secondPlace = hasSecond && result.length > 1 ? result[1] : null;

    // 투표 후보 = 1차 메인 + 1차 대안들 (URL 길이를 위해 슬림 포맷: n=이름, c=카테고리, s=적합도)
    const firstCandidates = (hasSecond ? [result[0], result[2], result[3]] : result.slice(0, 3))
      .filter((p): p is PlaceRecommendation => !!p)
      .map((p) => ({ n: p.placeName, c: p.category, s: p.fitScore ?? null }));

    // SharedResult URL — 수신자가 링크 누르면 결과 카드로 바로 이동.
    // ⚠️ 전체 JSON을 쿼리에 싣기 때문에 URL이 너무 길면 일부 환경(카톡/iOS)에서 잘려 수신측 파싱이 깨진다.
    // imageUrl(긴 CDN URL)·kakaoPlaceUrl은 SharedResult에서 각각 가드/미사용이므로 payload에서 빼 URL을 짧게 유지한다.
    const shareId = newShareId();
    // 레거시 슬림 payload(?data=) — 스냅샷 저장 실패 시 폴백. imageUrl·kakaoPlaceUrl은 URL 길이 때문에 제외.
    const sharedData = {
      placeName: primary.placeName,
      category: primary.category,
      description: primary.description,
      vibeTags: primary.vibeTags,
      address: primary.address,
      area: primary.area,
      priceRange: primary.priceRange,
      congestionLevel: primary.congestionLevel,
      lat: primary.lat,
      lng: primary.lng,
      shareId,
      candidates: firstCandidates.length >= 2 ? firstCandidates : undefined,
    };
    const legacyUrl = `${mlpUrl}/shared?data=${encodeURIComponent(JSON.stringify(sharedData))}`;

    // 풀코스 스냅샷을 서버에 저장하고 짧은 링크(/shared?id=)로 공유 → URL 잘림 리스크 제거 + 수신자가 1·2·3차 전체를 봄.
    const slim = (p: PlaceRecommendation) => ({
      placeName: p.placeName, category: p.category, description: p.description,
      priceRange: p.priceRange, vibeTags: p.vibeTags, address: p.address, area: p.area,
      congestionLevel: p.congestionLevel ?? null, lat: p.lat ?? null, lng: p.lng ?? null,
      imageUrl: p.imageUrl ?? null, kakaoPlaceUrl: p.kakaoPlaceUrl ?? null,
    });
    const snapshot = {
      v: 1,
      shareId,
      first: slim(primary),
      second: secondPlace ? slim(secondPlace) : null,
      third: resultThird ? slim(resultThird) : null,
      thirdLabel: resultThird ? (resultThirdLabel ?? '이어서') : null,
      purposeFirst: purpose?.first ?? null,
      purposeSecond: hasSecond ? purpose?.second ?? null : null,
      areaName: midpointData?.areaName ?? null,
      treasurer: treasurer ?? null,
      candidates: firstCandidates.length >= 2 ? firstCandidates : undefined,
    };
    const snapshotSaved = await saveShareSnapshot(shareId, snapshot);
    const sharedUrl = snapshotSaved ? `${mlpUrl}/shared?id=${shareId}` : legacyUrl;

    const mapUrl = (p: typeof primary) =>
      p.lat && p.lng
        ? `https://map.kakao.com/link/to/${encodeURIComponent(p.placeName)},${p.lat},${p.lng}`
        : `https://map.kakao.com/link/search/${encodeURIComponent(p.placeName)}`;

    const primaryMapUrl = mapUrl(primary);
    const secondMapUrl = secondPlace ? mapUrl(secondPlace) : null;

    // 폴백(네이티브 공유/클립보드)용 텍스트 — sharedUrl은 fallbackShare에 따로 넘기므로 본문에서 분리한다.
    const shareText = [
      `🍀 MINT 추천 — ${primary.placeName}`,
      '',
      primary.description,
      '',
      ...(hasSecond && secondPlace
        ? [
            `1차(${purpose!.first}): ${primary.placeName}`,
            `  카카오맵 → ${primaryMapUrl}`,
            '',
            `2차(${purpose!.second}): ${secondPlace.placeName}`,
            `  카카오맵 → ${secondMapUrl}`,
          ]
        : [
            `📍 ${primary.address || primary.area}`,
            `  카카오맵 → ${primaryMapUrl}`,
          ]),
      ...(resultThird ? ['', `3차(${resultThirdLabel ?? '이어서'}): ${resultThird.placeName}`, `  카카오맵 → ${mapUrl(resultThird)}`] : []),
      ...(treasurer ? ['', `🎲 ${treasurer}에서 출발하는 분이 오늘의 총무 당첨!`] : []),
      '',
      '👇 결과 직접 확인',
    ].join('\n');

    void shareViaKakaoOrFallback(() => {
      const thirdDescLine = resultThird ? [`3차(${resultThirdLabel ?? '이어서'}): ${resultThird.placeName}`] : [];
      const descLines = hasSecond && secondPlace
        ? [
            `1차(${purpose!.first}): ${primary.placeName}`,
            `2차(${purpose!.second}): ${secondPlace.placeName}`,
            ...thirdDescLine,
            ...(treasurer ? [`💰 ${treasurer}에서 출발하는 분이 오늘의 총무!`] : []),
          ]
        : [
            primary.description,
            `📍 ${primary.address || primary.area} · 💰 ${primary.priceRange || ''}`,
            ...thirdDescLine,
            ...(treasurer ? [`💰 ${treasurer}에서 출발하는 분이 오늘의 총무!`] : []),
          ];

      // 카카오맵 버튼은 숨긴다(09-30). 공유 버튼 링크는 앱에 등록된 도메인만 열리고, 카카오맵 주소는
      // 대표 도메인(랜딩)으로 바뀌어 열린다. 되살리려면 우리 도메인을 거쳐 카카오맵으로 넘기는 경로가 필요하다.
      const buttons: object[] = [
        { title: '추천 결과 보기', link: { mobileWebUrl: sharedUrl, webUrl: sharedUrl } },
      ];

      return {
        objectType: 'feed',
        content: {
          title: `🍀 MINT 추천${hasSecond ? ` | 1차(${purpose!.first}) · 2차(${purpose!.second})` : ` | ${primary.placeName}`}`,
          description: descLines.join('\n'),
          imageUrl: `${mlpUrl}/image/step5.png`,
          link: { mobileWebUrl: sharedUrl, webUrl: sharedUrl },
        },
        buttons,
      };
    }, shareText, sharedUrl);
  }

  return { handleShare };
}
