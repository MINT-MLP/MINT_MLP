// 민트샵 골목 쿠폰 목업 — 교환 기능은 없다(가짜 문). 포인트도 차감되지 않는다.
// 상호는 전부 가상이다. 실존 프랜차이즈·유명 맛집 이름을 쓰지 않기 위해 "{동네}+{업종 일반명사}"로만 조합했다.
export type CouponBenefitType =
  | 'side' | 'drink' | 'discount_amount' | 'discount_percent'
  | 'time' | 'group' | 'first_visit';

export type CouponTier = 'low' | 'mid' | 'high';

export interface MintCoupon {
  id: string;
  shopName: string;
  area: string;
  category: string;
  benefitType: CouponBenefitType;
  title: string;
  description: string;
  pointCost: number;
  tier: CouponTier;
  // ↓ 상세 팝업용 가게 정보. 전부 area/category/id에서 결정적으로 파생한다(실존 정보 아님).
  address: string;
  openingHours: string;
  signatureMenu: string[];
  rating: number;
}

// 50개 리터럴은 기본 필드만 든다 — 상세 필드는 파일 아래 파생 규칙이 채운다.
type CouponBase = Omit<MintCoupon, 'address' | 'openingHours' | 'signatureMenu' | 'rating'>;

// 배열 순서 = 노출 순서다(10개씩 페이지네이션).
// 앞쪽 40개는 전부 비수도권 — 서울만 있는 화면처럼 보이지 않게 1페이지를 지방으로 채운다.
// 첫 10개는 혜택 유형 7종·지역 7곳이 골고루 섞이도록 일부러 흩어 놓았다.
const MOCK_COUPONS_BASE: CouponBase[] = [
  // ── 비수도권 ──
  { id: 'c051', shopName: '해운대 밀면가', area: '해운대', category: '밀면집', benefitType: 'side', title: '만두 3알 무료 추가', description: '밀면 2그릇 이상 주문 시 만두 3알을 무료로 추가해드려요.', pointCost: 600, tier: 'low' },
  { id: 'c052', shopName: '애월 흑돼지마당', area: '애월', category: '흑돼지집', benefitType: 'discount_percent', title: '전메뉴 10% 할인', description: '2인 이상 방문 시 주문하신 전 메뉴를 10% 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c053', shopName: '전주 한상차림', area: '한옥마을', category: '한정식', benefitType: 'side', title: '계란찜 무료 제공', description: '2인 이상 정식 주문 시 계란찜 하나를 무료로 드려요.', pointCost: 800, tier: 'low' },
  { id: 'c054', shopName: '광안리 오션카페', area: '광안리', category: '카페', benefitType: 'drink', title: '아메리카노 1잔 무료', description: '디저트 2개 이상 주문 시 아메리카노 1잔을 무료로 드려요.', pointCost: 600, tier: 'low' },
  { id: 'c055', shopName: '서면 숯불갈비집', area: '서면', category: '고깃집', benefitType: 'discount_amount', title: '계산서 5,000원 할인', description: '3만원 이상 주문 시 계산서에서 5,000원을 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c056', shopName: '춘천 닭갈비집', area: '춘천', category: '닭갈비집', benefitType: 'drink', title: '식혜 1잔 무료', description: '2인 이상 주문 시 식혜 1잔을 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c057', shopName: '강구안 회식당', area: '통영', category: '횟집', benefitType: 'side', title: '매운탕 무료 제공', description: '모둠회 2인분 이상 주문 시 매운탕을 무료로 끓여드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c058', shopName: '남포동 골목다방', area: '남포동', category: '카페', benefitType: 'time', title: '평일 오후 2~4시 디저트 30% 할인', description: '평일 14시~16시 방문 시 디저트 메뉴를 30% 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c059', shopName: '안목 빵공방', area: '안목해변', category: '베이커리', benefitType: 'first_visit', title: '첫 방문 커피 무료', description: '첫 방문 손님께 드립커피 1잔을 무료로 드려요.', pointCost: 800, tier: 'low' },
  { id: 'c060', shopName: '수성못 다이닝룸', area: '수성못', category: '양식 다이닝', benefitType: 'group', title: '6인 이상 사이드 3개 무료', description: '6인 이상 방문 시 사이드 메뉴 3개를 무료로 제공해요.', pointCost: 5000, tier: 'high' },

  { id: 'c061', shopName: '동성로 분식당', area: '동성로', category: '분식', benefitType: 'side', title: '납작만두 무료 제공', description: '2인 이상 분식 세트 주문 시 납작만두 한 접시를 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c062', shopName: '둔산 중화관', area: '둔산', category: '중식', benefitType: 'drink', title: '자스민차 무료 제공', description: '식사 메뉴 2개 이상 주문 시 자스민차 1주전자를 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c063', shopName: '여수 밤바다포차', area: '여수', category: '포차', benefitType: 'side', title: '계란찜 무료 제공', description: '안주 2개 이상 주문 시 계란찜 하나를 무료로 드려요.', pointCost: 700, tier: 'low' },
  { id: 'c064', shopName: '청초호 회센터', area: '속초', category: '횟집', benefitType: 'discount_percent', title: '전메뉴 15% 할인', description: '2인 이상 방문 시 회 전 메뉴를 15% 할인해드려요.', pointCost: 2500, tier: 'mid' },
  { id: 'c065', shopName: '충장로 떡갈비집', area: '충장로', category: '떡갈비집', benefitType: 'side', title: '주먹밥 2개 무료 추가', description: '떡갈비 2인분 이상 주문 시 주먹밥 2개를 무료로 추가해드려요.', pointCost: 800, tier: 'low' },
  { id: 'c066', shopName: '울산 스시상', area: '울산', category: '일식', benefitType: 'discount_amount', title: '계산서 4,000원 할인', description: '3만원 이상 주문 시 계산서에서 4,000원을 할인해드려요.', pointCost: 2200, tier: 'mid' },
  { id: 'c067', shopName: '황리단길 국밥터', area: '황리단길', category: '국밥집', benefitType: 'side', title: '수육 3점 무료 추가', description: '국밥 2그릇 이상 주문 시 수육 3점을 무료로 추가해드려요.', pointCost: 700, tier: 'low' },
  { id: 'c068', shopName: '서귀포 한잔상', area: '서귀포', category: '이자카야', benefitType: 'drink', title: '막걸리 1병 무료', description: '안주 2만원 이상 주문 시 막걸리 1병을 무료로 드려요.', pointCost: 900, tier: 'low' },
  { id: 'c069', shopName: '청주 한잔호프', area: '청주', category: '호프집', benefitType: 'time', title: '평일 오후 5~7시 안주 20% 할인', description: '평일 17시~19시 방문 시 안주 전 메뉴를 20% 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c070', shopName: '한옥마을 정갈한상', area: '한옥마을', category: '한정식', benefitType: 'group', title: '단체석 예약비 면제', description: '6인 이상 예약 시 단체석 예약비 1만원을 면제해드려요.', pointCost: 6000, tier: 'high' },

  { id: 'c071', shopName: '안동 찜닭골목', area: '안동', category: '찜닭집', benefitType: 'side', title: '볶음밥 1인분 무료', description: '찜닭 2인분 이상 주문 시 마무리 볶음밥 1인분을 무료로 드려요.', pointCost: 900, tier: 'low' },
  { id: 'c072', shopName: '목포 해물탕집', area: '목포', category: '해물탕집', benefitType: 'discount_amount', title: '계산서 6,000원 할인', description: '4만원 이상 주문 시 계산서에서 6,000원을 할인해드려요.', pointCost: 2500, tier: 'mid' },
  { id: 'c073', shopName: '영일대 물회상', area: '영일대', category: '물회집', benefitType: 'drink', title: '탄산음료 2캔 무료', description: '2만원 이상 주문 시 탄산음료 2캔을 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c074', shopName: '상무 파스타룸', area: '상무지구', category: '파스타집', benefitType: 'discount_percent', title: '파스타 전메뉴 12% 할인', description: '2인 이상 방문 시 파스타 전 메뉴를 12% 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c075', shopName: '객사길 빵집', area: '객사길', category: '베이커리', benefitType: 'drink', title: '드립커피 1잔 무료', description: '빵 15,000원 이상 구매 시 드립커피 1잔을 무료로 드려요.', pointCost: 700, tier: 'low' },
  { id: 'c076', shopName: '황리단길 브런치뜰', area: '황리단길', category: '브런치카페', benefitType: 'time', title: '평일 오전 10~12시 15% 할인', description: '평일 10시~12시 방문 시 브런치 메뉴를 15% 할인해드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c077', shopName: '천안 분식골목', area: '천안', category: '분식', benefitType: 'discount_amount', title: '계산서 3,000원 할인', description: '2만원 이상 주문 시 계산서에서 3,000원을 할인해드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c078', shopName: '김해 책방카페', area: '김해', category: '카페', benefitType: 'first_visit', title: '첫 방문 쿠키 증정', description: '첫 방문 손님께 수제 쿠키 1개를 무료로 드려요.', pointCost: 600, tier: 'low' },
  { id: 'c079', shopName: '창원 곱창골목', area: '창원', category: '곱창집', benefitType: 'discount_amount', title: '계산서 20,000원 할인', description: '10만원 이상 주문 시 계산서에서 20,000원을 할인해드려요.', pointCost: 5000, tier: 'high' },
  { id: 'c080', shopName: '애월 오션다이닝', area: '애월', category: '양식 다이닝', benefitType: 'group', title: '8인 이상 웰컴 음료 무료', description: '8인 이상 모임 시 인원수만큼 웰컴 음료를 무료로 드려요.', pointCost: 7000, tier: 'high' },

  { id: 'c081', shopName: '강릉 막국수가', area: '강릉', category: '막국수집', benefitType: 'discount_percent', title: '전메뉴 10% 할인', description: '2인 이상 방문 시 주문하신 전 메뉴를 10% 할인해드려요.', pointCost: 1200, tier: 'low' },
  { id: 'c082', shopName: '은행동 한잔호프', area: '은행동', category: '호프집', benefitType: 'time', title: '평일 오후 5~7시 안주 20% 할인', description: '평일 17시~19시 방문 시 안주 전 메뉴를 20% 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c083', shopName: '진주 국밥상', area: '진주', category: '국밥집', benefitType: 'discount_percent', title: '식사 메뉴 10% 할인', description: '2인 이상 방문 시 식사 메뉴를 10% 할인해드려요.', pointCost: 1200, tier: 'low' },
  { id: 'c084', shopName: '군산 짬뽕관', area: '군산', category: '중식', benefitType: 'discount_percent', title: '전메뉴 12% 할인', description: '2인 이상 방문 시 전 메뉴를 12% 할인해드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c085', shopName: '순천 짜장면가', area: '순천', category: '중식', benefitType: 'time', title: '평일 점심 15% 할인', description: '평일 11시~14시 방문 시 식사 메뉴를 15% 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c086', shopName: '구미 화로집', area: '구미', category: '고깃집', benefitType: 'time', title: '평일 오후 5~7시 15% 할인', description: '평일 17시~19시 방문 시 전 메뉴를 15% 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c087', shopName: '충주 야키토리집', area: '충주', category: '이자카야', benefitType: 'first_visit', title: '첫 방문 꼬치 3개 무료', description: '첫 방문 손님께 야키토리 3꼬치를 무료로 드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c088', shopName: '공주 빵공방', area: '공주', category: '베이커리', benefitType: 'first_visit', title: '첫 방문 스콘 증정', description: '첫 방문 손님께 수제 스콘 1개를 무료로 드려요.', pointCost: 600, tier: 'low' },
  { id: 'c089', shopName: '해운대 회식당', area: '해운대', category: '횟집', benefitType: 'group', title: '6인 이상 사이드 3개 무료', description: '6인 이상 방문 시 사이드 메뉴 3개를 무료로 제공해요.', pointCost: 5000, tier: 'high' },
  { id: 'c090', shopName: '노형 흑돼지집', area: '노형동', category: '흑돼지집', benefitType: 'side', title: '된장찌개 무료 제공', description: '3인 이상 고기 주문 시 된장찌개 1인분을 무료로 드려요.', pointCost: 1500, tier: 'mid' },

  // ── 수도권 ──
  { id: 'c001', shopName: '성수 골목집', area: '성수', category: '고깃집', benefitType: 'side', title: '계란찜 무료 제공', description: '2인 이상 식사 주문 시 계란찜 하나를 무료로 드려요.', pointCost: 600, tier: 'low' },
  { id: 'c002', shopName: '연남 우동가', area: '연남', category: '일식', benefitType: 'drink', title: '유자차 무료 제공', description: '식사 메뉴 주문 시 따뜻한 유자차 1잔을 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c003', shopName: '망원 브런치룸', area: '망원', category: '브런치카페', benefitType: 'side', title: '감자튀김 무료 추가', description: '브런치 세트 주문 시 감자튀김을 무료로 추가해드려요.', pointCost: 700, tier: 'low' },
  { id: 'c004', shopName: '이태원 타코야', area: '이태원', category: '멕시칸', benefitType: 'first_visit', title: '웰컴 나초 무료', description: '첫 방문 손님께 웰컴 나초 한 접시를 무료로 드려요.', pointCost: 1200, tier: 'low' },
  { id: 'c005', shopName: '을지로 노가리집', area: '을지로', category: '호프집', benefitType: 'discount_amount', title: '계산서 5,000원 할인', description: '3만원 이상 주문 시 계산서에서 5,000원을 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c006', shopName: '합정 짬뽕장인', area: '합정', category: '중식', benefitType: 'discount_percent', title: '전메뉴 10% 할인', description: '방문 시 주문하신 전 메뉴를 10% 할인해드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c007', shopName: '홍대 곱창골목', area: '홍대', category: '곱창집', benefitType: 'time', title: '평일 오후 한산할 때 15% 할인', description: '평일 17시~19시 방문 시 전 메뉴 15%를 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c008', shopName: '건대 양갈비하우스', area: '건대', category: '양고기 전문점', benefitType: 'group', title: '4인 이상 사이드 2개 무료', description: '4인 이상 방문 시 사이드 메뉴 2개를 무료로 제공해요.', pointCost: 4500, tier: 'high' },
  { id: 'c009', shopName: '잠실 다이닝룸', area: '잠실', category: '양식 다이닝', benefitType: 'group', title: '단체석 예약비 면제', description: '6인 이상 예약 시 단체석 예약비 1만원을 면제해드려요.', pointCost: 6000, tier: 'high' },
  { id: 'c010', shopName: '여의도 브루하우스', area: '여의도', category: '펍', benefitType: 'group', title: '웰컴 맥주 피처 무료', description: '8인 이상 모임 시 웰컴 맥주 피처 1개를 무료로 드려요.', pointCost: 7500, tier: 'high' },

  { id: 'c011', shopName: '한남 파스타룸', area: '한남', category: '파스타집', benefitType: 'side', title: '샐러드 무료 제공', description: '파스타 2접시 이상 주문 시 사이드 샐러드 하나를 무료로 드려요.', pointCost: 700, tier: 'low' },
  { id: 'c012', shopName: '서촌 마당카페', area: '서촌', category: '카페', benefitType: 'drink', title: '아메리카노 1잔 무료', description: '디저트 2개 이상 주문 시 아메리카노 1잔을 무료로 드려요.', pointCost: 600, tier: 'low' },
  { id: 'c013', shopName: '익선동 한잔상', area: '익선동', category: '이자카야', benefitType: 'side', title: '기본 안주 무료 제공', description: '2인 이상 방문 시 기본 안주 한 접시를 무료로 드려요.', pointCost: 600, tier: 'low' },
  { id: 'c014', shopName: '신촌 고기굽는집', area: '신촌', category: '고깃집', benefitType: 'discount_amount', title: '계산서 3,000원 할인', description: '2만원 이상 주문 시 계산서에서 3,000원을 할인해드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c015', shopName: '성수 분식당', area: '성수', category: '분식', benefitType: 'side', title: '순대 한 접시 무료', description: '2인 이상 분식 세트 주문 시 순대 한 접시를 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c016', shopName: '연남 브런치뜰', area: '연남', category: '브런치카페', benefitType: 'discount_percent', title: '브런치 세트 12% 할인', description: '2인 이상 주문 시 브런치 세트 메뉴를 12% 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c017', shopName: '을지로 만두관', area: '을지로', category: '중식', benefitType: 'drink', title: '자스민차 무료 제공', description: '식사 메뉴 2개 이상 주문 시 자스민차 1주전자를 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c018', shopName: '홍대 평양냉면가', area: '홍대', category: '냉면집', benefitType: 'side', title: '군만두 3알 무료 추가', description: '냉면 2그릇 이상 주문 시 군만두 3알을 무료로 추가해드려요.', pointCost: 700, tier: 'low' },
  { id: 'c019', shopName: '망원 골목카페', area: '망원', category: '카페', benefitType: 'time', title: '평일 오후 3~5시 20% 할인', description: '평일 15시~17시 방문 시 음료 전 메뉴를 20% 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c020', shopName: '합정 다이닝바', area: '합정', category: '양식 다이닝', benefitType: 'side', title: '오늘의 수프 무료 제공', description: '메인 요리 2개 이상 주문 시 오늘의 수프를 무료로 드려요.', pointCost: 800, tier: 'low' },
  { id: 'c021', shopName: '이태원 골목포차', area: '이태원', category: '포차', benefitType: 'drink', title: '생맥주 1잔 무료', description: '안주 2개 이상 주문 시 생맥주 500cc 1잔을 무료로 드려요.', pointCost: 900, tier: 'low' },
  { id: 'c022', shopName: '건대 화로구이집', area: '건대', category: '고깃집', benefitType: 'discount_amount', title: '계산서 20,000원 할인', description: '10만원 이상 주문 시 계산서에서 20,000원을 할인해드려요.', pointCost: 5000, tier: 'high' },
  { id: 'c023', shopName: '잠실 스시상', area: '잠실', category: '일식', benefitType: 'side', title: '계란초밥 2피스 무료', description: '스시 세트 2인분 이상 주문 시 계란초밥 2피스를 무료로 드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c024', shopName: '여의도 아침식탁', area: '여의도', category: '브런치카페', benefitType: 'first_visit', title: '첫 방문 커피 무료', description: '첫 방문 손님께 아메리카노 1잔을 무료로 드려요.', pointCost: 800, tier: 'low' },

  { id: 'c025', shopName: '한남 와인다이닝', area: '한남', category: '양식 다이닝', benefitType: 'discount_percent', title: '와인 전품목 15% 할인', description: '식사 메뉴 2개 이상 주문 시 와인 전 품목을 15% 할인해드려요.', pointCost: 2500, tier: 'mid' },
  { id: 'c026', shopName: '서촌 국밥터', area: '서촌', category: '국밥집', benefitType: 'side', title: '공깃밥 무제한 제공', description: '2인 이상 방문 시 공깃밥을 무제한으로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c027', shopName: '익선동 빵공방', area: '익선동', category: '베이커리', benefitType: 'drink', title: '드립커피 1잔 무료', description: '빵 15,000원 이상 구매 시 드립커피 1잔을 무료로 드려요.', pointCost: 700, tier: 'low' },
  { id: 'c028', shopName: '신촌 한잔호프', area: '신촌', category: '호프집', benefitType: 'time', title: '평일 오후 5~7시 안주 20% 할인', description: '평일 17시~19시 방문 시 안주 전 메뉴를 20% 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c029', shopName: '성수 커피창고', area: '성수', category: '카페', benefitType: 'discount_amount', title: '음료·디저트 3,000원 할인', description: '2만원 이상 주문 시 계산서에서 3,000원을 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c030', shopName: '연남 막창골목', area: '연남', category: '곱창집', benefitType: 'side', title: '볶음밥 1인분 무료', description: '3인 이상 방문 시 마무리 볶음밥 1인분을 무료로 드려요.', pointCost: 900, tier: 'low' },
  { id: 'c031', shopName: '을지로 뒷골목포차', area: '을지로', category: '포차', benefitType: 'discount_percent', title: '안주 전메뉴 12% 할인', description: '3인 이상 방문 시 안주 전 메뉴를 12% 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c032', shopName: '홍대 분식골목', area: '홍대', category: '분식', benefitType: 'drink', title: '식혜 1잔 무료', description: '2인 이상 세트 주문 시 식혜 1잔을 무료로 드려요.', pointCost: 500, tier: 'low' },
  { id: 'c033', shopName: '망원 정육식당', area: '망원', category: '고깃집', benefitType: 'side', title: '된장찌개 무료 제공', description: '3인 이상 고기 주문 시 된장찌개 1인분을 무료로 드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c034', shopName: '합정 책방카페', area: '합정', category: '카페', benefitType: 'first_visit', title: '첫 방문 쿠키 증정', description: '첫 방문 손님께 수제 쿠키 1개를 무료로 드려요.', pointCost: 600, tier: 'low' },
  { id: 'c035', shopName: '이태원 다이닝하우스', area: '이태원', category: '양식 다이닝', benefitType: 'discount_amount', title: '계산서 15,000원 할인', description: '8만원 이상 주문 시 계산서에서 15,000원을 할인해드려요.', pointCost: 4500, tier: 'high' },
  { id: 'c036', shopName: '건대 짜장면가', area: '건대', category: '중식', benefitType: 'time', title: '평일 점심 15% 할인', description: '평일 11시~14시 방문 시 식사 메뉴를 15% 할인해드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c037', shopName: '잠실 국밥상', area: '잠실', category: '국밥집', benefitType: 'side', title: '수육 3점 무료 추가', description: '국밥 2그릇 이상 주문 시 수육 3점을 무료로 추가해드려요.', pointCost: 700, tier: 'low' },
  { id: 'c038', shopName: '여의도 화로집', area: '여의도', category: '고깃집', benefitType: 'group', title: '6인 이상 사이드 3개 무료', description: '6인 이상 방문 시 사이드 메뉴 3개를 무료로 제공해요.', pointCost: 5000, tier: 'high' },

  { id: 'c039', shopName: '한남 스시가', area: '한남', category: '일식', benefitType: 'side', title: '연어 사시미 2점 무료 추가', description: '2인 이상 세트 주문 시 연어 사시미 2점을 무료로 추가해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c040', shopName: '서촌 냉면가', area: '서촌', category: '냉면집', benefitType: 'discount_amount', title: '계산서 4,000원 할인', description: '3만원 이상 주문 시 계산서에서 4,000원을 할인해드려요.', pointCost: 2200, tier: 'mid' },
  { id: 'c041', shopName: '익선동 약주집', area: '익선동', category: '술집', benefitType: 'drink', title: '전통주 1병 무료', description: '안주 3만원 이상 주문 시 전통주 1병을 무료로 드려요.', pointCost: 2500, tier: 'mid' },
  { id: 'c042', shopName: '신촌 아침뜰', area: '신촌', category: '브런치카페', benefitType: 'time', title: '평일 오전 10~12시 15% 할인', description: '평일 10시~12시 방문 시 브런치 메뉴를 15% 할인해드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c043', shopName: '성수 파스타공방', area: '성수', category: '파스타집', benefitType: 'side', title: '트러플 감자튀김 무료', description: '메인 메뉴 2개 이상 주문 시 트러플 감자튀김을 무료로 드려요.', pointCost: 1800, tier: 'mid' },
  { id: 'c044', shopName: '연남 타코마당', area: '연남', category: '멕시칸', benefitType: 'discount_percent', title: '타코 전메뉴 15% 할인', description: '2인 이상 방문 시 타코 전 메뉴를 15% 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c045', shopName: '을지로 숯불집', area: '을지로', category: '고깃집', benefitType: 'discount_amount', title: '계산서 25,000원 할인', description: '12만원 이상 주문 시 계산서에서 25,000원을 할인해드려요.', pointCost: 6000, tier: 'high' },
  { id: 'c046', shopName: '홍대 야키토리집', area: '홍대', category: '이자카야', benefitType: 'first_visit', title: '첫 방문 꼬치 3개 무료', description: '첫 방문 손님께 야키토리 3꼬치를 무료로 드려요.', pointCost: 1500, tier: 'mid' },
  { id: 'c047', shopName: '한남 브런치가', area: '한남', category: '브런치카페', benefitType: 'discount_percent', title: '주말 브런치 10% 할인', description: '주말 2인 이상 방문 시 브런치 세트를 10% 할인해드려요.', pointCost: 2200, tier: 'mid' },
  { id: 'c048', shopName: '서촌 골목다방', area: '서촌', category: '카페', benefitType: 'time', title: '평일 오후 2~4시 디저트 30% 할인', description: '평일 14시~16시 방문 시 디저트 메뉴를 30% 할인해드려요.', pointCost: 2000, tier: 'mid' },
  { id: 'c049', shopName: '익선동 한옥다이닝', area: '익선동', category: '양식 다이닝', benefitType: 'discount_amount', title: '계산서 30,000원 할인', description: '15만원 이상 주문 시 계산서에서 30,000원을 할인해드려요.', pointCost: 7000, tier: 'high' },
  { id: 'c050', shopName: '신촌 중화반점', area: '신촌', category: '중식', benefitType: 'drink', title: '탄산음료 2캔 무료', description: '2만원 이상 주문 시 탄산음료 2캔을 무료로 드려요.', pointCost: 500, tier: 'low' },
];

// ── 상세 팝업용 필드는 area/category/id에서 결정적으로 생성한다 ──
// 실존 가게로 오인되지 않도록 지번·전화번호는 만들지 않는다. 주소도 골목 단위까지만 적는다.

// 동네 → 행정동까지만. 지번·건물명은 넣지 않는다.
const AREA_ADDRESS: Record<string, string> = {
  // 수도권
  성수: '서울 성동구 성수동', 연남: '서울 마포구 연남동', 망원: '서울 마포구 망원동',
  이태원: '서울 용산구 이태원동', 을지로: '서울 중구 을지로', 합정: '서울 마포구 합정동',
  홍대: '서울 마포구 서교동', 건대: '서울 광진구 화양동', 잠실: '서울 송파구 잠실동',
  여의도: '서울 영등포구 여의도동', 한남: '서울 용산구 한남동', 서촌: '서울 종로구 체부동',
  익선동: '서울 종로구 익선동', 신촌: '서울 서대문구 창천동',
  // 부산·경남
  해운대: '부산 해운대구 우동', 광안리: '부산 수영구 광안동', 서면: '부산 부산진구 부전동',
  남포동: '부산 중구 남포동', 울산: '울산 남구 삼산동', 창원: '경남 창원시 상남동',
  김해: '경남 김해시 내동', 진주: '경남 진주시 대안동', 통영: '경남 통영시 항남동',
  // 대구·경북
  동성로: '대구 중구 동성로', 수성못: '대구 수성구 두산동', 황리단길: '경북 경주시 황남동',
  영일대: '경북 포항시 두호동', 안동: '경북 안동시 남부동', 구미: '경북 구미시 원평동',
  // 광주·전남전북
  충장로: '광주 동구 충장로', 상무지구: '광주 서구 치평동', 한옥마을: '전북 전주시 교동',
  객사길: '전북 전주시 고사동', 군산: '전북 군산시 신흥동', 여수: '전남 여수시 종화동',
  목포: '전남 목포시 만호동', 순천: '전남 순천시 조례동',
  // 대전·충청
  둔산: '대전 서구 둔산동', 은행동: '대전 중구 은행동', 청주: '충북 청주시 북문로',
  충주: '충북 충주시 성서동', 천안: '충남 천안시 신부동', 공주: '충남 공주시 산성동',
  // 강원·제주
  안목해변: '강원 강릉시 견소동', 강릉: '강원 강릉시 교동', 속초: '강원 속초시 청학동',
  춘천: '강원 춘천시 조양동', 애월: '제주 제주시 애월읍', 서귀포: '제주 서귀포시 중정로',
  노형동: '제주 제주시 노형동',
};

const CATEGORY_MENU: Record<string, string[]> = {
  고깃집: ['생삼겹살', '갈비살', '된장찌개'],
  일식: ['모둠초밥', '가라아게', '우동'],
  브런치카페: ['에그베네딕트', '팬케이크', '아보카도토스트'],
  멕시칸: ['타코 플레이트', '나초', '퀘사디아'],
  호프집: ['노가리', '감자튀김', '생맥주'],
  중식: ['짜장면', '탕수육', '군만두'],
  곱창집: ['모둠곱창', '막창구이', '볶음밥'],
  '양고기 전문점': ['양갈비', '양꼬치', '즈란양고기'],
  '양식 다이닝': ['스테이크', '리조또', '오늘의 수프'],
  펍: ['수제맥주 플라이트', '치킨윙', '피시앤칩스'],
  파스타집: ['알리오올리오', '토마토파스타', '트러플감자튀김'],
  카페: ['아메리카노', '크로플', '수제 디저트'],
  이자카야: ['야키토리', '가라아게', '사케'],
  냉면집: ['물냉면', '비빔냉면', '수육'],
  분식: ['떡볶이', '순대', '튀김'],
  포차: ['닭발', '계란찜', '안주 세트'],
  국밥집: ['돼지국밥', '수육', '순대국'],
  베이커리: ['식빵', '크루아상', '스콘'],
  술집: ['전통주 안주 세트', '전집메뉴', '숙성회'],
  밀면집: ['물밀면', '비빔밀면', '만두'],
  흑돼지집: ['흑돼지 오겹살', '근고기', '된장찌개'],
  한정식: ['한상차림 정식', '간장게장', '떡갈비'],
  횟집: ['모둠회', '매운탕', '해물라면'],
  떡갈비집: ['한우 떡갈비', '주먹밥', '된장찌개'],
  찜닭집: ['찜닭', '볶음밥', '메밀전'],
  닭갈비집: ['철판 닭갈비', '막국수', '볶음밥'],
  해물탕집: ['해물탕', '낙지볶음', '전복죽'],
  물회집: ['물회', '회덮밥', '해물칼국수'],
  막국수집: ['막국수', '수육', '감자전'],
};

const HOURS_PATTERNS = [
  '11:00 - 22:00 · 매일 영업',
  '11:30 - 21:30 · 연중무휴',
  '17:00 - 01:00 · 연중무휴',
  '10:00 - 20:00 · 월요일 휴무',
  '11:00 - 23:00 · 일요일 휴무',
];

function idNum(id: string): number {
  return parseInt(id.replace('c', ''), 10) || 0;
}

export const MOCK_COUPONS: MintCoupon[] = MOCK_COUPONS_BASE.map((c) => ({
  ...c,
  address: `${AREA_ADDRESS[c.area] ?? c.area} 골목 안쪽`,
  openingHours: HOURS_PATTERNS[idNum(c.id) % HOURS_PATTERNS.length],
  signatureMenu: CATEGORY_MENU[c.category] ?? ['오늘의 메뉴', '사장님 추천'],
  rating: Number((4.3 + (idNum(c.id) % 7) * 0.1).toFixed(1)), // 4.3~4.9
}));
