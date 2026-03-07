/**
 * UploadProgressModal
 *
 * Behaviour depends on current route:
 *  - /uploader  → returns null  (layout renders progress inline)
 *  - elsewhere  → slim floating bar at bottom-right showing overall %
 *                 auto-switches to a "Done" toast when all uploads finish,
 *                 then auto-dismisses after 4 s.
 */

import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useUploadQueue } from "./UploadQueueProvider";
import { X } from "lucide-react";

const fmt = (bytes) => {
  if (!bytes || bytes < 1024)    return `${bytes ?? 0} B`;
  if (bytes < 1024 ** 2)         return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)         return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

export default function UploadProgressModal() {
  const location = useLocation();
  const { queue, globalProgress, clearCompleted } = useUploadQueue();

  // "done" banner visibility — shown briefly after all uploads finish
  const [showDone, setShowDone] = useState(false);

  const onUploader = location.pathname === "/uploader";

  const { uploadedSize = 0, totalSize = 0, uploadedCount = 0, totalCount = 0 } = globalProgress;
  const overallPct = totalSize > 0 ? Math.round((uploadedSize / totalSize) * 100) : 0;

  const hasItems  = queue.length > 0;
  const allDone   = hasItems && queue.every((i) => i.status === "complete" || i.status === "failed");
  const hasActive = queue.some((i) => i.status === "pending" || i.status === "uploading");

  // Detect transition → all done, trigger banner then auto-clear
  useEffect(() => {
    if (allDone && !onUploader) {
      setShowDone(true);
      const t = setTimeout(() => {
        setShowDone(false);
        clearCompleted();
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [allDone, onUploader]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to show while on the uploader page (layout handles it)
  if (onUploader) return null;

  // Nothing to show when queue is empty and done banner is gone
  if (!hasItems && !showDone) return null;

  // ── "All done" toast ───────────────────────────────────────────────────────
  if (showDone) {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl bg-green-600 text-white">
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <div>
          <p className="text-sm font-semibold">Upload complete</p>
          <p className="text-xs opacity-80">{totalCount} file{totalCount !== 1 ? "s" : ""} uploaded successfully</p>
        </div>
        <button
          onClick={() => { setShowDone(false); clearCompleted(); }}
          className="ml-2 opacity-70 hover:opacity-100 transition"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  // ── Slim progress bar (active uploads, not on /uploader) ──────────────────
  if (!hasActive && !hasItems) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72 rounded-xl shadow-2xl bg-surface border border-glass-border overflow-hidden">

      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-glass-border">
        <span className="text-xs font-semibold text-fg/80">
          Uploading {uploadedCount} / {totalCount} files
        </span>
        <span className="text-xs text-fg/50">{fmt(uploadedSize)} / {fmt(totalSize)}</span>
      </div>

      {/* Single overall bar */}
      <div className="px-4 py-3">
        <div className="flex justify-between text-xs text-fg/50 mb-1.5">
          <span>Overall progress</span>
          <span className="font-semibold text-primary-400">{overallPct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary-500 transition-all duration-300"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

    </div>
  );
}