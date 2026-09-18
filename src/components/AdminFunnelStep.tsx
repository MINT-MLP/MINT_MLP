export default function AdminFunnelStep({ label, value, rate, last }: {
  label: string; value: number; rate: string | null; last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${last ? '' : 'border-b border-gray-50'}`}>
      <span className="text-sm font-bold text-gray-700">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-lg font-black text-mint-500">{value}</span>
        {rate != null && (
          // rate는 pctLabel이 만든 완성 문자열이다(%까지 포함, 분모 0이면 '—').
          <span className="text-xs text-gray-400 w-16 text-right">직전 {rate}</span>
        )}
      </div>
    </div>
  );
}
