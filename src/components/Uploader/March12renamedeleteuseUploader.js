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

const HIDDEN_PREFIX = ".hidden_";   // soft — visible via toggle
const TRASH_PREFIX  = ".trash_";    // permanent — never shown in UI

// ── Internal: copy-then-delete every blob under a prefix ──────────────────────
/**
async function moveAzureFolder(container, oldFolderPath, newFolderPath) {
  const containerClient = getContainerClient(container);
  const oldPrefix = ensureSlash(oldFolderPath);
  const newPrefix = ensureSlash(newFolderPath);
  const cleanSas = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;

  const blobNames = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
    if (!blob.name.endsWith("/")) blobNames.push(blob.name);
  }

  console.log("[moveAzureFolder] blobNames found →", blobNames);

  if (blobNames.length === 0) {
    await containerClient.getBlockBlobClient(`${newPrefix}placeholder.txt`).upload("placeholder", 11);
    const err = new Error("LEGACY_FOLDER");
    err.newFolderCreated = true;
    throw err;
  }

  await Promise.all(
    blobNames.map(async (oldBlobName) => {
      const newBlobName = newPrefix + oldBlobName.slice(oldPrefix.length);
      const sourceUrl = `${baseUrl}/${container}/${oldBlobName
        .split("/").map(encodeURIComponent).join("/")}?${cleanSas}`;

      console.log("[moveAzureFolder] copying →", oldBlobName, "→", newBlobName);
      const destClient = containerClient.getBlockBlobClient(newBlobName);
      const poller = await destClient.beginCopyFromURL(sourceUrl);
      await poller.pollUntilDone();
      console.log("[moveAzureFolder] copy done, deleting →", oldBlobName);

      await containerClient.getBlobClient(oldBlobName).delete();
      console.log("[moveAzureFolder] deleted ✓", oldBlobName);
    })
  );

  console.log("[moveAzureFolder] all done ✓");
}
**/

async function moveAzureFolder(container, oldFolderPath, newFolderPath) {
  const containerClient = getContainerClient(container);
  const oldPrefix = ensureSlash(oldFolderPath);  
  const newPrefix = ensureSlash(newFolderPath);  
  const cleanSas  = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;

  // 1️⃣ Collect all content blobs under the prefix
  const blobNames = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
    blobNames.push(blob.name);
  }
  //console.log("[moveAzureFolder] blobNames found →", blobNames);

  // 2️⃣ Copy + delete all content blobs
  await Promise.all(
    blobNames.map(async (oldBlobName) => {
      const newBlobName = newPrefix + oldBlobName.slice(oldPrefix.length);
      const sourceUrl   = `${baseUrl}/${container}/${oldBlobName.split("/").map(encodeURIComponent).join("/")}?${cleanSas}`;
      
      const sourceClient = containerClient.getBlobClient(oldBlobName); 	  
      //console.log("[moveAzureFolder] copying →", oldBlobName, "→", newBlobName);
      const destClient = containerClient.getBlockBlobClient(newBlobName);
      const poller     = await destClient.beginCopyFromURL(sourceUrl);
      await poller.pollUntilDone();
      //console.log("[moveAzureFolder] copy done, deleting →", oldBlobName);
      await containerClient.getBlobClient(oldBlobName).delete();
      //console.log("[moveAzureFolder] deleted ✓", oldBlobName);
    })
  );

  // 3️⃣ Ensure new folder has a marker if no real blobs were moved
  if (blobNames.length === 0) {
    await containerClient
      .getBlockBlobClient(`${newPrefix}placeholder.txt`)
      .upload("placeholder", 11);
  }

  // 4️⃣ Kill every possible marker variant on the OLD folder
  const markerCandidates = [
    oldPrefix,                    // "ample/"      ← slash marker
    oldFolderPath,                // "ample"       ← no-slash marker (likely culprit)
    `${oldPrefix}.keep`,          // "ample/.keep"
    `${oldPrefix}.gitkeep`,       // "ample/.gitkeep"
  ];

  await Promise.allSettled(
    markerCandidates.map(async (candidate) => {
      try {
        await containerClient.getBlobClient(candidate).delete();
        //console.log("[moveAzureFolder] deleted marker →", candidate);
      } catch {
        // not found — expected for most candidates
      }
    })
  );

  //console.log("[moveAzureFolder] all done ✓");
}

/**
async function moveAzureFolder(container, oldFolderPath, newFolderPath) {
  const containerClient = getContainerClient(container);
  const oldPrefix = ensureSlash(oldFolderPath);
  const newPrefix = ensureSlash(newFolderPath);
  const cleanSas = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;

  const blobNames = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
    if (!blob.name.endsWith("/")) blobNames.push(blob.name);
  }

  if (blobNames.length === 0) {
    await containerClient
      .getBlockBlobClient(`${newPrefix}placeholder.txt`)
      .upload("placeholder", 11);
    const err = new Error("LEGACY_FOLDER");
    err.newFolderCreated = true;
    throw err;
  }

  await Promise.all(
    blobNames.map(async (oldBlobName) => {
      const newBlobName = newPrefix + oldBlobName.slice(oldPrefix.length);
      const sourceUrl = `${baseUrl}/${container}/${oldBlobName
        .split("/").map(encodeURIComponent).join("/")}?${cleanSas}`;

      const destClient = containerClient.getBlockBlobClient(newBlobName);
      const poller = await destClient.beginCopyFromURL(sourceUrl);
      await poller.pollUntilDone();
      await containerClient.getBlobClient(oldBlobName).delete({ deleteSnapshots: "include" });
    })
  );
}
**/

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
  const renameFolderApi = useCallback(async (container, pathArr, oldName, newName) => {
    const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
    await moveAzureFolder(container, `${pathStr}${oldName}`, `${pathStr}${newName}`);
  }, []);
  
 /** 
  const renameFolderApi = useCallback(async (container, pathArr, oldName, newName) => {
	  const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
	  const oldPath = `${pathStr}${oldName}`;
	  const newPath = `${pathStr}${newName}`;
	  console.log("[renameFolderApi] →", { container, pathStr, oldPath, newPath });
	  await moveAzureFolder(container, oldPath, newPath);
	  console.log("[renameFolderApi] moveAzureFolder done ✓");
	}, []);
**/
  // ── hideFolderApi: toggles HIDDEN_PREFIX on the folder name ───────────────
  const hideFolderApi = useCallback(async (container, pathArr, name, targetName) => {
    const pathStr = pathArr.length ? pathArr.join("/") + "/" : "";
    await moveAzureFolder(container, `${pathStr}${name}`, `${pathStr}${targetName}`);
  }, []);

  const trashFolderApi = useCallback(async (container, pathArr, name) => {
	  const pathStr   = pathArr.length ? pathArr.join("/") + "/" : "";
	  const target    = `${TRASH_PREFIX}${name}`;
	  await moveAzureFolder(container, `${pathStr}${name}`, `${pathStr}${target}`);
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
	trashFolderApi,

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