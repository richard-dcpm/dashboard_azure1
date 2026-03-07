import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { getBlockBlobClient } from "../azureBlob";

const UploadQueueContext = createContext(undefined);

const CHUNK_SIZE      = 4 * 1024 * 1024;
const MAX_CONCURRENCY = 3;

const normalizePath = (p) => p.replace(/\\/g, "/");

async function uploadFileChunked(fileItem, updateQueueItem, abortSignal) {
  const { file, container, blobPath, id } = fileItem;
  try {
    updateQueueItem(id, { status: "uploading", totalChunks: Math.ceil(file.size / CHUNK_SIZE) });

    const blobClient = getBlockBlobClient(container, blobPath);
    await blobClient.uploadData(file, {
      blockSize:    CHUNK_SIZE,
      concurrency:  MAX_CONCURRENCY,
      abortSignal,                          // ← honours cancel
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
  } catch (err) {
    // AbortError means the user cancelled — don't mark as failed
    if (err.name === "AbortError" || err.code === "REQUEST_SEND_ERROR") {
      updateQueueItem(id, { status: "cancelled", progress: 0, uploadedBytes: 0 });
    } else {
      console.error(`Upload failed for ${file.name}:`, err);
      updateQueueItem(id, { status: "failed", error: err.message });
    }
    return false;
  }
}

export default function UploadQueueProvider({ children }) {
  const [queue, setQueue]                   = useState([]);
  const [globalProgress, setGlobalProgress] = useState({
    uploadedCount: 0, totalCount: 0, totalSize: 0, uploadedSize: 0,
  });
  const abortControllers = useRef({}); // id → AbortController

  // ── Modal state ────────────────────────────────────────────────────────────
  const [isModalOpen,      setIsModalOpen]      = useState(false);
  const [isModalMinimized, setIsModalMinimized] = useState(false);

  const openModal     = useCallback(() => { setIsModalOpen(true);  setIsModalMinimized(false); }, []);
  const minimizeModal = useCallback(() => setIsModalMinimized(true),  []);
  const restoreModal  = useCallback(() => setIsModalMinimized(false), []);
  const closeModal    = useCallback(() => setIsModalOpen(false),      []);

  useEffect(() => {
    const hasActive = queue.some((i) => i.status === "pending" || i.status === "uploading");
    if (hasActive) setIsModalOpen(true);
  }, [queue]);

  // ── Nav history ────────────────────────────────────────────────────────────
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
    const idx = navIndex - 1; setNavIndex(idx); return navHistory[idx] || null;
  }, [canGoBack, navIndex, navHistory]);

  const goForward = useCallback(() => {
    if (!canGoForward) return null;
    const idx = navIndex + 1; setNavIndex(idx); return navHistory[idx] || null;
  }, [canGoForward, navIndex, navHistory]);

  const getCurrentEntry = useCallback(
    () => navHistory[navIndex] || { container: null, path: [] },
    [navHistory, navIndex]
  );

  // ── Queue helpers ──────────────────────────────────────────────────────────
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
    setQueue((prev) => prev.filter((i) => i.status !== "complete" && i.status !== "failed" && i.status !== "cancelled"));
  }, []);

  // ── Retry: reset failed item back to pending ───────────────────────────────
  const retryItem = useCallback((id) => {
    setQueue((prev) => prev.map((i) =>
      i.id === id
        ? { ...i, status: "pending", progress: 0, uploadedBytes: 0, error: null, currentChunk: 0 }
        : i
    ));
  }, []);

  // ── Cancel: abort in-flight or drop pending item ───────────────────────────
  const cancelItem = useCallback((id) => {
    abortControllers.current[id]?.abort();
    delete abortControllers.current[id];
    setQueue((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // ── Background workers ─────────────────────────────────────────────────────
  useEffect(() => {
    const pending   = queue.filter((i) => i.status === "pending");
    const uploading = queue.filter((i) => i.status === "uploading");
    const slots     = Math.max(0, MAX_CONCURRENCY - uploading.length);
    if (!pending.length || !slots) return;

    pending.slice(0, slots).forEach((item) => {
      const controller = new AbortController();
      abortControllers.current[item.id] = controller;
      updateQueueItem(item.id, { status: "uploading" });
      uploadFileChunked(item, updateQueueItem, controller.signal).then(() => {
        delete abortControllers.current[item.id];
      });
    });
  }, [queue, updateQueueItem]);

  const contextValue = {
    queue, enqueueFiles, clearCompleted, retryItem, cancelItem,
    globalProgress,
    navHistory, navIndex, canGoBack, canGoForward,
    pushHistory, goBack, goForward, getCurrentEntry,
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