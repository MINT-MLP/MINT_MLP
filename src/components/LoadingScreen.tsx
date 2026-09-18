interface Props {
  progress: number;
  message: string;
}

// 추천 생성 중 원형 프로그레스 화면
export default function LoadingScreen({ progress, message }: Props) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ - (progress / 100) * circ;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-mint-50 px-4 gap-7">
      <p className="text-mint-500 font-black text-2xl tracking-[0.3em] pl-[0.3em]">MINT</p>

      <div className="relative w-44 h-44 flex items-center justify-center">
        <div className="absolute w-32 h-32 rounded-full bg-mint-500/20 blur-2xl animate-pulse" />

        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120" aria-hidden>
          {/* SVG 프레젠테이션 속성은 CSS 변수를 못 읽는다 — stroke는 클래스로 */}
          <circle cx="60" cy="60" r={r} fill="none" className="stroke-mint-100" strokeWidth="9" />
          <circle
            cx="60" cy="60" r={r}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className="stroke-mint-500 transition-all duration-300 ease-out"
          />
        </svg>

        <div className="relative flex flex-col items-center">
          <img
            src="/image/mascot-bird.webp"
            alt=""
            className="w-16 h-16 select-none drop-shadow-sm animate-mascot-bob"
          />
          <span className="text-sm font-black text-mint-600 leading-none mt-0.5">{Math.round(progress)}%</span>
        </div>
      </div>

      <div className="text-center" aria-live="polite">
        <p className="text-base font-bold text-mint-600">{message}</p>
        <p className="text-xs text-gray-400 mt-1">전국 79만 곳에서 딱 맞는 곳을 찾고 있어요</p>
      </div>
    </div>
  );
}
