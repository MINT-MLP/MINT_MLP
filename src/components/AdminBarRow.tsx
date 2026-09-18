export default function AdminBarRow({ label, count, total, color = 'rgb(var(--mint-500))' }: {
  label: string; count: number; total: number; color?: string;
}) {
  const p = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-gray-500 font-bold shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: color }} />
      </div>
      <span className="w-16 text-right text-gray-500 shrink-0">{count}건 ({p}%)</span>
    </div>
  );
}
