export const CONTAINER_OPTIONS = ["raw", "processed", "projects", "uploads", "issued"];
export const STORAGE = import.meta.env.VITE_STORAGE_ACCOUNT_NAME || "dcpmcloudstorage";
export const SAS =
  import.meta.env.VITE_ACCOUNT_SAS_TOKEN ||
  "sv=2024-11-04&ss=bfqt&srt=sco&sp=rwdlacup&se=2999-01-02T14:24:13Z&st=2026-01-01T16:10:00Z&spr=https,http&sig=oP2UtdMPZpFp6dgcUx0ZRLSn1rCfs8bA9wU33g6zuQ4%3D";
export const BASE_URL = `https://${STORAGE}.blob.core.windows.net`;

export const DEFAULT_CENTER = [-25.2744, 133.7751];
export const DEFAULT_ZOOM = 4;
