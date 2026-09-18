export default function AdminStatCard({ label, value, unit, sub, highlight }: {
  label: string; value: string | number; unit?: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${highlight ? 'border-2 border-mint-500 bg-teal-50' : 'bg-white border border-gray-100'}`}>
      <div className={`text-xs mb-1 ${highlight ? 'text-mint-500 font-bold' : 'text-gray-400'}`}>{label}</div>
      <div className="text-2xl font-black text-mint-500">{value}{unit && <span className="text-sm text-gray-300 font-bold"> {unit}</span>}</div>
      {sub && <div className="text-xs text-gray-300 mt-1">{sub}</div>}
    </div>
  );
}
