
// src/lib/blobList.ts
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";

export function getContainerClient(accountSasUrl: string, container: string): ContainerClient {
  const service = new BlobServiceClient(accountSasUrl);
  return service.getContainerClient(container);
}

export async function listFolders(
  accountSasUrl: string,
  container: string,
  prefix: string = ""
): Promise<string[]> {
  const client = getContainerClient(accountSasUrl, container);
  const folders: string[] = [];
  for await (const item of client.listBlobsByHierarchy("/", { prefix })) {
    if (item.kind === "prefix") folders.push(item.name.replace(/\/$/, ""));
  }
  return folders;
}

export interface ListedFile {
  name: string;
  url: string;
}

export async function listFiles(
  accountSasUrl: string,
  container: string,
  prefix: string = ""
): Promise<ListedFile[]> {
  const client = getContainerClient(accountSasUrl, container);
  const files: ListedFile[] = [];
  for await (const item of client.listBlobsByHierarchy("/", { prefix })) {
    if (item.kind === "blob") {
      files.push({
        name: item.name,
        url: client.getBlobClient(item.name).url,
      });
    }
  }
  return files;
}
