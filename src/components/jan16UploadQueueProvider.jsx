
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { getBlockBlobClient } from "../azureBlob";

const UploadQueueContext = createContext(undefined);

// Upload tuning
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
const MAX_CONCURRENCY = 3;

// Normalize path separators for blob keys
const normalizePath = (path) => path.replace(/\\/g, "/");

async function uploadFileChunked(fileItem, updateQueueItem) {
  const { file, container, blobPath, id } = fileItem;

  try {
    updateQueueItem(id, {
      status: "uploading",
      totalChunks: Math.ceil(file.size / CHUNK_SIZE),
    });

    const blobClient = getBlockBlobClient(container, blobPath);

    await blobClient.uploadData(file, {
      blockSize: CHUNK_SIZE,
      concurrency: MAX_CONCURRENCY,
      blobHTTPHeaders: { blobContentType: file.type || "application/octet-stream" },
      onProgress: ({ loadedBytes }) => {
        const progress = (loadedBytes / file.size) * 100;
        const currentChunk = Math.ceil(loadedBytes / CHUNK_SIZE);
        updateQueueItem(id, { progress, uploadedBytes: loadedBytes, currentChunk });
      },
    });

    updateQueueItem(id, { status: "complete", progress: 100 });
    return true;
  } catch (error) {
    console.error(`Upload failed for ${file.name}:`, error);
    updateQueueItem(id, { status: "failed", error: error.message });
    return false;
  }
}

export default function UploadQueueProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [globalProgress, setGlobalProgress] = useState({
    uploadedCount: 0,
    totalCount: 0,
    totalSize: 0,
    uploadedSize: 0,
  });

  // Navigation history for containers/paths
  const [navHistory, setNavHistory] = useState([{ container: null, path: [] }]);
  const [navIndex, setNavIndex] = useState(0);
  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const pushHistory = useCallback(
    (container, pathArr) => {
      setNavHistory((prev) => {
        const next = prev.slice(0, navIndex + 1);
        next.push({ container, path: [...pathArr] });
        return next;
      });
      setNavIndex((i) => i + 1);
    },
    [navIndex]
  );

  const goBack = useCallback(() => {
    if (!canGoBack) return null;
    const nextIndex = navIndex - 1;
    setNavIndex(nextIndex);
    return navHistory[nextIndex] || null;
  }, [canGoBack, navIndex, navHistory]);

  const goForward = useCallback(() => {
    if (!canGoForward) return null;
    const nextIndex = navIndex + 1;
    setNavIndex(nextIndex);
    return navHistory[nextIndex] || null;
  }, [canGoForward, navIndex, navHistory]);

  const getCurrentEntry = useCallback(
    () => navHistory[navIndex] || { container: null, path: [] },
    [navHistory, navIndex]
  );

  const updateQueueItem = useCallback((id, updates) => {
    setQueue((prevQueue) => prevQueue.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  // Global summary
  useEffect(() => {
    const totalSize = queue.reduce((sum, item) => sum + (item.size || 0), 0);
    const uploadedCount = queue.filter((item) => item.status === "complete").length;
    const uploadedSize = queue.reduce((sum, item) => sum + (item.uploadedBytes || 0), 0);
    setGlobalProgress({ totalCount: queue.length, uploadedCount, totalSize, uploadedSize });
  }, [queue]);

  // Enqueue files
  const enqueueFiles = useCallback((filesToAdd, container, basePath) => {
    const newItems = filesToAdd.map((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const blobPath = (basePath || "") + normalizePath(relativePath);
      return {
        id: uuidv4(),
        file,
        container,
        blobPath,
        name: file.name,
        size: file.size,
        status: "pending",
        progress: 0,
        uploadedBytes: 0,
        error: null,
        currentChunk: 0,
        totalChunks: 0,
      };
    });
    setQueue((prev) => [...prev, ...newItems]);
  }, []);

  // Background workers
  useEffect(() => {
    const pending = queue.filter((i) => i.status === "pending");
    const uploading = queue.filter((i) => i.status === "uploading");

    const slots = Math.max(0, MAX_CONCURRENCY - uploading.length);
    if (pending.length === 0 || slots === 0) return;

    pending.slice(0, slots).forEach((item) => {
      updateQueueItem(item.id, { status: "uploading" });
      uploadFileChunked(item, updateQueueItem);
    });
  }, [queue, updateQueueItem]);

  const contextValue = {
    queue,
    enqueueFiles,
    globalProgress,
    navHistory,
    navIndex,
    canGoBack,
    canGoForward,
    pushHistory,
    goBack,
    goForward,
    getCurrentEntry,
  };

  return <UploadQueueContext.Provider value={contextValue}>{children}</UploadQueueContext.Provider>;
}

// ✅ Stable hook export (prevents HMR “incompatible export”)
export const useUploadQueue = () => {
  const context = useContext(UploadQueueContext);
  if (context === undefined) {
    throw new Error("useUploadQueue must be used within an UploadQueueProvider");
  }
  return context;
};
