
// src/lib/blobClient.js
import { BlobServiceClient } from "@azure/storage-blob";

/**
 * Pass in an account-level SAS service URL:
 * e.g., "https://<account>.blob.core.windows.net/?sv=...&ss=b&srt=sco&sp=rl&st=...&se=...&spr=https&sig=..."
 */
export function createBlobService(accountSasUrl) {
  return new BlobServiceClient(accountSasUrl);
}

export async function listFolders(accountSasUrl, containerName, prefix = "") {
  const blobServiceClient = createBlobService(accountSasUrl);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const folders = [];
  for await (const item of containerClient.listBlobsByHierarchy("/", { prefix })) {
    if (item.kind === "prefix") {
      // Trim trailing slash for cleaner display
      folders.push(item.name.replace(/\/$/, ""));
    }
  }
  return folders;
}

export async function listFiles(accountSasUrl, containerName, prefix = "") {
  const blobServiceClient = createBlobService(accountSasUrl);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const files = [];
  for await (const item of containerClient.listBlobsByHierarchy("/", { prefix })) {
    if (item.kind === "blob") {
      files.push({
        name: item.name,
        url: containerClient.getBlobClient(item.name).url, // account SAS applies
      });
    }
  }
  return files;
}
