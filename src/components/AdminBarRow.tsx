import { cn } from '@/utils/cn';

// 어드민 가로 막대. 막대 색은 Tailwind 배경 클래스로 받는다(bg-amber-500 등). 기본은 브랜드 민트
export default function AdminBarRow({ label, count, total, bar = 'bg-mint-500' }: {
  label: string; count: number; total: number; bar?: `bg-${string}`;
}) {
  const p = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-gray-500 font-bold shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${p}%` }} />
      </div>
      <span className="w-16 text-right text-gray-500 shrink-0">{count}건 ({p}%)</span>
    </div>
  );
}
