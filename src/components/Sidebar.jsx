
import { Home, FileText, Users, BarChart2, Upload, Image, Map } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(true);
  const location = useLocation();

  const menuItems = [
    { name: "Dashboard", icon: <Home size={20} />, path: "/" },
    { name: "Assets", icon: <FileText size={20} />, path: "/assets" },
    { name: "Users", icon: <Users size={20} />, path: "/users" },
    { name: "Reports", icon: <BarChart2 size={20} />, path: "/reports" },
    { name: "Uploader", icon: <Upload size={20} />, path: "/upload" },
    { name: "Gallery", icon: <Image size={20} />, path: "/gallery" },
    { name: "View Map", icon: <Map size={20} />, path: "/map" }, // NEW
  ];

  return (
    <aside className="bg-gray-800 text-white w-64 min-h-screen flex flex-col">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="mb-6 text-gray-400 hover:text-white p-4"
      >
        ☰
      </button>
      <nav className="flex-1">
        <ul>
          {menuItems.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-700 transition ${
                  location.pathname === item.path ? "bg-gray-700 font-semibold" : ""
                }`}
              >
                {item.icon}
                {isOpen && <span>{item.name}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
