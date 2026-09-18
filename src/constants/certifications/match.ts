// 인증 매칭 엔진 — 이름 완전일치 AND 시·도 토큰 AND 구·군 토큰(3중 게이트).
//
// ⚠️ 신뢰 자산 보호(모든 인증 공통):
//  - 노출을 늘리려고 이름 부분일치(includes)·district 게이트 제거·region 게이트 완화 금지.
//  - 뱃지의 가치는 "희소성 + 정확성". 오탐 1건이 기능 전체의 신뢰를 부순다.
//  - 상호명은 반드시 출처가 있는 것만(각 소스 파일 주석 참고). 창작·추정 금지.

import { SIDO_TOKENS } from '@/constants/certifications/types';
import type { CertMatch } from '@/types';
import { CERT_SOURCES } from '@/constants/certifications';

// 이름 정규화 — 순서 고정. 공백·특수문자 제거 + '공백으로 분리된' 지점명 토큰만 안전하게 제거.
// (기존 ushulang.ts에서 검증된 로직을 그대로 이관 — 붙어있는 ~점은 절대 자르지 않는다)
export function normalizeName(raw: string): string {
  if (!raw) return '';
  const strip = (s: string) =>
    s.toLowerCase().replace(/[^가-힣a-z0-9]/g, ''); // 소문자화 + 한글·영문·숫자만
  const trimmed = raw.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const isBranch = last === '본점' || last === '본관' || /^.{1,6}점$/.test(last);
    if (isBranch) {
      const candidate = strip(parts.slice(0, -1).join(''));
      if (candidate.length >= 2) return candidate; // 결과가 2자 미만이면 절삭 취소
    }
  }
  return strip(trimmed);
}

// 정규화 이름 → (소스, 엔트리)[] 통합 사전. 첫 호출 시 1회 지연 구축
// (index.ts ↔ match.ts 순환 참조가 모듈 로드 시점에 터지지 않도록 lazy 초기화).
// 동명 업소·여러 인증 동시 등재를 모두 배열로 수용한다.
let NAME_INDEX: Map<string, CertMatch[]> | null = null;

function getIndex(): Map<string, CertMatch[]> {
  if (NAME_INDEX) return NAME_INDEX;
  const m = new Map<string, CertMatch[]>();
  for (const source of CERT_SOURCES) {
    for (const entry of source.entries) {
      const key = normalizeName(entry.name);
      const arr = m.get(key);
      const match: CertMatch = { source, entry };
      if (arr) arr.push(match);
      else m.set(key, [match]);
    }
  }
  NAME_INDEX = m;
  return m;
}

// 매칭 — 한 장소가 통과한 모든 인증을 priority 오름차순으로, 소스당 최대 1건 반환.
export function findCertifications(place: {
  placeName?: string;
  address?: string;
  area?: string;
}): CertMatch[] {
  const candidates = getIndex().get(normalizeName(place.placeName || ''));
  if (!candidates) return [];
  const addr = `${place.address || ''} ${place.area || ''}`;

  const bySource = new Map<string, CertMatch>();
  for (const c of candidates) {
    const regionOk = SIDO_TOKENS[c.entry.region].some((t) => addr.includes(t));
    if (!regionOk || !addr.includes(c.entry.district)) continue;
    // 같은 소스 내 중복 매치는 1건만(먼저 걸린 것 유지)
    if (!bySource.has(c.source.id)) bySource.set(c.source.id, c);
  }

  return [...bySource.values()].sort((a, b) => a.source.priority - b.source.priority);
}
