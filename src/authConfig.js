// authConfig.js
export const msalConfig = {
  auth: {
    clientId: "11fa9e20-5847-4a53-9db0-eb0863eb478f",
    authority: "https://login.microsoftonline.com/96b1946e-7417-49d0-93ec-462660360739",
    redirectUri: window.location.origin + (window.location.pathname.includes('/dashboard') ? '/dashboard' : ''),
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ["User.Read"],
};
