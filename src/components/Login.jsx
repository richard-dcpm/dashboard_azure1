import React from 'react';
import { useAuth } from "../components/AuthProvider"; 
// Assuming you have a basic Microsoft logo SVG or image ready for use
// For this example, we'll use an emoji and styling

export default function Login(){
  const { login } = useAuth(); // Get the login function from context

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg">
      <div className="max-w-4xl w-full mx-auto p-4">
        
        {/* Updated panel to use glass-card for consistent styling */}
        <div className="glass-card grid gap-8 lg:grid-cols-2 p-10">
          <div className="flex flex-col justify-center">
            <h1 className="text-4xl font-extrabold text-primary-600 mb-2">DCPM</h1>
            <p className="text-lg text-fg/80 mb-6">Cloud Assets Dashboard</p>

            <h2 className="text-2xl font-bold text-fg mb-4">Sign in with Microsoft</h2>
            <p className="text-muted mb-6">Access your dashboard using your company Microsoft account.</p>
            
            {/* --- MICROSOFT SIGN IN BUTTON --- */}
            <button 
              onClick={login} // ❗ Calls the MSAL login function from AuthProvider
              className="mt-4 bg-[#0078D4] text-white px-6 py-3 rounded-lg hover:bg-[#005A9E] transition w-full flex items-center justify-center font-semibold shadow-md"
            >
              <span className="text-xl mr-3">
                <svg fill="#ffffff" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
                    <path d="M10 0l-10 10l10 10l10-10z" fill="none"></path>
                    <path fill="#ffffff" d="M3 3h7v7H3zM10 10h7v7h-7zM3 10h7v7H3zM10 3h7v7h-7z"></path>
                </svg>
              </span>
              Sign in with Microsoft
            </button>
            {/* -------------------------------- */}
            
          </div>

          <div className="hidden lg:flex flex-col justify-center items-center p-8 bg-white/5 rounded-lg border border-glass-border">
            <h2 className="font-semibold text-2xl mb-2 text-fg">Welcome back</h2>
            <p className="text-muted text-center">Your secure, compliant cloud asset management starts here.</p>
          </div>
        </div>
      </div>
    </main>
  );
}