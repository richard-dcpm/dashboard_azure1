import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react'; // Assuming you have lucide-react installed

const ADDI_URL = 'https://dcpm-addi.cloudflareaccess.com';

export default function ADDi() {
  const navigate = useNavigate();

  const handleOpenADDi = () => {
    window.open(ADDI_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8 relative">
      {/* Header Section with Back to Dashboard */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-fg">ADDi Projects</h1>

        {/* Back to Dashboard Button using React Router */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80"
        >
          <Home size={18} />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* Instruction Text */}
      <p className="text-black mb-4">
        Click the button below to access ADDi. You will be prompted to log in via Cloudflare Access.
      </p>

      {/* Open ADDi Button */}
      <div>
        <button
          onClick={handleOpenADDi}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80"
          title="Opens ADDi in a new tab. After logging in, return to the dashboard."
        >
          <Home size={18} />
          <span>Open ADDi</span>
        </button>

        <p className="mt-2 text-sm text-black">
          After logging in, you can close the ADDi tab to return to this dashboard.
        </p>
      </div>
    </div>
  );
}
