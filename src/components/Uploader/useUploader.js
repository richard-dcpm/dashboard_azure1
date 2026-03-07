import { useState, useCallback } from "react";
import { useUploadQueue } from "../UploadQueueProvider";
import { useNavigate } from "react-router-dom";

import {
  getContainerClient,
  getBlockBlobClient,
  ensureSlash,
  normalizePrefix,
  sasToken,
  baseUrl,
} from "../../azureBlob";

const HIDDEN_PREFIX = ".hidden_";

// ── Internal: copy-then-delete every blob under a prefix ──────────────────────
/***
async function moveAzureFolder(container, oldFolderPath, newFolderPath) {
  const containerClient = getContainerClient(container);
  const oldPrefix = ensureSlash(oldFolderPath);
  const newPrefix = ensureSlash(newFolderPath);
  const cleanSas = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;

  for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
    const oldName = blob.name;
    const newName = oldName.replace(oldPrefix, newPrefix);
    const sourceUrl = `${baseUrl}/${container}/${oldName.split("/").map(encodeURIComponent).join("/")}?${cleanSas}`;
    const destClient = containerClient.getBlockBlobClient(newName);
    const poller = await destClient.beginCopyFromURL(sourceUrl);
    await poller.pollUntilDone();
    await containerClient.getBlobClient(oldName).delete();
  }
}
**/
/**
async function moveAzureFolder(container, oldFolderPath, newFolderPath) {
  const containerClient = getContainerClient(container);
  const oldPrefix = ensureSlash(oldFolderPath);
  const newPrefix = ensureSlash(newFolderPath);
  const cleanSas = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;

  // ① Materialise the full list BEFORE touching storage
  const blobNames = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
    blobNames.push(blob.name);
  }

  // ② Copy + delete concurrently (safe now — iterator is closed)
  await Promise.all(
    blobNames.map(async (oldBlobName) => {
      // ③ Slice, not replace — unambiguously strips the leading prefix
      const newBlobName = newPrefix + oldBlobName.slice(oldPrefix.length);

      const sourceUrl = `${baseUrl}/${container}/${oldBlobName
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?${cleanSas}`;

      const destClient = containerClient.getBlockBlobClient(newBlobName);
      const poller = await destClient.beginCopyFromURL(sourceUrl);
      await poller.pollUntilDone();

      await containerClient.getBlobClient(oldBlobName).delete();
    })
  );
}
**/
async function moveAzureFolder(container, oldFolderPath, newFolderPath) {
  const containerClient = getContainerClient(container);
  const oldPrefix = ensureSlash(oldFolderPath);
  const newPrefix = ensureSlash(newFolderPath);
  const cleanSas = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;

  // Collect regular blobs under the prefix
  const blobNames = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
    blobNames.push(blob.name);
  }

  // Check for a directory marker blob (blob name === "folder/")
  let hasMarker = false;
  try {
    await containerClient.getBlobClient(oldPrefix).getProperties();
    hasMarker = true;
  } catch {
    // no marker — fine
  }

  // Copy + delete all real blobs
  await Promise.all(
    blobNames.map(async (oldBlobName) => {
      const newBlobName = newPrefix + oldBlobName.slice(oldPrefix.length);
      const sourceUrl = `${baseUrl}/${container}/${oldBlobName
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?${cleanSas}`;

      const destClient = containerClient.getBlockBlobClient(newBlobName);
      const poller = await destClient.beginCopyFromURL(sourceUrl);
      await poller.pollUntilDone();
      await containerClient.getBlobClient(oldBlobName).delete();
    })
  );

  if (hasMarker) {
    // Can't upload/copy a blob named "x/" — recreate the marker the same way createFolderApi does
    await containerClient.getBlockBlobClient(`${newPrefix}placeholder.txt`).upload("placeholder", 11);
    await containerClient.getBlobClient(oldPrefix).delete();
  }
}

export function useUploader() {
  const { enqueueFiles, queue, globalProgress, retryItem, cancelItem, pushHistory, goBack, goForward, canGoBack, canGoForward } =
    useUploadQueue();
  const navigate = useNavigate();

  const [containers] = useState(["raw", "processed", "projects", "uploads", "issued"]);
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [currentPath, setCurrentPath] = useState([]);

  const selectContainer = (name) => {
    setSelectedContainer(name);
    setCurrentPath([]);
    pushHistory(name, []);
  };

  const goHome = () => navigate("/");

  // ── listFolders: returns ALL leaf folder names (layout handles showHidden filter) ──
  const listFolders = useCallback(async (container, pathArr) => {
    const prefix = normalizePrefix(pathArr.join("/"));
    const containerClient = getContainerClient(container);
    const names = [];

    for await (const item of containerClient.listBlobsByHierarchy("/", { prefix })) {
      if (item.kind === "prefix") {
        const leafName = item.name.replace(/\/$/, "").split("/").pop();
        names.push(leafName);
      }
    }
    return names;
  }, []);

  // ── createFolderApi ────────────────────────────────────────────────────────
  const createFolderApi = useCallback(async (container, pathArr, name) => {
    const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
    const blobPath = `${pathStr}${name}/placeholder.txt`;
    const blobClient = getBlockBlobClient(container, blobPath);
    await blobClient.upload("placeholder", 11);
  }, []);

  // ── renameFolderApi ────────────────────────────────────────────────────────
  /**
  const renameFolderApi = useCallback(async (container, pathArr, oldName, newName) => {
    const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
    await moveAzureFolder(container, `${pathStr}${oldName}`, `${pathStr}${newName}`);
  }, []);
  **/
  const renameFolderApi = useCallback(async (container, pathArr, oldName, newName) => {
	  const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
	  const oldPath = `${pathStr}${oldName}`;
	  const newPath = `${pathStr}${newName}`;
	  console.log("[renameFolderApi] →", { container, pathStr, oldPath, newPath });
	  await moveAzureFolder(container, oldPath, newPath);
	  console.log("[renameFolderApi] moveAzureFolder done ✓");
	}, []);

  // ── hideFolderApi: toggles HIDDEN_PREFIX on the folder name ───────────────
  const hideFolderApi = useCallback(async (container, pathArr, name, targetName) => {
    const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
    await moveAzureFolder(container, `${pathStr}${name}`, `${pathStr}${targetName}`);
  }, []);

  return {
    containers,
    selectedContainer,
    currentPath,
    queue,
    globalProgress,

    selectContainer,
    setCurrentPath,
    goHome,

    listFolders,
    createFolderApi,
    renameFolderApi,
    hideFolderApi,

    goBack,
    goForward,
    canGoBack,
    canGoForward,
    enqueueFiles,
    retryItem,
    cancelItem,
    pushHistory,
  };
}