export default function StatsCard({ title, value, icon }) {
  return (
    <div className="bg-white p-4 rounded-xl shadow hover:shadow-md transition">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-gray-500 text-sm">{title}</h3>
          <p className="text-2xl font-semibold text-gray-800 mt-1">{value}</p>
        </div>
        <div className="text-gray-400">{icon}</div>
      </div>
    </div>
  );
}
