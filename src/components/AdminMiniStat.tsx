export default function AdminMiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-black text-gray-700">{value}</span>
    </div>
  );
}
