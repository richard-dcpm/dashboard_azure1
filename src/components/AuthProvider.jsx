// AuthProvider.jsx (Focusing on the necessary functions)

import React, { createContext, useContext } from "react"; // Added useContext and createContext
import { MsalProvider, useIsAuthenticated, useMsal } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig, loginRequest } from "../authConfig";

const msalInstance = new PublicClientApplication(msalConfig);

// 1. Create a Context to share user data (optional, but helpful)
const UserContext = createContext(null);
export const useUser = () => useContext(UserContext); // Custom hook for easy access

// Component to handle sign-in button display
function SignInScreen() {
  const { instance } = useMsal();

  const handleLogin = () => {
    // We use loginRedirect or loginPopup here
    instance.loginPopup(loginRequest).catch(e => console.error(e));
  };

  // Reusing your glassmorphism-style Login structure (you can update this styling later)
  return (
    <div className="h-screen flex flex-col justify-center items-center bg-bg">
      <div className="glass-card p-10 rounded-xl shadow-md text-center w-96">
        <h1 className="text-3xl font-bold text-fg mb-4">DCPM Cloud</h1>
        <p className="text-muted mb-6">Sign in with your Microsoft account to continue</p>
        <button
          onClick={handleLogin}
          className="bg-[#0078D4] text-white px-6 py-2 rounded-lg hover:bg-[#005A9E] transition w-full font-semibold"
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}

// Component to check auth status and provide user data
function ProtectedContent({ children }) {
  const isAuthenticated = useIsAuthenticated();
  const { accounts, instance } = useMsal();
  
  // Extract user info
  const user = accounts.length > 0 ? {
      name: accounts[0].name || accounts[0].username.split('@')[0],
      email: accounts[0].username,
      // Provide the MSAL logout function
      logout: () => instance.logoutRedirect(), 
  } : null;

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  // If authenticated, render children inside the UserContext Provider
  return (
    <UserContext.Provider value={user}>
      {children}
    </UserContext.Provider>
  );
}

// Main AuthProvider component
export default function AuthProvider({ children }) {
  return (
    <MsalProvider instance={msalInstance}>
      <ProtectedContent>{children}</ProtectedContent>
    </MsalProvider>
  );
}