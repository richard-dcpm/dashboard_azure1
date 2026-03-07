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
async function moveAzureFolder(container, oldFolderPath, newFolderPath) {
  const containerClient = getContainerClient(container);

  // Manually ensure trailing slash — don't rely on ensureSlash behaviour
  const oldPrefix = oldFolderPath.endsWith("/") ? oldFolderPath : oldFolderPath + "/";
  const newPrefix = newFolderPath.endsWith("/") ? newFolderPath : newFolderPath + "/";
  const cleanSas  = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;

  console.group(`[moveAzureFolder] ${oldPrefix} → ${newPrefix}`);
  console.log("container:", container);
  console.log("baseUrl:", baseUrl);
  console.log("cleanSas:", cleanSas);

  // ── Step 1: Collect ALL blob names before any mutation ────────────────────
  const blobNames = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
    console.log("  found blob:", blob.name);
    blobNames.push(blob.name);
  }
  console.log("Total blobs found:", blobNames.length);

  if (blobNames.length === 0) {
    console.error("No blobs found — listing may be broken or prefix is wrong.");
    console.groupEnd();
    throw new Error(`No blobs found under "${oldPrefix}". Cannot rename.`);
  }

  // ── Step 2: Copy every blob to its new path ───────────────────────────────
  for (const oldName of blobNames) {
    const newName   = newPrefix + oldName.slice(oldPrefix.length);
    const sourceUrl = `${baseUrl}/${container}/${oldName
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?${cleanSas}`;
    console.log(`  COPY: "${oldName}" → "${newName}"`);
    console.log(`  sourceUrl: ${sourceUrl}`);
    try {
      const destClient = containerClient.getBlockBlobClient(newName);
      const poller     = await destClient.beginCopyFromURL(sourceUrl);
      const result     = await poller.pollUntilDone();
      console.log(`  copy result:`, result.copyStatus);
    } catch (err) {
      console.error(`  COPY FAILED for "${oldName}":`, err);
      console.groupEnd();
      throw err;
    }
  }

  // ── Step 3: Delete originals AFTER all copies confirmed complete ──────────
  const deleteErrors = [];
  for (const oldName of blobNames) {
    try {
      console.log(`  DELETE: "${oldName}"`);
      await containerClient.getBlobClient(oldName).delete({ deleteSnapshots: "include" });
      console.log(`  DELETE OK: "${oldName}"`);
    } catch (err) {
      console.error(`  DELETE FAILED for "${oldName}":`, err.message, err);
      deleteErrors.push(oldName);
    }
  }

  console.groupEnd();

  if (deleteErrors.length > 0) {
    throw new Error(
      `Rename copied successfully but failed to delete ${deleteErrors.length} original blob(s). ` +
      `Check SAS token has Delete ('d') permission.`
    );
  }
}

export function useUploader() {
  const { enqueueFiles, queue, globalProgress, pushHistory, goBack, goForward, canGoBack, canGoForward } =
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
  const renameFolderApi = useCallback(async (container, pathArr, oldName, newName) => {
    const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
    await moveAzureFolder(
      container,
      `${pathStr}${oldName}`,
      `${pathStr}${newName}`
    );
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
    pushHistory,
  };
}