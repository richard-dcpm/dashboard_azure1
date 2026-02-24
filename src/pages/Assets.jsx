import Header from "../components/Header";

export default function Assets() {
  return (
    <div className="p-6">
      <Header title="Assets Management" user={{ name: "Admin" }} />
      <div className="bg-white p-6 rounded-xl shadow">
        <h2 className="text-lg font-semibold mb-4">Assets List</h2>
        <p className="text-gray-500">Coming soon: Asset CRUD integration.</p>
      </div>
    </div>
  );
}
