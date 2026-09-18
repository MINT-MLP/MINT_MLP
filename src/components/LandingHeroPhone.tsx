// 히어로 전용 디바이스 프레임 — 얇은 흰 베젤 + 깊은 그림자로 실제 폰처럼
import { cn } from '@/utils/cn';

export default function LandingHeroPhone({ src, alt, className, featured = false }: { src: string; alt: string; className?: string; featured?: boolean }) {
  return (
    <div className={cn('rounded-[2.1rem] bg-white p-1.5 ring-1 ring-black/5', !featured && 'shadow-2xl shadow-mint-900/10', className)}>
      <div className="overflow-hidden rounded-[1.7rem] bg-white">
        <img src={src} alt={alt} className="block w-full" loading="lazy" />
      </div>
    </div>
  );
}
