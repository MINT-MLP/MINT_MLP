import type { GroupMember } from '@/types';

interface Props {
  shareLink: string;
  copied: boolean;
  onCopy: () => void;
  onKakaoShare: () => void;
  onRecommend: () => void;
  members: GroupMember[];
  expectedCount: number;
  canRecommend: boolean;
  recommending: boolean;
}

// 그룹 모드: 링크 공유 + 실시간 입력 현황
export default function GroupWaiting({
  shareLink,
  copied,
  onCopy,
  onKakaoShare,
  onRecommend,
  members,
  expectedCount,
  canRecommend,
  recommending,
}: Props) {
  const allVoted = members.length >= expectedCount && members.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* 공유 링크 — 링크 복사 + 카카오톡 공유 둘 다 제공(카톡 안 쓰는 층은 복사, 쓰는 층은 원터치) */}
      <div className="bg-white shadow-sm rounded-2xl p-4">
        <p className="text-xs text-gray-400 mb-2">공유 링크</p>
        <p className="text-sm text-gray-700 truncate bg-gray-50 rounded-xl px-3 py-2.5 mb-3">{shareLink}</p>
        <div className="flex gap-2">
          <button
            onClick={onCopy}
            className="flex-1 px-4 py-2.5 rounded-xl bg-mint-100 text-mint-600 text-sm font-bold transition-all active:scale-95 hover:bg-mint-200"
          >
            {copied ? '복사됨!' : '🔗 링크 복사'}
          </button>
          <button
            onClick={onKakaoShare}
            className="flex-1 flex items-center justify-center gap-1 px-4 py-2.5 rounded-xl bg-kakao text-[#3A1D1D] text-sm font-bold transition-all active:scale-95 hover:brightness-95"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.83 5.31 4.6 6.73L5.5 21.5l4.2-2.3c.74.13 1.51.2 2.3.2 5.52 0 10-3.58 10-8s-4.48-8-10-8z" />
            </svg>
            카카오톡 공유
          </button>
        </div>
      </div>

      {/* 호스트 본인도 참여자 — 자기 출발지·취향을 입력해 멤버로 합류(입력 후 호스트 화면으로 돌아옴) */}
      <button
        onClick={() => { window.location.href = shareLink; }}
        className="w-full py-3 rounded-2xl font-black text-sm transition-all active:scale-95 bg-mint-100 text-mint-600 border-2 border-mint-500/40 hover:bg-mint-200"
      >
        내 취향도 입력하기 →
      </button>
      <p className="-mt-1.5 text-[11px] text-gray-400 text-center leading-relaxed">
        입력을 마치면 이 화면으로 다시 돌아와 추천받을 수 있어요.
      </p>

      {/* 진행률 + 슬롯 */}
      <div className="bg-white shadow-sm rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400">입력 현황</p>
          <p className="text-lg font-black text-mint-600">
            {members.length}
            <span className="text-gray-300 font-bold"> / {expectedCount}</span>
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: expectedCount }).map((_, i) => {
            const member = members[i];
            return (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${
                  member ? 'bg-mint-100' : 'bg-gray-50 border border-dashed border-gray-200'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                  member ? 'bg-mint-500 text-white' : 'bg-gray-200 text-gray-400'
                }`}>
                  {member ? '✓' : i + 1}
                </div>
                <span className={`text-sm font-bold ${member ? 'text-mint-600' : 'text-gray-300'}`}>
                  {member ? member.member_name : '대기 중...'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 추천 버튼 — 전원 완료를 기다리지 않고, 추천 가능(호스트+친구 1명 이상=2명 이상)해지면 바로 노출.
          전원 완료면 축하 문구, 일부만 모였으면 "지금 받아도/더 기다려도 OK" 문구로 안내. */}
      {canRecommend && (
        <div className="p-4 bg-mint-100 border border-mint-500/40 rounded-2xl text-center">
          {allVoted ? (
            <>
              <p className="text-base font-black text-mint-600">🎉 전원 완료!</p>
              <p className="text-xs text-mint-600/70 mt-0.5">모두의 취향이 모였어요. 바로 추천받을 수 있어요.</p>
            </>
          ) : (
            <>
              <p className="text-base font-black text-mint-600">지금 바로 추천받을 수 있어요</p>
              <p className="text-xs text-mint-600/70 mt-0.5">더 기다렸다 다 모이면 받아도 좋고, 지금 받아도 좋아요.</p>
            </>
          )}
          <button
            onClick={onRecommend}
            disabled={!canRecommend || recommending}
            className={`mt-3 w-full py-3 rounded-2xl font-black text-sm transition-all active:scale-95 ${
              canRecommend && !recommending
                ? 'bg-mint-500 text-white shadow-lg shadow-mint-500/25 hover:bg-mint-600'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {recommending ? '추천 준비 중...' : `${members.length}명으로 추천받기 →`}
          </button>
        </div>
      )}
    </div>
  );
}
