import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { getBlockBlobClient } from "../azureBlob";

const UploadQueueContext = createContext(undefined);

const CHUNK_SIZE     = 4 * 1024 * 1024; // 4 MB
const MAX_CONCURRENCY = 3;

const normalizePath = (path) => path.replace(/\\/g, "/");

async function uploadFileChunked(fileItem, updateQueueItem) {
  const { file, container, blobPath, id } = fileItem;
  try {
    updateQueueItem(id, { status: "uploading", totalChunks: Math.ceil(file.size / CHUNK_SIZE) });

    const blobClient = getBlockBlobClient(container, blobPath);
    await blobClient.uploadData(file, {
      blockSize: CHUNK_SIZE,
      concurrency: MAX_CONCURRENCY,
      blobHTTPHeaders: { blobContentType: file.type || "application/octet-stream" },
      onProgress: ({ loadedBytes }) => {
        updateQueueItem(id, {
          progress:      (loadedBytes / file.size) * 100,
          uploadedBytes: loadedBytes,
          currentChunk:  Math.ceil(loadedBytes / CHUNK_SIZE),
        });
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
  const [queue, setQueue]               = useState([]);
  const [globalProgress, setGlobalProgress] = useState({
    uploadedCount: 0, totalCount: 0, totalSize: 0, uploadedSize: 0,
  });

  // ── Modal visibility ───────────────────────────────────────────────────────
  // The floating progress modal: auto-shows when uploads are active,
  // can be minimized by the user, resets when all uploads finish.
  const [isModalOpen,      setIsModalOpen]      = useState(false);
  const [isModalMinimized, setIsModalMinimized] = useState(false);

  const openModal      = useCallback(() => { setIsModalOpen(true);  setIsModalMinimized(false); }, []);
  const minimizeModal  = useCallback(() => setIsModalMinimized(true),  []);
  const restoreModal   = useCallback(() => setIsModalMinimized(false), []);
  const closeModal     = useCallback(() => setIsModalOpen(false),      []);

  // Auto-open when a new upload starts; auto-close when queue is empty/all done.
  useEffect(() => {
    const hasActive = queue.some((i) => i.status === "pending" || i.status === "uploading");
    if (hasActive) {
      setIsModalOpen(true);
    } else if (queue.length > 0 && queue.every((i) => i.status === "complete" || i.status === "failed")) {
      // All finished — keep modal open so the user can see the result, but allow manual close.
    }
  }, [queue]);

  // ── Navigation history ─────────────────────────────────────────────────────
  const [navHistory, setNavHistory] = useState([{ container: null, path: [] }]);
  const [navIndex,   setNavIndex]   = useState(0);
  const canGoBack    = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const pushHistory = useCallback((container, pathArr) => {
    setNavHistory((prev) => {
      const next = prev.slice(0, navIndex + 1);
      next.push({ container, path: [...pathArr] });
      return next;
    });
    setNavIndex((i) => i + 1);
  }, [navIndex]);

  const goBack = useCallback(() => {
    if (!canGoBack) return null;
    const idx = navIndex - 1;
    setNavIndex(idx);
    return navHistory[idx] || null;
  }, [canGoBack, navIndex, navHistory]);

  const goForward = useCallback(() => {
    if (!canGoForward) return null;
    const idx = navIndex + 1;
    setNavIndex(idx);
    return navHistory[idx] || null;
  }, [canGoForward, navIndex, navHistory]);

  const getCurrentEntry = useCallback(
    () => navHistory[navIndex] || { container: null, path: [] },
    [navHistory, navIndex]
  );

  // ── Queue operations ───────────────────────────────────────────────────────
  const updateQueueItem = useCallback((id, updates) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  useEffect(() => {
    const totalSize     = queue.reduce((s, i) => s + (i.size || 0), 0);
    const uploadedCount = queue.filter((i) => i.status === "complete").length;
    const uploadedSize  = queue.reduce((s, i) => s + (i.uploadedBytes || 0), 0);
    setGlobalProgress({ totalCount: queue.length, uploadedCount, totalSize, uploadedSize });
  }, [queue]);

  const enqueueFiles = useCallback((filesToAdd, container, basePath) => {
    const newItems = filesToAdd.map((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const blobPath     = (basePath || "") + normalizePath(relativePath);
      return {
        id: uuidv4(), file, container, blobPath,
        name: file.name, size: file.size,
        status: "pending", progress: 0, uploadedBytes: 0,
        error: null, currentChunk: 0, totalChunks: 0,
      };
    });
    setQueue((prev) => [...prev, ...newItems]);
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((i) => i.status !== "complete" && i.status !== "failed"));
  }, []);

  // ── Background workers ─────────────────────────────────────────────────────
  useEffect(() => {
    const pending   = queue.filter((i) => i.status === "pending");
    const uploading = queue.filter((i) => i.status === "uploading");
    const slots     = Math.max(0, MAX_CONCURRENCY - uploading.length);
    if (!pending.length || !slots) return;

    pending.slice(0, slots).forEach((item) => {
      updateQueueItem(item.id, { status: "uploading" });
      uploadFileChunked(item, updateQueueItem);
    });
  }, [queue, updateQueueItem]);

  const contextValue = {
    queue, enqueueFiles, clearCompleted,
    globalProgress,
    navHistory, navIndex, canGoBack, canGoForward,
    pushHistory, goBack, goForward, getCurrentEntry,
    // modal
    isModalOpen, isModalMinimized,
    openModal, minimizeModal, restoreModal, closeModal,
  };

  return (
    <UploadQueueContext.Provider value={contextValue}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export const useUploadQueue = () => {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error("useUploadQueue must be used within an UploadQueueProvider");
  return ctx;
};