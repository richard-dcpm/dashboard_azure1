import Header from "../components/Header";

export default function Reports() {
  return (
    <div className="p-6">
      <Header title="Reports and Analytics" user={{ name: "Admin" }} />
      <div className="bg-white p-6 rounded-xl shadow">
        <h2 className="text-lg font-semibold mb-4">Reports</h2>
        <p className="text-gray-500">Coming soon: Charts, exports, and KPIs.</p>
      </div>
    </div>
  );
}
