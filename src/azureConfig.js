
// src/azureConfig.js
// Centralized Azure Storage config for your React app (Vite-friendly).
// Make sure the SAS uses plain '&' separators, NOT '&amp;'.
// You can also set these via .env.local as VITE_STORAGE_ACCOUNT_NAME and VITE_SAS_TOKEN.

const envAccount =
  typeof import.meta !== "undefined" ? import.meta.env?.VITE_STORAGE_ACCOUNT_NAME : null;
const envSas =
  typeof import.meta !== "undefined" ? import.meta.env?.VITE_SAS_TOKEN : null;

// ---- EDIT HERE if not using env vars ----
export const storageAccountName = envAccount || "dcpmcloudstorage";

// ✅ Paste the SAS EXACTLY as generated (plain '&', no trailing text after sig)
export const sasToken =
  envSas || "sv=2024-11-04&ss=bfqt&srt=sco&sp=rwdlacup&se=2999-01-02T14:24:13Z&st=2026-01-01T16:10:00Z&spr=https,http&sig=oP2UtdMPZpFp6dgcUx0ZRLSn1rCfs8bA9wU33g6zuQ4%3D";
// Base URL for Blob service
export const baseUrl = `https://${storageAccountName}.blob.core.windows.net`;
