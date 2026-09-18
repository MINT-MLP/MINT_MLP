import { useState, type ComponentType } from 'react';
import { getWishlist, removeWish, wishMapLink, buildMapLink, isWished } from '@/storage/wishlist';
import { getDeviceId } from '@/storage/device';
import { placeKey } from '@/storage/points';
import { trackEvent } from '@/services/analytics';
import { MOCK_GEMS } from '@/pages/mock/data/gems';
import { WishlistButton, IconCompass, IconMapPin, IconCheck, IconChevronDown, IconCup, IconUtensils } from '@/components';
import type { WishItem } from '@/types';

const WISH_PREVIEW = 5;
const GEM_PREVIEW = 4;

/* ── 카테고리 썸네일용 인라인 아이콘 ──
   실존 가게라 사진을 못 쓰므로, 카드 좌측 컬러 블록이 유일한 시각 앵커다.
   icons.tsx와 같은 시각 언어(viewBox 24 / stroke currentColor / round cap·join)를 따르되,
   음식 카테고리 전용 글리프라 공용 파일을 건드리지 않고 여기 둔다. */

interface GlyphProps {
  className?: string;
}

function glyphProps(className?: string) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

// 고깃집 — 불판 위 불꽃
function IconFlame({ className }: GlyphProps) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M12 20.5c3.2 0 5.7-2.3 5.7-5.4 0-3.9-3.1-6-4.2-9.1-1.6 1-2.4 2.5-2.4 4.1 0 1-.8 1.5-1.4.9-.6-.6-.9-1.3-.9-2.2-1.8 2.5-2.5 4.6-2.5 6.3 0 3.1 2.5 5.4 5.7 5.4Z" />
    </svg>
  );
}

// 중식 — 면 그릇 + 젓가락
function IconNoodleBowl({ className }: GlyphProps) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M3.8 11.5h16.4a8.2 8.2 0 0 1-16.4 0Z" />
      <path d="M6.5 20.5h11" />
      <path d="M14.6 3.6 10.2 10.4M17.6 4.8 13.4 11" />
    </svg>
  );
}

// 베이커리 — 식빵 한 덩이
function IconBread({ className }: GlyphProps) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M5 10.6a3 3 0 0 1 2-5.3h10a3 3 0 0 1 2 5.3v7.5a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 18.1Z" />
      <path d="M9.6 5.4v14.1" />
    </svg>
  );
}

// 이자카야 — 꼬치
function IconSkewer({ className }: GlyphProps) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M4.5 19.5 19.5 4.5" />
      <circle cx="8.9" cy="15.1" r="2.1" />
      <circle cx="12.4" cy="11.6" r="2.1" />
      <circle cx="15.9" cy="8.1" r="2.1" />
    </svg>
  );
}

// 바 — 칵테일 잔
function IconCocktail({ className }: GlyphProps) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M4.5 5h15l-7.5 7.6Z" />
      <path d="M12 12.6V20" />
      <path d="M8.2 20h7.6" />
    </svg>
  );
}

// 한식 — 뚝배기
function IconStewPot({ className }: GlyphProps) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M5.2 11.2h13.6v3.9a4.4 4.4 0 0 1-4.4 4.4H9.6a4.4 4.4 0 0 1-4.4-4.4Z" />
      <path d="M3.4 11.2h17.2" />
      <path d="M9.6 7.8c0-1.1 1-1.4 1-2.5M14 7.8c0-1.1 1-1.4 1-2.5" />
    </svg>
  );
}

// 찜 해제 ✕
function IconX({ className }: GlyphProps) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </svg>
  );
}

/* ── 카테고리 → 색 매핑 ──
   연한 배경 + 진한 아이콘 조합만 쓴다(원색 블록은 브랜드 톤을 해친다).
   민트(#3CDBC0 계열)는 '선택됨/브랜드' 신호로 남겨두고 카테고리 색으로 쓰지 않는다.
   찜 목록의 WishItem도 같은 매핑을 타야 해서, 목업 데이터가 아니라 화면 쪽에 둔다. */

interface CategoryTone {
  bg: string;
  fg: string;
  Icon: ComponentType<{ className?: string }>;
}

const NEUTRAL_TONE: CategoryTone = { bg: 'bg-gray-100', fg: 'text-gray-400', Icon: IconMapPin };

const CATEGORY_TONES: Record<string, CategoryTone> = {
  고깃집: { bg: 'bg-orange-50', fg: 'text-orange-500', Icon: IconFlame },
  카페: { bg: 'bg-[#F4EDE6]', fg: 'text-[#9C6B4A]', Icon: IconCup },
  중식: { bg: 'bg-red-50', fg: 'text-red-500', Icon: IconNoodleBowl },
  베이커리: { bg: 'bg-amber-50', fg: 'text-amber-600', Icon: IconBread },
  이자카야: { bg: 'bg-indigo-50', fg: 'text-indigo-500', Icon: IconSkewer },
  바: { bg: 'bg-purple-50', fg: 'text-purple-500', Icon: IconCocktail },
  파스타집: { bg: 'bg-lime-50', fg: 'text-lime-600', Icon: IconUtensils },
  한식: { bg: 'bg-[#EDF2EC]', fg: 'text-[#5F7A5A]', Icon: IconStewPot },
};

// 찜 목록 category는 추천 결과에서 온 자유 문자열이라 부분 일치로 한 번 더 걸러준다.
const TONE_ALIASES: Array<[keyof typeof CATEGORY_TONES, string[]]> = [
  ['고깃집', ['고기', '구이', '갈비', '삼겹', '정육', '곱창', '스테이크', '바베큐']],
  ['카페', ['카페', '커피', '디저트', '티룸']],
  ['중식', ['중식', '중국', '마라', '딤섬', '짬뽕', '양꼬치']],
  ['베이커리', ['베이커리', '빵', '제과', '도넛', '케이크']],
  ['이자카야', ['이자카야', '꼬치', '야키', '포차', '술집', '주점', '오뎅']],
  ['바', ['칵테일', '와인', '위스키', '펍', 'bar']],
  ['파스타집', ['파스타', '양식', '이탈리', '피자', '스테이크하우스']],
  ['한식', ['한식', '국밥', '찌개', '백반', '분식', '족발', '보쌈', '해장', '전골']],
];

function resolveTone(category?: string | null): CategoryTone {
  const c = (category ?? '').trim();
  if (!c) return NEUTRAL_TONE;
  const exact = CATEGORY_TONES[c];
  if (exact) return exact;
  const alias = TONE_ALIASES.find(([, keywords]) => keywords.some((k) => c.includes(k)));
  return alias ? CATEGORY_TONES[alias[0]] : NEUTRAL_TONE;
}

// 사진 대신 쓰는 카테고리 컬러 블록. 카드마다 다른 색이라 목록이 죽 이어져 보이지 않는다.
function CategoryThumb({ category, size = 'md' }: { category?: string | null; size?: 'md' | 'lg' }) {
  const tone = resolveTone(category);
  const box = size === 'lg' ? 'h-14 w-14' : 'h-12 w-12';
  const glyph = size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-xl ${box} ${tone.bg} ${tone.fg}`}>
      <tone.Icon className={glyph} />
    </div>
  );
}

// 발굴 탭 — 내가 찜한 곳 + 오늘의 원석. 찜은 결과 화면과 같은 localStorage를 공유한다.
export default function Discover() {
  const [items, setItems] = useState<WishItem[]>(() => getWishlist());
  const [showAllWishes, setShowAllWishes] = useState(false);
  const [showAllGems, setShowAllGems] = useState(false);

  function refresh() {
    setItems(getWishlist());
  }

  function remove(key: string) {
    setItems(removeWish(key));
    trackEvent('wishlist_remove', { device_id: getDeviceId(), place_key: key });
  }

  const shownWishes = showAllWishes ? items : items.slice(0, WISH_PREVIEW);
  const shownGems = showAllGems ? MOCK_GEMS : MOCK_GEMS.slice(0, GEM_PREVIEW);
  const restGems = MOCK_GEMS.length - GEM_PREVIEW;

  return (
    <div className="max-w-md mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="flex items-center gap-2 text-[22px] font-black text-gray-900">
        <IconCompass className="h-[22px] w-[22px] text-mint-600" />
        발굴
      </h1>
      <p className="mt-1 text-sm text-gray-400">마음에 든 곳을 저장하고, 아직 안 알려진 곳을 먼저 찾아보세요.</p>

      {/* 섹션 1 — 내가 찜한 곳 */}
      <section className="mt-6">
        <p className="px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
          내가 찜한 곳{items.length > 0 ? ` · ${items.length}곳` : ''}
        </p>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white px-5 py-10 text-center">
            <IconMapPin className="mx-auto h-8 w-8 text-gray-200" />
            <p className="mt-3 text-sm font-black text-gray-700">아직 찜한 곳이 없어요</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400 break-keep">
              아래 원석의 하트를 누르면 여기에 모여요
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {shownWishes.map((w) => (
                <div key={w.place_key} className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-white pl-3 pr-2 py-2.5">
                  <a
                    href={wishMapLink(w)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-3 transition-transform active:scale-[0.99]"
                  >
                    <CategoryThumb category={w.category} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-gray-800">{w.place_name}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-400">
                        {w.category ? `${w.category} · ` : ''}{w.address}
                      </span>
                    </span>
                  </a>
                  {/* 히트박스는 40px, 눈에 보이는 원은 28px로 유지 */}
                  <button
                    onClick={() => remove(w.place_key)}
                    aria-label="찜 해제"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400">
                      <IconX className="h-3 w-3" />
                    </span>
                  </button>
                </div>
              ))}
            </div>
            {items.length > WISH_PREVIEW && (
              <button
                onClick={() => setShowAllWishes((v) => !v)}
                aria-expanded={showAllWishes}
                className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-1 text-xs font-bold text-gray-400 active:scale-[0.99] transition-transform"
              >
                {showAllWishes ? '접기' : `찜한 곳 ${items.length}건 모두 보기`}
                <IconChevronDown className={`h-4 w-4 transition-transform ${showAllWishes ? 'rotate-180' : ''}`} />
              </button>
            )}
          </>
        )}
      </section>

      {/* 섹션 2 — 오늘의 원석 */}
      <section className="mt-7">
        <p className="px-1 mb-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">오늘의 원석</p>
        {/* 편집 기준 고지 — 외부 지표를 인용하는 게 아니라 MINT 스스로의 선정 방식을 밝히는 문장이라
            "사실만 신호" 원칙과 충돌하지 않는다. '광고 아니냐'는 의심을 선제 차단한다. */}
        <p className="px-1 mb-1 text-xs leading-relaxed text-gray-500 break-keep">
          순위나 언급량이 아니라, MINT가 직접 확인하고 고른 곳들이에요.
        </p>
        {/* 내 기기 기준 개인화 카피 — 다른 사람 순위를 말하지 않는다 */}
        <p className="px-1 mb-2.5 text-xs leading-relaxed text-gray-400 break-keep">
          먼저 찜해두면 나중에 이 동네를 처음 찾은 사람으로 기록될 수 있어요
        </p>

        <div className="flex flex-col gap-3">
          {shownGems.map((gem) => {
            const key = placeKey(gem);
            const wished = isWished(key);
            const tone = resolveTone(gem.category);
            return (
              <div key={gem.placeName} className="rounded-2xl border border-gray-100 bg-white p-3.5">
                <div className="flex items-start gap-2">
                  <a
                    href={buildMapLink(gem.placeName, gem.lat, gem.lng)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => trackEvent('discover_gem_map_open', { device_id: getDeviceId(), place_key: key })}
                    className="flex min-w-0 flex-1 items-start gap-3 transition-transform active:scale-[0.99]"
                  >
                    <CategoryThumb category={gem.category} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-black text-gray-800">{gem.placeName}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${tone.bg} ${tone.fg}`}>
                          {gem.category}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-400">{gem.area} · {gem.address}</span>
                      <span className="mt-1.5 block text-xs leading-relaxed text-gray-600 break-keep line-clamp-2">{gem.description}</span>
                    </span>
                  </a>
                  <div className="shrink-0 pt-0.5">
                    {/* key에 wished를 넣어 위 찜 목록에서 해제했을 때 하트도 같이 되돌아가게 한다 */}
                    <WishlistButton key={`${gem.placeName}-${wished}`} place={gem} rank="candidate" source="discover" onChange={refresh} />
                  </div>
                </div>

                {wished && (
                  <p className="mt-2.5 flex items-center gap-1 text-[11px] font-bold text-mint-600">
                    <IconCheck className="h-3 w-3" strokeWidth={2.6} />
                    담았어요
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {restGems > 0 && (
          <button
            onClick={() => setShowAllGems((v) => !v)}
            aria-expanded={showAllGems}
            className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-1 text-xs font-bold text-gray-400 active:scale-[0.99] transition-transform"
          >
            {showAllGems ? '원석 접기' : `원석 ${restGems}곳 더 보기`}
            <IconChevronDown className={`h-4 w-4 transition-transform ${showAllGems ? 'rotate-180' : ''}`} />
          </button>
        )}

        <p className="mt-4 text-center text-[11px] text-gray-400">원석 추천은 매주 업데이트될 예정이에요</p>
      </section>
    </div>
  );
}
