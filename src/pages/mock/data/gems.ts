// 발굴 탭 '오늘의 원석' 목업 — 찜(wishlist)은 실제 저장되므로 place_key가 어긋나지 않게 주소를 고정한다.
// 좌표는 전부 null — 실존 가게라 검증 안 된 좌표를 박으면 지도 링크가 엉뚱한 곳을 열어서, 카카오맵이 이름으로 찾게 비워 둔다.
// 사진 필드는 두지 않는다 — 실존 가게라 무단 이미지를 쓸 수 없고 외부 URL도 못 쓴다.
// 카드 썸네일은 Discover.tsx가 category 문자열로 만드는 컬러 블록이 대신한다(찜 목록의 자유 문자열 category도 같은 매핑을 탄다).
//
// ── description 작성 규칙 (원석 추가할 때도 지킬 것) ──
// MINT의 문제의식은 "바이럴 만능주의 때문에 좋은 매장이 상위노출에 밀려 죽는다"는 것이다.
// 발굴 탭이 바이럴 블로그 어휘를 쓰면 서비스가 스스로를 부정하는 꼴이 된다.
//
// 금지 어휘 — 붐/인기/은밀함을 주장하는 형용사 일체:
//   "힙한", "아는 사람만 아는", "인스타 감성", "웨이팅", "신상", "핫플",
//   "성지", "한산해요", "의외로", "숨은" …
// 지표도 금지 — "언급량 3배" 같은 수치는 실존 업체에 대한 허위사실이다.
//   우리에게 진짜 지표가 없으므로 지어내지 않는다.
//
// 남길 수 있는 것: 메뉴·콘셉트·좌석 구성처럼 팀이 실제로 확인한 사실만, 짧게.
//   예외적으로 방문 전 알아야 할 실용 정보(예: 재료 소진 시 마감)는 한 문장 더 허용.
export interface MockGem {
  placeName: string; category: string; address: string; area: string;
  lat: number | null; lng: number | null; description: string;
}

export const MOCK_GEMS: MockGem[] = [
  { placeName: '몽탄', category: '고깃집', address: '서울 용산구 한강대로40가길 30', area: '용산', lat: null, lng: null, description: '우대갈비를 전문으로 하는 노포예요.' },
  { placeName: '카페 온천집', category: '카페', address: '서울 마포구 동교로 199', area: '연남', lat: null, lng: null, description: '온천을 콘셉트로 한 카페예요.' },
  { placeName: '우육면가', category: '중식', address: '서울 중구 청계천로 100', area: '을지로', lat: null, lng: null, description: '을지로 뒷골목의 우육탕면 전문점이에요.' },
  { placeName: '밀도', category: '베이커리', address: '서울 성동구 아차산로7길 5', area: '성수', lat: null, lng: null, description: '식빵을 굽는 동네 빵집이에요.' },
  { placeName: '쿠시마사', category: '이자카야', address: '서울 마포구 와우산로29길 6', area: '홍대', lat: null, lng: null, description: '카운터 자리 중심의 꼬치구이 전문점이에요.' },
  { placeName: '바 참', category: '바', address: '서울 종로구 자하문로1길 12', area: '서촌', lat: null, lng: null, description: '칵테일을 전문으로 하는 바예요.' },
  { placeName: '리틀넥', category: '파스타집', address: '서울 용산구 대사관로 31', area: '한남', lat: null, lng: null, description: '브런치와 파스타를 함께 하는 곳이에요.' },
  { placeName: '옥동식', category: '한식', address: '서울 마포구 양화로7길 44-10', area: '합정', lat: null, lng: null, description: '돼지곰탕 한 가지 메뉴만 파는 가게예요. 재료가 떨어지면 그날은 영업을 마쳐요.' },
];
