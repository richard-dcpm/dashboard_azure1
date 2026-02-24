import React from 'react';
import { Link } from 'react-router-dom';
import { useUser } from "../components/AuthProvider"; // ❗ Use the new custom hook


export default function Dashboard() {
  const user = useUser(); // Get user data and logout function

  const menuItems = [
    // ... (menu items remain the same) ...
    { title: 'Photo Uploader', icon: '📸', subtitle: 'Upload new images and entire folders for processing.', path: '/upload' },
    { title: 'Image Gallery', icon: '🖼️', subtitle: 'View, filter, and manage all uploaded and processed images.', path: '/gallery' },
    { title: 'RECK Analysis', icon: '🔍', subtitle: 'Access detailed reports and deep learning analysis results.', path: '/reck' },
    { title: 'ADDi Projects', icon: '🧠', subtitle: 'View, configure, and manage ADDi detection parameters and projects.', path: '/addi' },
    { title: 'Map Viewer', icon: '🗺️', subtitle: 'Visualize asset locations and geo-tagged image data on a map interface.', path: '/map' },
  ];

  // Note: user is guaranteed to be present and contain name/email/logout due to ProtectedContent
	const currentUser = {
	  id: 1,
	  name: 'Tom Steele',
	  role: 'admin',  // must match one of the allowed roles
	};
	
	
  return (
    <div className="min-h-screen pt-4 pb-12 text-fg"> 
      
      {/* 1. Header Section */}
      <header className="py-4 px-8 flex justify-between items-center 
                         bg-glass-white backdrop-blur-glass border-b border-glass-border shadow-md 
                         rounded-lg mb-12 container mx-auto">
        
        <div className="font-semibold text-lg">Dashboard</div>
        <div className="text-2xl font-extrabold text-primary-600">DCPM</div>
        
        {/* --- DYNAMIC USER INFO & LOGOUT BUTTON --- */}
        <div className="flex items-center space-x-4">
          <div className="text-right">
            {/* Display dynamic user name */}
            <div className="font-semibold">{user.name}</div> 
            {/* Display dynamic user email */}
            <div className="text-sm opacity-80">{user.email}</div> 
          </div>
          <button 
            onClick={user.logout} // ❗ Functional logout call from MSAL
            className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-4 rounded-md transition-colors text-sm">
            Logout
          </button>
        </div>
        {/* ----------------------------------------- */}
      </header>

      {/* Main Content Area */}
      <main className="container mx-auto px-4">
        
        {/* Greeting/Title */}
        <h1 className="text-4xl font-light mb-12 text-fg text-center">
            Welcome, <span className="font-semibold">{user.name}</span>
        </h1>
        
        {/* 2. Menu Cards Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
          {menuItems.map((item) => (
            <Link key={item.path} to={item.path} className="block group">
                <article className="glass-card p-6 flex flex-col items-center justify-center min-h-[200px] text-center h-full 
                                    transform transition-transform duration-300 hover:scale-[1.03]">
                  
                  <div className="text-5xl mb-4 group-hover:animate-bounce-once">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-primary-600">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted">
                    {item.subtitle}
                  </p>
                </article>
            </Link>
          ))}
        </section>

      </main>
    </div>
  );
}