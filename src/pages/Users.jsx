import Header from "../components/Header";

export default function Users() {
  return (
    <div className="p-6">
      <Header title="User Management" user={{ name: "Admin" }} />
      <div className="bg-white p-6 rounded-xl shadow">
        <h2 className="text-lg font-semibold mb-4">Users Table</h2>
        <p className="text-gray-500">Coming soon: User roles, permissions, and SSO sync.</p>
      </div>
    </div>
  );
}
