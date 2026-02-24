
import { BlobServiceClient } from "@azure/storage-blob";
import { storageAccountName, sasToken, baseUrl } from "./azureConfig";

// Single shared service client (SAS in URL; no Authorization header)
export const blobService = new BlobServiceClient(`${baseUrl}/?${sasToken}`);

export const getContainerClient = (container) => blobService.getContainerClient(container);
export const getBlockBlobClient = (container, blobPath) =>
  getContainerClient(container).getBlockBlobClient(blobPath);

// Path helpers
export const ensureSlash = (p) => (p ? (p.endsWith("/") ? p : `${p}/`) : "");
export const normalizePrefix = (p) => (!p ? "" : ensureSlash(p));

// Convenience for public blob URLs with SAS
export const blobUrl = (container, name) => `${baseUrl}/${container}/${name}?${sasToken}`;

export { storageAccountName, sasToken, baseUrl };
