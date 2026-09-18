// 인증 리스트 레지스트리 — 여기 배열에만 등록하면 뱃지·매칭·안내가 자동 반영된다.
// priority 오름차순으로 뱃지가 노출되며, 카드에는 상위 2개까지 표시(match.ts·ResultCard 참고).

import type { CertSource } from '@/types';
import { MICHELIN } from '@/constants/certifications/michelin';
import { USHULANG } from '@/constants/certifications/ushulang';
import { BAEKNYEON } from '@/constants/certifications/baeknyeon';
import { GOODPRICE } from '@/constants/certifications/goodprice';

export const CERT_SOURCES: CertSource[] = [MICHELIN, USHULANG, BAEKNYEON, GOODPRICE];

export { findCertifications, normalizeName } from '@/constants/certifications/match';
