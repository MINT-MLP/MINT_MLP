import type { Hotplace } from '@/types';
// 전국 핫플레이스(상권·랜드마크) 시드 — 구/시 안 쳐도 이름만으로 자동완성되게 하는 데이터.
// matchTokens는 결과 주소를 걸러낼 '울타리'(보통 구 1개, substring 매칭이라 짧을수록 안전).
// searchAreas는 네이버 검색 프리픽스(좁은 상권명일수록 정확). level은 dong으로 두어
// 서버에서 좌표 반경(2.5km) 폴백이 실제 지리 스코프를 잡게 한다.

export const HOTPLACES: Hotplace[] = [
  // 서울
  { name: '홍대',   aliases: ['홍대입구', '홍익대'], city: '서울', labelSuffix: '서울 마포구', matchTokens: ['마포구'], searchAreas: ['홍대', '홍대입구', '연남동'], lat: 37.5573, lng: 126.9237 },
  { name: '연남동', aliases: ['연트럴파크'],         city: '서울', labelSuffix: '서울 마포구', matchTokens: ['마포구'], searchAreas: ['연남동', '홍대입구'], lat: 37.5629, lng: 126.9256 },
  { name: '합정',   aliases: ['합정역'],             city: '서울', labelSuffix: '서울 마포구', matchTokens: ['마포구'], searchAreas: ['합정', '망원동'], lat: 37.5497, lng: 126.9139 },
  { name: '망원',   aliases: ['망원동', '망리단길'], city: '서울', labelSuffix: '서울 마포구', matchTokens: ['마포구'], searchAreas: ['망원동'], lat: 37.5556, lng: 126.9017 },
  { name: '성수',   aliases: ['성수동', '성수역', '서울숲'], city: '서울', labelSuffix: '서울 성동구', matchTokens: ['성동구'], searchAreas: ['성수동', '서울숲'], lat: 37.5446, lng: 127.0559 },
  { name: '건대',   aliases: ['건대입구', '건국대'], city: '서울', labelSuffix: '서울 광진구', matchTokens: ['광진구'], searchAreas: ['건대입구', '화양동'], lat: 37.5404, lng: 127.0693 },
  { name: '이태원', aliases: ['이태원역'],           city: '서울', labelSuffix: '서울 용산구', matchTokens: ['용산구'], searchAreas: ['이태원', '경리단길'], lat: 37.5344, lng: 126.9946 },
  { name: '한남동', aliases: ['한남'],               city: '서울', labelSuffix: '서울 용산구', matchTokens: ['용산구'], searchAreas: ['한남동'], lat: 37.5347, lng: 127.0093 },
  { name: '강남',   aliases: ['강남역'],             city: '서울', labelSuffix: '서울 강남구', matchTokens: ['강남구'], searchAreas: ['강남역', '역삼동'], lat: 37.4980, lng: 127.0276 },
  { name: '압구정', aliases: ['압구정로데오'],       city: '서울', labelSuffix: '서울 강남구', matchTokens: ['강남구'], searchAreas: ['압구정로데오', '압구정'], lat: 37.5273, lng: 127.0388 },
  { name: '청담',   aliases: ['청담동'],             city: '서울', labelSuffix: '서울 강남구', matchTokens: ['강남구'], searchAreas: ['청담동'], lat: 37.5237, lng: 127.0473 },
  { name: '가로수길', aliases: ['신사동', '신사역'], city: '서울', labelSuffix: '서울 강남구', matchTokens: ['강남구'], searchAreas: ['가로수길', '신사동'], lat: 37.5210, lng: 127.0227 },
  { name: '잠실',   aliases: ['잠실역'],             city: '서울', labelSuffix: '서울 송파구', matchTokens: ['송파구'], searchAreas: ['잠실', '방이동'], lat: 37.5133, lng: 127.1000 },
  { name: '송리단길', aliases: ['석촌호수'],         city: '서울', labelSuffix: '서울 송파구', matchTokens: ['송파구'], searchAreas: ['송리단길', '석촌호수'], lat: 37.5077, lng: 127.1058 },
  { name: '여의도', aliases: ['여의도역'],           city: '서울', labelSuffix: '서울 영등포구', matchTokens: ['영등포구'], searchAreas: ['여의도'], lat: 37.5216, lng: 126.9243 },
  { name: '명동',   aliases: ['명동역'],             city: '서울', labelSuffix: '서울 중구', matchTokens: ['중구'], searchAreas: ['명동', '을지로'], lat: 37.5637, lng: 126.9838 },
  { name: '을지로', aliases: ['힙지로', '을지로3가'], city: '서울', labelSuffix: '서울 중구', matchTokens: ['중구'], searchAreas: ['을지로', '을지로3가'], lat: 37.5663, lng: 126.9919 },
  { name: '익선동', aliases: ['익선'],               city: '서울', labelSuffix: '서울 종로구', matchTokens: ['종로구'], searchAreas: ['익선동', '종로3가'], lat: 37.5720, lng: 126.9903 },
  { name: '광화문', aliases: ['종각'],               city: '서울', labelSuffix: '서울 종로구', matchTokens: ['종로구'], searchAreas: ['광화문', '종각'], lat: 37.5716, lng: 126.9767 },
  { name: '혜화',   aliases: ['대학로', '혜화역'],   city: '서울', labelSuffix: '서울 종로구', matchTokens: ['종로구'], searchAreas: ['대학로', '혜화'], lat: 37.5822, lng: 127.0019 },
  { name: '신촌',   aliases: ['신촌역'],             city: '서울', labelSuffix: '서울 서대문구', matchTokens: ['서대문구'], searchAreas: ['신촌', '이대'], lat: 37.5551, lng: 126.9368 },
  { name: '문래',   aliases: ['문래창작촌', '문래동'], city: '서울', labelSuffix: '서울 영등포구', matchTokens: ['영등포구'], searchAreas: ['문래창작촌', '문래동'], lat: 37.5177, lng: 126.8946 },
  { name: '샤로수길', aliases: ['서울대입구'],       city: '서울', labelSuffix: '서울 관악구', matchTokens: ['관악구'], searchAreas: ['샤로수길', '서울대입구'], lat: 37.4812, lng: 126.9527 },
  // 경기
  { name: '판교',   aliases: ['판교역'],             city: '성남', labelSuffix: '성남 분당구', matchTokens: ['분당구'], searchAreas: ['판교'], lat: 37.3948, lng: 127.1112 },
  { name: '정자',   aliases: ['정자역', '정자동'],   city: '성남', labelSuffix: '성남 분당구', matchTokens: ['분당구'], searchAreas: ['정자동'], lat: 37.3670, lng: 127.1080 },
  { name: '행궁동', aliases: ['행리단길', '수원행궁'], city: '수원', labelSuffix: '수원', matchTokens: ['수원'], searchAreas: ['행궁동', '행리단길'], lat: 37.2818, lng: 127.0136 },
  { name: '인계동', aliases: ['수원인계동'],         city: '수원', labelSuffix: '수원', matchTokens: ['수원'], searchAreas: ['인계동'], lat: 37.2637, lng: 127.0327 },
  { name: '동탄',   aliases: ['동탄역'],             city: '화성', labelSuffix: '화성', matchTokens: ['화성'], searchAreas: ['동탄'], lat: 37.2040, lng: 127.1080 },
  // 인천
  { name: '부평',   aliases: ['부평역'],             city: '인천', labelSuffix: '인천 부평구', matchTokens: ['부평구'], searchAreas: ['부평'], lat: 37.4894, lng: 126.7247 },
  { name: '송도',   aliases: ['송도센트럴파크'],     city: '인천', labelSuffix: '인천 연수구', matchTokens: ['연수구'], searchAreas: ['송도'], lat: 37.3931, lng: 126.6350 },
  { name: '구월동', aliases: ['구월'],               city: '인천', labelSuffix: '인천 남동구', matchTokens: ['남동구'], searchAreas: ['구월동'], lat: 37.4487, lng: 126.7052 },
  // 부산
  { name: '서면',   aliases: ['서면역'],             city: '부산', labelSuffix: '부산 부산진구', matchTokens: ['부산진구'], searchAreas: ['서면', '전포동'], lat: 35.1580, lng: 129.0594 },
  { name: '전포',   aliases: ['전리단길', '전포카페거리'], city: '부산', labelSuffix: '부산 부산진구', matchTokens: ['부산진구'], searchAreas: ['전포동'], lat: 35.1553, lng: 129.0648 },
  { name: '해운대', aliases: ['해운대역'],           city: '부산', labelSuffix: '부산 해운대구', matchTokens: ['해운대구'], searchAreas: ['해운대'], lat: 35.1631, lng: 129.1635 },
  { name: '광안리', aliases: ['광안리해수욕장'],     city: '부산', labelSuffix: '부산 수영구', matchTokens: ['수영구'], searchAreas: ['광안리'], lat: 35.1532, lng: 129.1187 },
  { name: '남포동', aliases: ['남포', '자갈치'],     city: '부산', labelSuffix: '부산 중구', matchTokens: ['중구'], searchAreas: ['남포동'], lat: 35.0988, lng: 129.0300 },
  // 대구·대전·광주·전주·제주·울산
  { name: '동성로', aliases: ['대구시내'],           city: '대구', labelSuffix: '대구 중구', matchTokens: ['중구'], searchAreas: ['동성로'], lat: 35.8690, lng: 128.5947 },
  { name: '둔산동', aliases: ['둔산'],               city: '대전', labelSuffix: '대전 서구', matchTokens: ['서구'], searchAreas: ['둔산동'], lat: 36.3510, lng: 127.3780 },
  { name: '은행동', aliases: ['대전은행동'],         city: '대전', labelSuffix: '대전 중구', matchTokens: ['중구'], searchAreas: ['은행동'], lat: 36.3282, lng: 127.4276 },
  { name: '상무지구', aliases: ['상무'],             city: '광주', labelSuffix: '광주 서구', matchTokens: ['서구'], searchAreas: ['상무지구'], lat: 35.1524, lng: 126.8500 },
  { name: '동명동', aliases: ['동리단길'],           city: '광주', labelSuffix: '광주 동구', matchTokens: ['동구'], searchAreas: ['동명동'], lat: 35.1490, lng: 126.9250 },
  { name: '한옥마을', aliases: ['전주한옥마을'],     city: '전주', labelSuffix: '전주', matchTokens: ['전주'], searchAreas: ['한옥마을'], lat: 35.8150, lng: 127.1530 },
  { name: '객리단길', aliases: ['객사'],             city: '전주', labelSuffix: '전주', matchTokens: ['전주'], searchAreas: ['객리단길', '객사'], lat: 35.8180, lng: 127.1420 },
  { name: '연동',   aliases: ['제주연동', '누웨마루'], city: '제주', labelSuffix: '제주', matchTokens: ['제주'], searchAreas: ['연동', '누웨마루'], lat: 33.4890, lng: 126.4980 },
  { name: '삼산동', aliases: ['울산삼산'],           city: '울산', labelSuffix: '울산 남구', matchTokens: ['남구'], searchAreas: ['삼산동'], lat: 35.5384, lng: 129.3390 },
];
