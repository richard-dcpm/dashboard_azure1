import React, { useMemo, useState, useRef, useCallback } from "react";
import { Home as HomeIcon, Eye, EyeOff, Folder, ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";

const HIDDEN_PREFIX = ".hidden_";
const PAGE_SIZE     = 12;

const fmt = (bytes) => {
  if (!bytes || bytes < 1024)   return `${bytes ?? 0} B`;
  if (bytes < 1024 ** 2)        return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)        return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

// ── Recursively collect all files from a DataTransferItem entry ───────────────
const traverseFileTree = (item, path = "") =>
  new Promise((resolve) => {
    if (item.isFile) {
      item.file((file) => {
        const f = new File([file], file.name, { type: file.type });
        Object.defineProperty(f, "webkitRelativePath", {
          value: path + file.name, writable: false,
        });
        resolve([f]);
      });
    } else if (item.isDirectory) {
      const reader   = item.createReader();
      const allFiles = [];
      const read = () => {
        reader.readEntries((entries) => {
          if (!entries.length) { resolve(allFiles); return; }
          Promise.all(entries.map((e) => traverseFileTree(e, path + item.name + "/"))).then((r) => {
            allFiles.push(...r.flat());
            read(); // readEntries only returns ≤100 at a time
          });
        });
      };
      read();
    } else {
      resolve([]);
    }
  });

export default function UploaderLayout({
  containers = [],
  navigateToDashboard,
  enqueueFiles,
  listFolders,
  createFolderApi,
  renameFolderApi,
  hideFolderApi,
  queue          = [],
  globalProgress = {},
  retryItem,
  cancelItem,
}) {
  const [activeContainer,   setActiveContainer]   = useState(null);
  const [showHidden,        setShowHidden]         = useState(false);
  const [currentPath,       setCurrentPath]        = useState([]);
  const [folders,           setFolders]            = useState([]);
  const [loadingBlobs,      setLoadingBlobs]       = useState(false);
  const [toast,             setToast]              = useState(null);
  const [searchQuery,       setSearchQuery]        = useState("");
  const [page,              setPage]               = useState(1);
  const [isDragging,        setIsDragging]         = useState(false);
  const [progressExpanded,  setProgressExpanded]   = useState(false);

  const fileInputRef   = useRef(null); // files only
  const folderInputRef = useRef(null); // folders only (webkitdirectory)

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredFolders = useMemo(() => {
    let rows = folders;
    if (!showHidden) rows = rows.filter((n) => !n.startsWith(HIDDEN_PREFIX));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      rows = rows.filter((n) => n.toLowerCase().includes(q));
    }
    return rows;
  }, [folders, showHidden, searchQuery]);

  const totalPages       = Math.max(1, Math.ceil(filteredFolders.length / PAGE_SIZE));
  const paginatedFolders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredFolders.slice(start, start + PAGE_SIZE);
  }, [filteredFolders, page]);

  const basePath = currentPath.length ? currentPath.join("/") + "/" : "";

  const { uploadedSize = 0, totalSize = 0, uploadedCount = 0, totalCount = 0 } = globalProgress;
  const overallPct = totalSize > 0 ? Math.round((uploadedSize / totalSize) * 100) : 0;
  const allDone    = queue.length > 0 && queue.every((i) => i.status === "complete" || i.status === "failed" || i.status === "cancelled");
  const hasQueue   = queue.length > 0;

  // ── Toast ──────────────────────────────────────────────────────────────────
  const pushToast = (type, message, ttl = 2500) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), ttl);
  };

  // ── Loader ─────────────────────────────────────────────────────────────────
  const loadFolders = useCallback(async (container, pathArr) => {
    if (!container || typeof listFolders !== "function") return;
    setLoadingBlobs(true);
    try {
      const names = await listFolders(container, pathArr);
      setFolders(names.map((n) => n.replace(/\/$/, "")));
    } catch (err) {
      console.error("loadFolders:", err);
      pushToast("error", "Failed to load folders.");
    } finally {
      setLoadingBlobs(false);
    }
  }, [listFolders]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleContainerClick = async (name) => {
    setActiveContainer(name); setCurrentPath([]); setSearchQuery(""); setPage(1);
    await loadFolders(name, []);
  };

  const handleBreadcrumbClick = async (index) => {
    setPage(1);
    if (index === -1) { setActiveContainer(null); setCurrentPath([]); setFolders([]); return; }
    if (index === 0)  { setCurrentPath([]); await loadFolders(activeContainer, []); return; }
    const next = currentPath.slice(0, index);
    setCurrentPath(next);
    await loadFolders(activeContainer, next);
  };

  const handleFolderClick = async (name) => {
    const next = [...currentPath, name];
    setCurrentPath(next); setPage(1);
    await loadFolders(activeContainer, next);
  };

  // ── Folder CRUD ────────────────────────────────────────────────────────────
  const createFolder = async () => {
    const name = prompt("Enter folder name:");
    if (!name) return;
    const safe = name.trim().replace(/\s+/g, "_").replace(/[^\w\-.]/g, "");
    if (!safe) return;
    if (typeof createFolderApi !== "function") return pushToast("error", "createFolderApi not connected.");
    try {
      await createFolderApi(activeContainer, currentPath, safe);
      pushToast("success", `Folder "${safe}" created.`);
      await loadFolders(activeContainer, currentPath);
    } catch { pushToast("error", "Failed to create folder."); }
  };

/**
  const renameFolder = async (name) => {
    const newName = prompt("Enter new folder name:", name);
    if (!newName || newName === name) return;
    const safe = newName.trim().replace(/\s+/g, "_").replace(/[^\w\-.]/g, "");
    if (!safe) return;
    if (typeof renameFolderApi !== "function") return pushToast("error", "renameFolderApi not connected.");
    try {
      await renameFolderApi(activeContainer, currentPath, name, safe);
      pushToast("success", `Renamed "${name}" → "${safe}".`);
      await loadFolders(activeContainer, currentPath);
    } catch { pushToast("error", "Failed to rename folder."); }
  };
**/

const renameFolder = async (name) => {
  const newName = prompt("Enter new folder name:", name);
  console.log("[renameFolder] prompted →", { name, newName });
  if (!newName || newName === name) return console.log("[renameFolder] aborted — no change or cancelled");

  const safe = newName.trim().replace(/\s+/g, "_").replace(/[^\w\-.]/g, "");
  console.log("[renameFolder] sanitised name →", safe);
  if (!safe) return console.log("[renameFolder] aborted — sanitised name is empty");

  if (typeof renameFolderApi !== "function") return pushToast("error", "renameFolderApi not connected.");
  try {
    console.log("[renameFolder] calling renameFolderApi →", { activeContainer, currentPath, name, safe });
    await renameFolderApi(activeContainer, currentPath, name, safe);
    console.log("[renameFolder] renameFolderApi resolved ✓");
    pushToast("success", `Renamed "${name}" → "${safe}".`);
    await loadFolders(activeContainer, currentPath);
  } catch (err) {
    console.error("[renameFolder] caught error →", err);
    pushToast("error", "Failed to rename folder.");
  }
};

  const hideFolder = async (name) => {
    const isHidden = name.startsWith(HIDDEN_PREFIX);
    const target   = isHidden ? name.slice(HIDDEN_PREFIX.length) : `${HIDDEN_PREFIX}${name}`;
    if (!window.confirm(`${isHidden ? "Unhide" : "Hide"} "${name}"?`)) return;
    if (typeof hideFolderApi !== "function") return pushToast("error", "hideFolderApi not connected.");
    try {
      await hideFolderApi(activeContainer, currentPath, name, target);
      pushToast("success", `${isHidden ? "Unhidden" : "Hidden"} "${name}".`);
      await loadFolders(activeContainer, currentPath);
    } catch { pushToast("error", "Failed to toggle hidden state."); }
  };

  // ── Upload helpers ─────────────────────────────────────────────────────────
  const enqueue = (files) => {
    if (!activeContainer) return pushToast("error", "Select a container first.");
    if (typeof enqueueFiles !== "function") return pushToast("error", "enqueueFiles not connected.");
    enqueueFiles(files, activeContainer, basePath);
    pushToast("success", `${files.length} file(s) queued.`);
    setProgressExpanded(true);
  };

  // Drop: supports both files AND folders via DataTransferItem API
  const handleDrop = async (e) => {
    e.preventDefault(); setIsDragging(false);
    if (!activeContainer) return pushToast("error", "Select a container first.");

    const items = Array.from(e.dataTransfer.items ?? []);
    if (items.length && items[0].webkitGetAsEntry) {
      // Use entry API so dropped folders are traversed recursively
      const entries  = items.map((i) => i.webkitGetAsEntry()).filter(Boolean);
      const results  = await Promise.all(entries.map((entry) => traverseFileTree(entry)));
      const allFiles = results.flat();
      if (allFiles.length) enqueue(allFiles);
    } else {
      const files = Array.from(e.dataTransfer.files);
      if (files.length) enqueue(files);
    }
  };

  const handleFilePick = (e) => {
    const files = Array.from(e.target.files);
    if (files.length) enqueue(files);
    e.target.value = "";
  };

  const handleFolderPick = (e) => {
    const files = Array.from(e.target.files); // webkitRelativePath already set by browser
    if (files.length) enqueue(files);
    e.target.value = "";
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-fg/90">Azure Blob Uploader</h2>
        <div className="flex gap-2">
          {activeContainer && (
            <button onClick={() => setShowHidden((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80">
              {showHidden ? <Eye size={18} /> : <EyeOff size={18} />}
              <span>{showHidden ? "Hide Hidden" : "Show Hidden"}</span>
            </button>
          )}
          <button onClick={navigateToDashboard}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80">
            <HomeIcon size={18} />
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 text-white ${toast.type === "success" ? "bg-green-500" : "bg-red-500"}`}>
          {toast.message}
        </div>
      )}

      {/* Container picker */}
      {!activeContainer ? (
        <div className="grid grid-cols-5 gap-4">
          {containers.map((c) => (
            <button key={c} onClick={() => handleContainerClick(c)}
              className="p-6 rounded-lg bg-white/5 hover:bg-primary-600 transition text-fg/80 font-semibold capitalize">
              {c}
            </button>
          ))}
        </div>

      ) : (
        <>
          {/* ── Main grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left: Folder browser */}
            <div className="lg:col-span-2 glass-card p-6">
              {/* Breadcrumbs */}
              <div className="flex items-center text-sm mb-4 flex-wrap gap-2 text-fg/80">
                <span onClick={() => handleBreadcrumbClick(-1)} className="cursor-pointer text-primary-600 font-bold">Home</span>
                <span>/</span>
                <span onClick={() => handleBreadcrumbClick(0)} className="cursor-pointer text-primary-600 font-bold">{activeContainer}</span>
                {currentPath.map((seg, i) => (
                  <React.Fragment key={i}>
                    <span>/</span>
                    <span onClick={() => handleBreadcrumbClick(i + 1)} className="cursor-pointer">{seg}</span>
                  </React.Fragment>
                ))}
              </div>

              <div className="min-h-72 border border-glass-border rounded-lg p-3 bg-white/5">
                <div className="flex justify-between items-center mb-4">
                  <input type="text" placeholder="Search folders..." value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                    className="bg-white/5 border border-glass-border rounded p-2 text-sm w-1/2 text-fg" />
                  <button onClick={createFolder}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 transition">
                    + New Folder
                  </button>
                </div>

                {loadingBlobs ? (
                  <div className="text-center py-10 text-fg/50">Processing Azure request...</div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {paginatedFolders.map((name, idx) => {
                        const isHidden = name.startsWith(HIDDEN_PREFIX);
                        return (
                          <div key={`${name}-${idx}`}
                            className={`p-4 rounded-lg bg-white/5 border border-glass-border hover:bg-white/10 transition ${isHidden ? "opacity-40 border-dashed" : ""}`}>
                            <div onClick={() => handleFolderClick(name)} className="flex items-center cursor-pointer mb-3">
                              <Folder size={20} className={`mr-2 ${isHidden ? "text-gray-400" : "text-yellow-500"}`} />
                              <span className="font-semibold truncate text-fg/90">{name}</span>
                            </div>
                            <div className="flex gap-4 border-t border-white/10 pt-3">
                              <button onClick={() => renameFolder(name)} className="text-blue-800 text-xs font-bold hover:underline">RENAME</button>
                              <button onClick={() => hideFolder(name)} className="text-red-800 text-xs font-bold hover:underline">{isHidden ? "UNHIDE" : "HIDE"}</button>
                            </div>
                          </div>
                        );
                      })}
                      {filteredFolders.length === 0 && (
                        <div className="col-span-3 text-center py-10 text-fg/40">No folders found</div>
                      )}
                    </div>

                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-3 mt-4">
                        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1 rounded bg-white/10 disabled:opacity-40">Prev</button>
                        <span className="text-sm text-fg/70">Page {page} / {totalPages}</span>
                        <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-3 py-1 rounded bg-white/10 disabled:opacity-40">Next</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Right: Upload panel */}
            <div className="lg:col-span-1 glass-card p-6 flex flex-col gap-4">
              <h3 className="text-fg font-bold">Upload</h3>

              {/* Hidden inputs live outside the drop zone so closing their
                  dialogs doesn't bubble a click back into the div */}
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePick} />
              <input ref={folderInputRef} type="file" multiple className="hidden"
                {...{ webkitdirectory: "", directory: "" }}
                onChange={handleFolderPick}
              />

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition
                  ${isDragging ? "border-primary-500 bg-primary-500/10 text-fg/80" : "border-glass-border text-fg/40 hover:border-primary-500"}`}
              >
                {isDragging ? "Drop files or folders here!" : "Click or drag files / folders here"}
              </div>

              {/* Explicit "Upload Folder" button so users know it's supported */}
              <button
                onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 border border-glass-border rounded-lg text-sm text-fg/70 hover:bg-white/10 transition"
              >
                <Folder size={15} />
                Select Folder
              </button>

              <p className="text-xs text-fg/40 text-center">
                Target: <span className="text-fg/70 font-mono">{activeContainer}/{basePath || "root"}</span>
              </p>
            </div>
          </div>

          {/* ── Inline progress section (below grid) ── */}
          {hasQueue && (
            <div className="mt-4 glass-card border border-glass-border rounded-xl overflow-hidden">

              {/* Overall bar row — click to expand */}
              <button
                onClick={() => setProgressExpanded((v) => !v)}
                className="w-full flex items-center gap-4 px-5 py-3 bg-white/5 hover:bg-white/10 transition text-left"
              >
                <span className="text-sm font-semibold text-fg/80 shrink-0">
                  {allDone
                    ? `✓ All done (${totalCount})`
                    : `Uploading ${uploadedCount} / ${totalCount} files`}
                </span>
                <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${allDone ? "bg-green-500" : "bg-primary-500"}`}
                    style={{ width: `${overallPct}%` }}
                  />
                </div>
                <span className="text-xs text-fg/50 shrink-0 font-mono">
                  {fmt(uploadedSize)} / {fmt(totalSize)}
                </span>
                <span className={`text-sm font-bold shrink-0 ${allDone ? "text-green-400" : "text-primary-400"}`}>
                  {overallPct}%
                </span>
                {progressExpanded
                  ? <ChevronUp size={16} className="text-fg/40 shrink-0" />
                  : <ChevronDown size={16} className="text-fg/40 shrink-0" />}
              </button>

              {/* Per-file breakdown */}
              {progressExpanded && (
                <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto px-5 py-2">
                  {queue.map((item) => {
                    const pct       = Math.round(item.progress ?? 0);
                    const canCancel = item.status === "pending" || item.status === "uploading";
                    const canRetry  = item.status === "failed";

                    return (
                      <li key={item.id} className="py-2.5">
                        {/* File name + status + actions */}
                        <div className="flex justify-between items-center mb-1.5 gap-2">
                          <span className="text-xs text-fg/80 truncate font-mono min-w-0" title={item.blobPath}>
                            {item.name}
                          </span>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Status badge */}
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              item.status === "complete"   ? "bg-green-500/20 text-green-400"    :
                              item.status === "failed"     ? "bg-red-500/20 text-red-400"        :
                              item.status === "cancelled"  ? "bg-white/10 text-fg/40"            :
                              item.status === "uploading"  ? "bg-primary-500/20 text-primary-400" :
                              "bg-white/5 text-fg/40"
                            }`}>
                              {item.status === "uploading" ? `${pct}%`   :
                               item.status === "complete"  ? "Done"      :
                               item.status === "failed"    ? "Failed"    :
                               item.status === "cancelled" ? "Cancelled" : "Waiting"}
                            </span>

                            {/* Retry button — failed only */}
                            {canRetry && (
                              <button
                                onClick={() => retryItem?.(item.id)}
                                title="Retry"
                                className="p-1 rounded hover:bg-white/10 text-yellow-400 hover:text-yellow-300 transition"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}

                            {/* Cancel button — pending or uploading only */}
                            {canCancel && (
                              <button
                                onClick={() => cancelItem?.(item.id)}
                                title="Cancel"
                                className="p-1 rounded hover:bg-white/10 text-fg/40 hover:text-red-400 transition"
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Per-file bar */}
                        {(item.status === "uploading" || item.status === "complete") && (
                          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-200 ${item.status === "complete" ? "bg-green-500" : "bg-primary-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}

                        {/* Error detail */}
                        {item.status === "failed" && item.error && (
                          <p className="text-xs text-red-400 mt-1 truncate" title={item.error}>{item.error}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}