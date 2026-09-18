import { CERT_SOURCES } from '@/constants/certifications';

// 랜딩 "신뢰 큐레이션" 섹션 — 추천 카드에 뜨는 인증 뱃지를 미리 소개.
// 데이터는 CERT_SOURCES 단일 출처에서 읽어, 새 인증을 추가하면 이 섹션도 자동 갱신된다.

// 마케팅 한 줄 설명(데이터 계층에 카피를 섞지 않기 위해 컴포넌트 로컬 맵으로 둔다).
// 미등록 id는 sourceLine으로 폴백.
const BLURBS: Record<string, string> = {
  ushulang: '부산·울산·경남 골목을 매일 도는 집배원들이 직접 고른, 우정청 공식 맛집 가이드',
  michelin: '미쉐린 가이드 서울·부산 셀렉션에 이름을 올린 집',
  baeknyeon: '정부가 인증한, 수십 년 한자리를 지켜온 노포',
  goodprice: '지자체가 지정해 합리적인 가격을 지켜온 착한가격업소',
};

// 전수 수록이라 개수를 노출해도 신뢰가 가는 소스(보수적 시드인 미쉐린·빈 착한가격은 개수 비노출).
const SHOW_COUNT = new Set(['ushulang', 'baeknyeon']);

export default function CertShowcase() {
  const disclaimers = CERT_SOURCES.map((s) => s.disclaimer).filter(Boolean) as string[];

  return (
    <section className="fade-section bg-white border-y border-gray-100">
      <div className="max-w-lg lg:max-w-5xl mx-auto px-6 py-14 lg:py-24">
        <div className="lg:text-center">
          <p className="text-xs font-bold tracking-widest text-mint-500 mb-3">CERTIFIED</p>
          <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
            믿을 만한 집인지, <span className="text-mint-600">인증 마크</span>가 말해줘요
          </h2>
          <p className="text-base lg:text-lg text-gray-500 mb-8 lg:mb-12 leading-relaxed">
            우체국·정부·미쉐린 가이드 — 공개된 공식 리스트와 상호·지역을 대조해,<br className="hidden lg:block" />
            정확히 일치할 때만 추천 카드에 마크를 붙입니다.
          </p>
        </div>

        {/* 결과 카드 미리보기 — 실제 카드에 뜨는 뱃지 모양 미러링 */}
        <div className="max-w-xs mx-auto mb-8 lg:mb-12">
          <div className="rounded-2xl result-gradient shadow-lg shadow-teal-200 p-4 text-white">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[11px] font-black bg-white/30 px-3 py-0.5 rounded-full border border-white/30">
                한식
              </span>
              <span className="text-[11px] font-black bg-white text-[#DA291C] px-2.5 py-0.5 rounded-full shadow-sm">
                📮 우슐랭
              </span>
              <span className="text-[11px] font-black bg-white text-[#8A5A2B] px-2.5 py-0.5 rounded-full shadow-sm">
                🏛️ 백년가게
              </span>
            </div>
            <p className="text-lg font-black leading-tight">이 집, 믿고 가도 돼요</p>
            <p className="text-sm text-white/80 mt-0.5">공식 리스트에 오른 집엔 이렇게 마크가 떠요</p>
          </div>
        </div>

        {/* 인증 소스 그리드 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">
          {CERT_SOURCES.map((s) => {
            const empty = s.entries.length === 0;
            return (
              <div
                key={s.id}
                className={`rounded-2xl p-4 lg:p-5 border flex flex-col gap-1.5 ${
                  empty ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200 shadow-sm'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl leading-none">{s.emoji}</span>
                  <span className="text-sm lg:text-base font-black" style={{ color: empty ? '#9CA3AF' : s.badgeTextColor }}>
                    {s.label}
                  </span>
                </div>
                <p className={`text-xs lg:text-sm leading-relaxed ${empty ? 'text-gray-500' : 'text-gray-500'}`}>
                  {BLURBS[s.id] ?? s.sourceLine}
                </p>
                {empty ? (
                  <span className="self-start mt-0.5 text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    데이터 준비 중
                  </span>
                ) : SHOW_COUNT.has(s.id) ? (
                  <span className="self-start mt-0.5 text-[10px] font-bold text-mint-600 bg-mint-100 px-2 py-0.5 rounded-full">
                    {s.entries.length}곳 수록
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* 정직성 라인 */}
        <div className="mt-8 lg:mt-12 text-center flex flex-col gap-1.5">
          <p className="text-xs lg:text-sm text-gray-500 leading-relaxed">
            상호와 지역이 공식 목록과 정확히 일치할 때만 표시해요. 애매하면 붙이지 않습니다.
          </p>
          <p className="text-xs lg:text-sm text-gray-500 leading-relaxed">
            각 기관·가이드와의 제휴·후원 관계가 없으며, 공개 발표를 참고 정보로만 안내해요.
            {disclaimers.map((d) => ` ${d}`)}
          </p>
        </div>
      </div>
    </section>
  );
}
