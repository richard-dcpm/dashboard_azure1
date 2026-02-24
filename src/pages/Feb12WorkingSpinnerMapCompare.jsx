import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CONTAINER_OPTIONS, DEFAULT_CENTER, DEFAULT_ZOOM } from "./constants";
import { extractGpsFromFile, extractGpsFromUrl, parseLatLonFromName } from "./exifService";
import { useLeafletMap } from "./useLeafletMap";
import { listByHierarchy, uploadFilesWithSAS, listContainers } from "./blobService";
import { searchContainers } from "./containerSearchUtil";

/* ------------------------------------------------------------- */
/* Performance Utilities - Moved outside component */
/* ------------------------------------------------------------- */

const gpsCache = new Map();

const processInBatches = async (items, batchSize, worker, onBatch) => {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const chunk = await Promise.all(slice.map(worker));
    out.push(...chunk.filter(Boolean));
    onBatch?.(out.slice());
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
};

function MapProgressOverlay({ show = false, percent = 0, label = "Loading map…" }) {
  if (!show) return null;
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
      style={{
        zIndex: 9999,
        background: "linear-gradient(to bottom right, rgba(255,255,255,0.95), rgba(255,255,255,0.85))",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-8 border-2 border-blue-200">
        <div className="mb-4 flex justify-center">
          <svg className="animate-spin h-12 w-12 text-blue-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
        </div>
        <div className="text-base font-semibold text-gray-800 mb-3 text-center">{label}</div>
        <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
            style={{ width: `${Math.max(0, Math.min(100, Math.round(percent)))}%` }}
          />
        </div>
        <div className="mt-2 text-sm font-medium text-gray-700 text-center">{Math.round(percent)}%</div>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------- */
/* Inline UI Components */
/* ------------------------------------------------------------- */
function GoldFolderIcon({ className = "w-5 h-5" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-folder-text-yellow-4 ${className}`}
      aria-hidden="true"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.6-.8L9.6 3.9A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function GoldOpenFolderIcon({ className = "w-5 h-5" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-folder-open-text-yellow-4 ${className}`}
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2" />
      <path d="M3 11h18l-1.5 6.2A2 2 0 0 1 17.55 19H6.45a2 2 0 0 1-1.95-1.8L3 11Z" />
    </svg>
  );
}

function DatabaseIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3"></ellipse>
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path>
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>
    </svg>
  );
}

function FileExplorerModal({
  open,
  onClose,
  side,
  baseUrl,
  sasToken,
  initialContainer,
  initialPathSegments = [],
  fallbackContainers = [],
  onSelectContainer,
  onSelectFile,
  onSelectFiles,
}) {
  const [containers, setContainers] = React.useState([]);
  const [loadingContainers, setLoadingContainers] = React.useState(false);
  const [container, setContainer] = React.useState(initialContainer || "");
  const [path, setPath] = React.useState(initialPathSegments || []);
  const [loading, setLoading] = React.useState(false);
  const [folders, setFolders] = React.useState([]);
  const [files, setFiles] = React.useState([]);
  const [view, setView] = React.useState("grid");
  const [query, setQuery] = React.useState("");
  const [selectedUrls, setSelectedUrls] = React.useState(() => new Set());
  const [containerQuery, setContainerQuery] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const orderContainers = (names, allowed) => {
      const allowedSet = new Set((allowed || []).map((n) => n.toLowerCase()));
      const filtered = (names || []).filter((n) => allowedSet.has(n.toLowerCase()));
      const orderIndex = new Map(["raw", "processed", "projects", "uploads", "issued"].map((n, i) => [n, i]));
      return filtered.sort(
        (a, b) => (orderIndex.get(a.toLowerCase()) ?? 999) - (orderIndex.get(b.toLowerCase()) ?? 999)
      );
    };

    (async () => {
      setLoadingContainers(true);
      try {
        const names = await listContainers(baseUrl, sasToken);
        const ordered = orderContainers(names, fallbackContainers);
        if (!cancelled) setContainers(ordered);
      } catch (e) {
        const ordered = orderContainers(fallbackContainers || [], fallbackContainers || []);
        if (!cancelled) setContainers(ordered);
      } finally {
        if (!cancelled) setLoadingContainers(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, sasToken, fallbackContainers]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const prefixOf = (segments) => (segments.length ? segments.join("/") + "/" : "");

  const loadLevel = React.useCallback(
    async (currContainer, currPath) => {
      if (!currContainer) return;
      setLoading(true);
      try {
        const { folders, files: rawFiles } = await listByHierarchy({
          baseUrl,
          container: currContainer,
          sasToken,
          prefix: prefixOf(currPath),
        });
        const imageFiles = rawFiles.filter((f) => (f.contentType || "").startsWith("image/"));
        setFolders(folders);
        setFiles(imageFiles);
      } catch (e) {
        setFolders([]);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, sasToken]
  );

  React.useEffect(() => {
    if (!open) return;
    if (container) loadLevel(container, path);
  }, [open, container, path, loadLevel]);

    React.useEffect(() => {
	  if (!open) return;
	  setContainer(initialContainer || "");
	  setPath(initialPathSegments || []);
	  setQuery("");
	  setContainerQuery("");  // ✅ ADD THIS LINE
	  setSelectedUrls(new Set());
	}, [open, initialContainer, initialPathSegments]);
	
  const onPickContainer = (name) => {
    setFolders([]);
    setFiles([]);
    setQuery("");
    setSelectedUrls(new Set());
    setContainer(name);
    setPath([]);
    onSelectContainer?.(name);
  };

  const onOpenFolder = (apiPrefix) => {
    const last = apiPrefix.replace(/\/$/, "").split("/").pop();
    setPath((prev) => [...prev, last]);
  };

  const onCrumbClick = (idx) => {
    setPath((prev) => (idx >= 0 ? prev.slice(0, idx + 1) : []));
  };

  const toggleSelected = (file) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(file.url)) next.delete(file.url);
      else next.add(file.url);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedUrls(new Set(filteredFiles.map((f) => f.url)));
  };

  const clearSelection = () => {
    setSelectedUrls(new Set());
  };

  const doneSelection = () => {
    const selected = files.filter((f) => selectedUrls.has(f.url));
    onSelectFiles?.(selected);
    onClose?.();
  };


  const filteredFolders = folders
    .map((f) => (f.endsWith("/") ? f.slice(0, -1) : f))
    .filter((name) => name.toLowerCase().includes(query.toLowerCase()));

  const filteredFiles = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));
  const hasImages = !loading && filteredFiles.length > 0;

  if (!open) return null;

  return (
    <div className="mt-4 relative">
        <div className="mt-4 relative z-50">
          <div className="relative w-full rounded-xl backdrop-blur-xl bg-white/30 shadow-2xl border border-white/20 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/20 bg-white/10">
              <div className="flex items-center gap-2 text-gray-800 font-semibold">
                <DatabaseIcon />
                <span>Blob Explorer — {side === "left" ? "Left" : "Right"}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView("grid")}
                  className={`px-2 py-1 rounded border ${
                    view === "grid"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300"
                  }`}
                >
                  Grid
                </button>
                <button
                  onClick={() => setView("list")}
                  className={`px-2 py-1 rounded border ${
                    view === "list"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300"
                  }`}
                >
                  List
                </button>
                <button onClick={onClose} className="px-3 py-1 rounded border border-gray-300 bg-white text-black hover:bg-gray-200 hover:text-black">
                  Close
                </button>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-white/20 bg-white/5">
              <div className="flex items-center gap-2 flex-wrap">
               
				  {loadingContainers ? (
					  <span className="text-gray-500">Loading containers…</span>
					) : (
					  searchContainers(
						containers?.length ? containers : fallbackContainers,
						containerQuery
					  ).map((c) => (
                    <button
                      key={c}
                      onClick={() => onPickContainer(c)}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                        c === container
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-gray-300 bg-white hover:bg-gray-50 text-gray-800"
                      }`}
                    >
                      <DatabaseIcon className="w-4 h-4" />
                      <span className="text-sm">{c}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <div className="text-sm text-gray-600">Path:</div>
                <button className="text-blue-600 hover:underline" onClick={() => onCrumbClick(-1)}>
                  Root
                </button>
                {path.map((seg, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-gray-400">/</span>
                    <button className="text-blue-600 hover:underline" onClick={() => onCrumbClick(idx)}>
                      {seg}
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3">
				  <input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Filter folders/files…"
					className="w-full px-3 py-2 text-black rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
				  />
				</div>
            </div>

            <div className="p-4">
              {loading ? (
                <div className="text-gray-500">Loading…</div>
              ) : (
                <>
                  <div className="mb-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">Folders</div>
                    <div
                      className={
                        view === "grid"
                          ? "grid grid-cols-3 gap-3 max-h-[420px] overflow-auto"
                          : "divide-y rounded-lg border border-gray-200 max-h-[280px] overflow-auto"
                      }
                    >
                      {filteredFolders.map((full) => {
                        const name = full.split("/").filter(Boolean).pop();
                        return (
                          <button
                            key={full}
                            onClick={() => onOpenFolder(full + "/")}
                            className={
                              view === "grid"
                                ? "group flex flex-col items-start gap-2 p-3 rounded-lg border border-gray-200 bg-white hover:shadow text-left"
                                : "w-full flex items-center gap-3 px-3 py-3 hover:bg-gray-50 text-left"
                            }
                          >
                            <GoldFolderIcon className="w-6 h-6 text-[#D4AF37]" />
                            <div className="text-sm font-medium text-gray-800 truncate w-full">{name}</div>
                          </button>
                        );
                      })}
                      {filteredFolders.length === 0 && <div className="p-3 text-gray-500">No folders</div>}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700 mb-2">Images</div>

                    {hasImages && (
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          onClick={selectAllVisible}
                          className="px-2 py-1 rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        >
                          Select All
                        </button>
                        <button
                          onClick={clearSelection}
                          className="px-2 py-1 rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        >
                          Clear
                        </button>
                        <button
                          onClick={doneSelection}
                          disabled={selectedUrls.size === 0}
                          className={`px-2 py-1 rounded border ${
                            selectedUrls.size === 0 ? "bg-gray-200 text-gray-400" : "bg-blue-600 text-white"
                          }`}
                        >
                          Done ({selectedUrls.size})
                        </button>
                      </div>
                    )}

                    <div
                      className={
                        view === "grid"
                          ? "grid grid-cols-3 gap-3 max-h-[420px] overflow-auto"
                          : "divide-y rounded-lg border border-gray-200 max-h-[280px] overflow-auto"
                      }
                    >
                      {filteredFiles.map((file) => {
                        const isSelected = selectedUrls.has(file.url);
                        return (
                          <button
                            key={file.url}
                            onClick={() => toggleSelected(file)}
                            className={
                              view === "grid"
                                ? `relative group p-2 rounded-lg border text-left transition ${
                                    isSelected ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white"
                                  }`
                                : `w-full flex items-center gap-3 px-3 py-3 text-left ${
                                    isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                                  }`
                            }
                          >
                            <div
                              className={`w-5 h-5 rounded border flex items-center justify-center ${
                                isSelected ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300"
                              }`}
                            >
                              {isSelected && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                              )}
                            </div>

                            <div
                              className={
                                view === "grid"
                                  ? "w-full aspect-[4/3] bg-gray-100 rounded overflow-hidden mb-2"
                                  : "w-16 h-12 rounded overflow-hidden bg-gray-100"
                              }
                            >
                              <img src={file.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>

                            <div className="text-sm font-medium text-gray-800 truncate flex-1">{file.name}</div>
                          </button>
                        );
                      })}
                      {filteredFiles.length === 0 && <div className="p-3 text-gray-500">No images</div>}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
    </div>
  );
}

function Breadcrumbs({ pathSegments, onCrumbClick }) {
  if (!pathSegments || pathSegments.length === 0) return null;
  return (
    <nav className="flex items-center gap-2 text-sm text-gray-600" aria-label="Breadcrumb">
      {pathSegments.map((seg, idx) => (
        <span key={`${seg}-${idx}`} className="flex items-center gap-1">
          {idx > 0 && <span className="mx-1 text-gray-300">/</span>}
          <button
            type="button"
            onClick={() => onCrumbClick(idx)}
            className="inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-gray-100 text-gray-700"
          >
            <GoldFolderIcon className="w-4 h-4" />
            {seg}
          </button>
        </span>
      ))}
    </nav>
  );
}

function FolderBrowser({ folders, files, onOpenFolder, onSelectFile }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {folders.map((f) => {
        const name = f.endsWith("/") ? f.slice(0, -1) : f;
        const last = name.split("/").filter(Boolean).pop();
        return (
          <button
            key={f}
            onClick={() => onOpenFolder(f)}
            className="group flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:shadow text-left"
          >
            <div className="w-9 h-9 rounded bg-blue-50 flex items-center justify-center text-blue-600">📁</div>
            <div className="truncate">
              <div className="text-sm font-medium text-gray-900 truncate">{last}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FilePicker({ multiple = true, onFiles }) {
  const inputRef = useRef(null);
  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => onFiles(Array.from(e.target.files || []))}
      />
      <button className="px-4 py-2 rounded-lg bg-blue-600 text-white shadow hover:bg-blue-700" onClick={() => inputRef.current?.click()}>
        Choose image{multiple ? "s" : ""}
      </button>
    </div>
  );
}

function ThumbnailStrip({ images, currentIndex, onSelect, onPrev, onNext }) {
  const scrollRef = useRef(null);
  if (!images || images.length === 0) return null;
  return (
    <div className="relative mt-3 bg-white/5 rounded-lg p-2 border border-white/20">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1" ref={scrollRef}>
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(idx)}
              className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition ${
                idx === currentIndex ? "border-blue-500 ring-2 ring-blue-300" : "border-white/20 hover:border-white/40"
              }`}
            >
              <img src={img.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      </div>
      <div className="text-center text-xs text-white/60 mt-2">
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );
}

function normalizePos(gps) {
  if (!gps) return null;

  const lat = gps.lat ?? gps.latitude;
  const lon = gps.lon ?? gps.lng ?? gps.longitude;

  if (typeof lat === "number" && typeof lon === "number") return { lat, lon };
  return null;
}

/* ------------------------------------------------------------- */
/* Main Component */
/* ------------------------------------------------------------- */
export default function MapCompare() {
  const navigate = useNavigate();
  const storageAccountName = import.meta.env.VITE_STORAGE_ACCOUNT_NAME || "dcpmcloudstorage";
  const sasToken = import.meta.env.VITE_ACCOUNT_SAS_TOKEN;
  const baseUrl = `https://${storageAccountName}.blob.core.windows.net`;

  const [showRightPanel, setShowRightPanel] = useState(false);

  const [leftSource, setLeftSource] = useState("blob");
  const [rightSource, setRightSource] = useState("upload");
  const [leftUploads, setLeftUploads] = useState([]);
  const [rightUploads, setRightUploads] = useState([]);
  const [leftUploadIndex, setLeftUploadIndex] = useState(0);
  const [rightUploadIndex, setRightUploadIndex] = useState(0);
  const [leftExplorerOpen, setLeftExplorerOpen] = useState(false);
  const [rightExplorerOpen, setRightExplorerOpen] = useState(false);

  const [leftUploadMarkers, setLeftUploadMarkers] = useState([]);
  const [rightUploadMarkers, setRightUploadMarkers] = useState([]);

  const initBlob = {
    container: CONTAINER_OPTIONS[0],
    pathSegments: [],
    folders: [],
    files: [],
    selectedFile: null,
    selectedFiles: [],
    selectedIndex: 0,
    loading: false,
  };

  const [leftBlob, setLeftBlob] = useState({ ...initBlob });
  const [rightBlob, setRightBlob] = useState({ ...initBlob });
  const [leftBlobMarkers, setLeftBlobMarkers] = useState([]);
  const [rightBlobMarkers, setRightBlobMarkers] = useState([]);
  const [leftGps, setLeftGps] = useState(null);
  const [rightGps, setRightGps] = useState(null);

  // ✅ NEW: Map loading states for progress indicators
  const [leftMapLoading, setLeftMapLoading] = useState(false);
  const [rightMapLoading, setRightMapLoading] = useState(false);
  const [leftMapProgress, setLeftMapProgress] = useState(0);
  const [rightMapProgress, setRightMapProgress] = useState(0);

  const leftMapRef = useRef(null);
  const rightMapRef = useRef(null);
  
  const hiddenRightMapRef = useRef(null);
  
  const isSyncingRef = useRef(false);
  const leftMap = useLeafletMap(leftMapRef, DEFAULT_CENTER, DEFAULT_ZOOM);
  const rightMap = useLeafletMap(
	  showRightPanel ? rightMapRef : hiddenRightMapRef,
	  DEFAULT_CENTER,
	  DEFAULT_ZOOM
	);
	
  const leftSelectedUrl =
    leftSource === "upload"
      ? leftUploads[leftUploadIndex]
        ? URL.createObjectURL(leftUploads[leftUploadIndex])
        : ""
      : leftBlob.files[leftBlob.selectedIndex]?.url || "";

  const rightSelectedUrl =
    rightSource === "upload"
      ? rightUploads[rightUploadIndex]
        ? URL.createObjectURL(rightUploads[rightUploadIndex])
        : ""
      : rightBlob.files[rightBlob.selectedIndex]?.url || "";

  const leftName = leftSource === "upload" ? leftUploads[leftUploadIndex]?.name || "" : leftBlob.files[leftBlob.selectedIndex]?.name || "";
  const rightName = rightSource === "upload" ? rightUploads[rightUploadIndex]?.name || "" : rightBlob.files[rightBlob.selectedIndex]?.name || "";

  const leftMarkerPos = normalizePos(leftGps) || normalizePos(parseLatLonFromName(leftName));
  const rightMarkerPos = normalizePos(rightGps) || normalizePos(parseLatLonFromName(rightName));

  const loadSide = async (side) => {
  const isLeft = side === "left";
  const state = isLeft ? leftBlob : rightBlob;
  const setState = isLeft ? setLeftBlob : setRightBlob;

  setState((s) => ({ ...s, loading: true }));

    try {
      const { folders, files } = await listByHierarchy({
        baseUrl,
        container: state.container,
        sasToken,
        prefix: state.pathSegments.length ? state.pathSegments.join("/") + "/" : "",
      });

      setState((s) => ({
        ...s,
        folders,
        files: files.filter((f) => (f.contentType || "").startsWith("image/")),
        selectedFile: null,
        selectedIndex: 0,
        loading: false,
      }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false }));
    }
  };

  const onCrumbClick = (side, idx) => {
    const setState = side === "left" ? setLeftBlob : setRightBlob;
    setState((s) => ({ ...s, pathSegments: idx >= 0 ? s.pathSegments.slice(0, idx + 1) : [] }));
    setTimeout(() => loadSide(side), 0);
  };

  const onOpenFolder = (side, folderNameFromApi) => {
    const last = folderNameFromApi.replace(/\/$/, "").split("/").pop();
    const setState = side === "left" ? setLeftBlob : setRightBlob;
    setState((s) => ({ ...s, pathSegments: [...s.pathSegments, last] }));
    setTimeout(() => loadSide(side), 0);
  };

  const onSelectFile = (side, file) => {
    const state = side === "left" ? leftBlob : rightBlob;
    const setState = side === "left" ? setLeftBlob : setRightBlob;
    const idx = state.files.findIndex((f) => f.url === file.url);
    setState((s) => ({ ...s, selectedFile: file, selectedIndex: idx >= 0 ? idx : 0 }));
  };

  const onSelectFiles = (side, selectedFiles) => {
    const setState = side === "left" ? setLeftBlob : setRightBlob;
    setState((s) => ({
      ...s,
      files: selectedFiles,
      selectedFiles: selectedFiles,
      selectedFile: selectedFiles[0] || null,
      selectedIndex: 0,
      folders: [],
      pathSegments: [],
    }));
  };

  useEffect(() => {
    if (leftSource === "upload" && leftUploads[leftUploadIndex]) {
      extractGpsFromFile(leftUploads[leftUploadIndex]).then(setLeftGps);
    } else {
      setLeftGps(null);
    }
  }, [leftUploads, leftSource, leftUploadIndex]);

  useEffect(() => {
    if (rightSource === "upload" && rightUploads[rightUploadIndex]) {
      extractGpsFromFile(rightUploads[rightUploadIndex]).then(setRightGps);
    } else {
      setRightGps(null);
    }
  }, [rightUploads, rightSource, rightUploadIndex]);

  useEffect(() => {
    if (leftSource === "blob" && leftSelectedUrl) {
      extractGpsFromUrl(leftSelectedUrl).then(setLeftGps);
    } else if (leftSource === "blob") {
      setLeftGps(null);
    }
  }, [leftSource, leftSelectedUrl]);

  useEffect(() => {
    if (rightSource === "blob" && rightSelectedUrl) {
      extractGpsFromUrl(rightSelectedUrl).then(setRightGps);
    } else if (rightSource === "blob") {
      setRightGps(null);
    }
  }, [rightSource, rightSelectedUrl]);

useEffect(() => {
  if (leftSource === "upload") {
    setLeftExplorerOpen(false);
  }
}, [leftSource]);

useEffect(() => {
  if (rightSource === "upload") {
    setRightExplorerOpen(false);
  }
}, [rightSource]);

  const toLatLngKey = (pos) => `${pos.lat.toFixed(6)},${pos.lon.toFixed(6)}`;

const groupByCoordinate = (items) => {
  const map = new Map();
  for (const it of items) {
    if (!it.pos) continue;

    const key = `${it.pos.lat.toFixed(6)},${it.pos.lon.toFixed(6)}`;
    const existing = map.get(key);

    if (existing) {
      existing.items.push(it);
    } else {
      map.set(key, { pos: it.pos, items: [it] });
    }
  }
  return Array.from(map.values());
};

const buildPopupHtml = (items = []) => {
  if (!items.length) return `<div style="min-width:180px;"></div>`;

  const main = items[0];
  const lat = main?.pos?.lat;
  const lon = main?.pos?.lon;

  const coordLine =
    (typeof lat === "number" && typeof lon === "number")
      ? `${lat.toFixed(6)}, ${lon.toFixed(6)}`
      : "No GPS";

  const escapeHtml = (s = "") =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const moreList =
    items.length > 1
      ? `<div style="margin-top:6px; max-height:90px; overflow:auto; font-size:12px; line-height:1.2;">
          <div style="opacity:.75; margin-bottom:4px;">Also here (${items.length - 1}):</div>
          ${items
            .slice(1, 8)
            .map(
              (it) =>
                `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">• ${escapeHtml(it.name)}</div>`
            )
            .join("")}
          ${items.length > 8 ? `<div style="opacity:.7;">…and more</div>` : ""}
        </div>`
      : "";

  return `
    <div style="min-width:220px; text-align:left;">
      <div style="font-weight:700; margin-bottom:6px; font-size:13px;">
        ${escapeHtml(main.name)}
      </div>

      <img
        src="${main.url}"
        style="width:100%; max-width:260px; border-radius:8px; border:1px solid rgba(0,0,0,.15); display:block;"
      />

      <div style="margin-top:8px; font-size:12px; color:#334155;">
        <div><strong>Lat/Lon:</strong> ${coordLine}</div>
      </div>

      ${moreList}
    </div>
  `;
};

// ✅ FIX: Only update map when marker DATA changes, not on selection changes
useEffect(() => {
  if (!leftMap.isReady) return;

  const markerData = leftSource === "blob" ? leftBlobMarkers : leftUploadMarkers;

  if (markerData.length > 0) {
    const grouped = groupByCoordinate(markerData);
    leftMap.setMarkers(
      grouped.map((g) => ({
        lat: g.pos.lat,
        lon: g.pos.lon,
        popupHtml: buildPopupHtml(g.items),
      })),
      DEFAULT_CENTER,
      DEFAULT_ZOOM
    );
  } else if (leftMarkerPos) {
    // Single marker mode (only if we have a position)
    leftMap.setMarker(
      leftMarkerPos,
      DEFAULT_CENTER,
      DEFAULT_ZOOM,
      buildPopupHtml(
        leftSelectedUrl && leftMarkerPos
          ? [{ url: leftSelectedUrl, name: leftName || "Unknown", pos: leftMarkerPos }]
          : []
      )
    );
  }
}, [
  leftMap.isReady,
  leftBlobMarkers,      // ✅ Only rerun when marker DATA changes
  leftUploadMarkers,    // ✅ Only rerun when marker DATA changes
  leftSource,
  // ❌ REMOVED: leftMarkerPos, leftSelectedUrl, leftName (these change on selection)
]);

// ✅ FIX: Same for right map
useEffect(() => {
  if (!rightMap.isReady) return;

  const markerData = rightSource === "blob" ? rightBlobMarkers : rightUploadMarkers;

  if (markerData.length > 0) {
    const grouped = groupByCoordinate(markerData);
    rightMap.setMarkers(
      grouped.map((g) => ({
        lat: g.pos.lat,
        lon: g.pos.lon,
        popupHtml: buildPopupHtml(g.items),
      })),
      DEFAULT_CENTER,
      DEFAULT_ZOOM
    );
  } else if (rightMarkerPos) {
    rightMap.setMarker(
      rightMarkerPos,
      DEFAULT_CENTER,
      DEFAULT_ZOOM,
      buildPopupHtml(
        rightSelectedUrl && rightMarkerPos
          ? [{ url: rightSelectedUrl, name: rightName || "Unknown", pos: rightMarkerPos }]
          : []
      )
    );
  }
}, [
  rightMap.isReady,
  rightBlobMarkers,     // ✅ Only rerun when marker DATA changes
  rightUploadMarkers,   // ✅ Only rerun when marker DATA changes
  rightSource,
  // ❌ REMOVED: rightMarkerPos, rightSelectedUrl, rightName
]);

	const navigateImages = (side, direction) => {
	  const isLeft = side === "left";
	  const source = isLeft ? leftSource : rightSource;
	  const list = isLeft 
		? (source === "upload" ? leftUploads : leftBlob.files) 
		: (source === "upload" ? rightUploads : rightBlob.files);
	  const currentIndex = isLeft 
		? (source === "upload" ? leftUploadIndex : leftBlob.selectedIndex) 
		: (source === "upload" ? rightUploadIndex : rightBlob.selectedIndex);

	  if (!list.length) return;

	  let nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
	  
	  if (nextIndex >= list.length) nextIndex = 0;
	  if (nextIndex < 0) nextIndex = list.length - 1;

	  if (isLeft) {
		if (source === "upload") setLeftUploadIndex(nextIndex);
		else setLeftBlob(prev => ({ ...prev, selectedIndex: nextIndex, selectedFile: list[nextIndex] }));
	  } else {
		if (source === "upload") setRightUploadIndex(nextIndex);
		else setRightBlob(prev => ({ ...prev, selectedIndex: nextIndex, selectedFile: list[nextIndex] }));
	  }
	};

	const handleStep = (side, direction) => {
	  const isLeft = side === "left";
	  const source = isLeft ? leftSource : rightSource;
	  const list = isLeft 
		? (source === "upload" ? leftUploads : leftBlob.files) 
		: (source === "upload" ? rightUploads : rightBlob.files);
	  const currentIdx = isLeft 
		? (source === "upload" ? leftUploadIndex : leftBlob.selectedIndex) 
		: (source === "upload" ? rightUploadIndex : rightBlob.selectedIndex);

	  if (!list.length) return;

	  let nextIdx = direction === "next" ? currentIdx + 1 : currentIdx - 1;
	  if (nextIdx >= list.length) nextIdx = 0;
	  if (nextIdx < 0) nextIdx = list.length - 1;

	  if (isLeft) {
		if (source === "upload") setLeftUploadIndex(nextIdx);
		else setLeftBlob(prev => ({ ...prev, selectedIndex: nextIdx, selectedFile: prev.files[nextIdx] }));
	  } else {
		if (source === "upload") setRightUploadIndex(nextIdx);
		else setRightBlob(prev => ({ ...prev, selectedIndex: nextIdx, selectedFile: prev.files[nextIdx] }));
	  }
	};

useEffect(() => {
  if (leftSource !== "blob") { 
    setLeftBlobMarkers([]);
    setLeftMapLoading(false);
    return; 
  }
  const currentList = leftBlob.files;
  let cancelled = false;

  setLeftMapLoading(true);
  setLeftMapProgress(0);

  (async () => {
    const total = currentList.length || 0;

    const worker = async (f) => {
      const cacheKey = f.url;
      if (gpsCache.has(cacheKey)) {
        const { lat, lon, name } = gpsCache.get(cacheKey);
        return { pos: { lat, lon }, url: f.url, name: name ?? f.name };
      }

      let gps = null;
      try { gps = await extractGpsFromUrl(f.url); } catch {}
      if (!gps) gps = parseLatLonFromName(f.name);
      const pos = normalizePos(gps);
      if (!pos) return null;

      gpsCache.set(cacheKey, { lat: pos.lat, lon: pos.lon, name: f.name });
      return { pos, url: f.url, name: f.name };
    };

    const onBatch = (partial) => {
      if (cancelled) return;
      setLeftBlobMarkers(partial);
      const processed = Math.min(partial.length, total);
      if (total > 0) setLeftMapProgress((processed / total) * 100);
    };

    const result = await processInBatches(currentList, 32, worker, onBatch);

    if (!cancelled) {
      setLeftBlobMarkers(result);
      setLeftMapProgress(100);
      setTimeout(() => setLeftMapLoading(false), 150);
    }
  })();

  return () => {
    cancelled = true;
    setLeftMapLoading(false);
  };
}, [leftSource, leftBlob.files]);


useEffect(() => {
  if (rightSource !== "blob") { 
    setRightBlobMarkers([]);
    setRightMapLoading(false);
    return; 
  }
  const currentList = rightBlob.files;
  let cancelled = false;

  setRightMapLoading(true);
  setRightMapProgress(0);

  (async () => {
    const total = currentList.length || 0;

    const worker = async (f) => {
      const cacheKey = f.url;
      if (gpsCache.has(cacheKey)) {
        const { lat, lon, name } = gpsCache.get(cacheKey);
        return { pos: { lat, lon }, url: f.url, name: name ?? f.name };
      }

      let gps = null;
      try { gps = await extractGpsFromUrl(f.url); } catch {}
      if (!gps) gps = parseLatLonFromName(f.name);
      const pos = normalizePos(gps);
      if (!pos) return null;

      gpsCache.set(cacheKey, { lat: pos.lat, lon: pos.lon, name: f.name });
      return { pos, url: f.url, name: f.name };
    };

    const onBatch = (partial) => {
      if (cancelled) return;
      setRightBlobMarkers(partial);
      const processed = Math.min(partial.length, total);
      if (total > 0) setRightMapProgress((processed / total) * 100);
    };

    const result = await processInBatches(currentList, 32, worker, onBatch);

    if (!cancelled) {
      setRightBlobMarkers(result);
      setRightMapProgress(100);
      setTimeout(() => setRightMapLoading(false), 150);
    }
  })();

  return () => {
    cancelled = true;
    setRightMapLoading(false);
  };
}, [rightSource, rightBlob.files]);


	useEffect(() => {
		if (showRightPanel && rightMap.mapInstance) {
		  const resizeTimeout = setTimeout(() => {
			rightMap.mapInstance.invalidateSize();
		  }, 300);
		  
		  return () => clearTimeout(resizeTimeout);
		}
	  }, [showRightPanel, rightMap.mapInstance]);
	  
	const handleImageNav = (side, direction) => {
	  const isLeft = side === "left";
	  const source = isLeft ? leftSource : rightSource;
	  const list = isLeft 
		? (source === "upload" ? leftUploads : leftBlob.files) 
		: (source === "upload" ? rightUploads : rightBlob.files);
	  const current = isLeft 
		? (source === "upload" ? leftUploadIndex : leftBlob.selectedIndex) 
		: (source === "upload" ? rightUploadIndex : rightBlob.selectedIndex);

	  if (!list || list.length === 0) return;

	  let nextIdx = direction === "next" ? current + 1 : current - 1;
	  if (nextIdx >= list.length) nextIdx = 0;
	  if (nextIdx < 0) nextIdx = list.length - 1;

	  if (isLeft) {
		if (source === "upload") setLeftUploadIndex(nextIdx);
		else setLeftBlob(s => ({ ...s, selectedIndex: nextIdx, selectedFile: s.files[nextIdx] }));
	  } else {
		if (source === "upload") setRightUploadIndex(nextIdx);
		else setRightBlob(s => ({ ...s, selectedIndex: nextIdx, selectedFile: s.files[nextIdx] }));
	  }
	};

const objectUrlCacheRef = React.useRef(new Map());

const getObjectUrl = (file) => {
  const cache = objectUrlCacheRef.current;
  if (!cache.has(file)) cache.set(file, URL.createObjectURL(file));
  return cache.get(file);
};

React.useEffect(() => {
  return () => {
    for (const url of objectUrlCacheRef.current.values()) URL.revokeObjectURL(url);
    objectUrlCacheRef.current.clear();
  };
}, []);

useEffect(() => {
  if (leftSource !== "upload" || leftUploads.length === 0) { 
    setLeftUploadMarkers([]);
    setLeftMapLoading(false);
    return; 
  }

  let cancelled = false;

  setLeftMapLoading(true);
  setLeftMapProgress(0);

  (async () => {
    const total = leftUploads.length || 0;

    const worker = async (file) => {
      const cacheKey = file.name;
      if (gpsCache.has(cacheKey)) {
        const { lat, lon } = gpsCache.get(cacheKey);
        return { pos: { lat, lon }, url: getObjectUrl(file), name: file.name };
      }

      let gps = null;
      try { gps = await extractGpsFromFile(file); } catch {}
      if (!gps) gps = parseLatLonFromName(file.name);
      const pos = normalizePos(gps);
      if (!pos) return null;

      gpsCache.set(cacheKey, { lat: pos.lat, lon: pos.lon });
      return { pos, url: getObjectUrl(file), name: file.name };
    };

    const onBatch = (partial) => { 
      if (cancelled) return;
      setLeftUploadMarkers(partial);
      const processed = Math.min(partial.length, total);
      if (total > 0) setLeftMapProgress((processed / total) * 100);
    };

    const result = await processInBatches(leftUploads, 32, worker, onBatch);
    
    if (!cancelled) {
      setLeftUploadMarkers(result);
      setLeftMapProgress(100);
      setTimeout(() => setLeftMapLoading(false), 150);
    }
  })();

  return () => { 
    cancelled = true;
    setLeftMapLoading(false);
  };
}, [leftSource, leftUploads]);


useEffect(() => {
  if (rightSource !== "upload" || rightUploads.length === 0) {
    setRightUploadMarkers([]);
    setRightMapLoading(false);
    return;
  }

  let cancelled = false;

  setRightMapLoading(true);
  setRightMapProgress(0);

  (async () => {
    const total = rightUploads.length || 0;

    const worker = async (file) => {
      const cacheKey = file.name;
      if (gpsCache.has(cacheKey)) {
        const { lat, lon } = gpsCache.get(cacheKey);
        return { pos: { lat, lon }, url: getObjectUrl(file), name: file.name };
      }

      let gps = null;
      try { gps = await extractGpsFromFile(file); } catch {}
      if (!gps) gps = parseLatLonFromName(file.name);
      const pos = normalizePos(gps);
      if (!pos) return null;

      gpsCache.set(cacheKey, { lat: pos.lat, lon: pos.lon });
      return { pos, url: getObjectUrl(file), name: file.name };
    };

    const onBatch = (partial) => { 
      if (cancelled) return;
      setRightUploadMarkers(partial);
      const processed = Math.min(partial.length, total);
      if (total > 0) setRightMapProgress((processed / total) * 100);
    };

    const result = await processInBatches(rightUploads, 32, worker, onBatch);
    
    if (!cancelled) {
      setRightUploadMarkers(result);
      setRightMapProgress(100);
      setTimeout(() => setRightMapLoading(false), 150);
    }
  })();

  return () => { 
    cancelled = true;
    setRightMapLoading(false);
  };
}, [rightSource, rightUploads]);

  return (
    <div className="p-8 bg-white/10 backdrop-blur-xl rounded-xl shadow-2xl max-w-7xl mx-auto mt-8 border border-white/20">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-fg/90">Map Viewer</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white shadow transition"
          >
            {showRightPanel ? "Hide Right Panel" : "Show Right Panel"}
          </button>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg border border-white/20 text-white flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-house" aria-hidden="true">
			<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path>
			<path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
			</svg><span>Back to Dashboard</span>
          </button>
        </div>
      </div>

      <div className={`grid ${showRightPanel ? "grid-cols-2" : "grid-cols-1"} gap-6 mb-8`}>
        {/* LEFT PANEL */}
        <div className="border border-white/20 bg-white/5 backdrop-blur rounded-lg p-4 relative">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-black">Left</h3>
            <div className="flex gap-2">
              <button
                className={`px-3 py-1 rounded ${leftSource === "upload" ? "bg-blue-600 text-white" : "bg-white/20 text-white"}`}
                onClick={() => setLeftSource("upload")}
              >
                Upload
              </button>
              <button
                className={`px-3 py-1 rounded ${leftSource === "blob" ? "bg-blue-600 text-white" : "bg-white/20 text-white"}`}
                onClick={() => setLeftSource("blob")}
              >
                Blob
              </button>
            </div>
          </div>

          {leftSource === "upload" ? (
            <div className="space-y-3">
              <FilePicker multiple onFiles={(files) => { setLeftUploads(files); setLeftUploadIndex(0); }} />
              {leftUploads.length > 0 && (
                <>
                  <ThumbnailStrip images={leftUploads.map((f) => ({ url: URL.createObjectURL(f), name: f.name }))} currentIndex={leftUploadIndex} onSelect={setLeftUploadIndex} />         
					{leftSelectedUrl && (
					  <div className="relative group mt-3 w-full overflow-hidden rounded-xl border border-white/20 shadow-lg">
						<div className="w-full aspect-[4/3] bg-black/20 flex items-center justify-center">
						  <img 
							src={leftSelectedUrl} 
							className="max-w-full max-h-full object-contain" 
							alt="Preview" 
						  />
						</div>
						
						<div className="absolute inset-0 flex items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
						  <button 
							onClick={() => handleStep("left", "prev")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Previous Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M15 18l-6-6 6-6"/>
							</svg>
						  </button>
						  
						  <button 
							onClick={() => handleStep("left", "next")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Next Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M9 18l6-6-6-6"/>
							</svg>
						  </button>
						</div>
						
					  </div>
					)}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-end justify-between">
                <button
                  onClick={() => setLeftExplorerOpen(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 shadow-sm hover:bg-gray-50"
                >
                  <GoldFolderIcon /> <span>Explorer</span>
                </button>
              </div>

              {!leftExplorerOpen && (
                <>
                  <Breadcrumbs pathSegments={leftBlob.pathSegments} onCrumbClick={(idx) => onCrumbClick("left", idx)} />
                  {leftBlob.loading ? (
                    <div className="text-sm text-gray-500">Loading…</div>
                  ) : (
                    <FolderBrowser folders={leftBlob.folders} files={leftBlob.files} onOpenFolder={(f) => onOpenFolder("left", f)} onSelectFile={(file) => onSelectFile("left", file)} />
                  )}
                  {leftBlob.files.length > 0 && (
                    <ThumbnailStrip images={leftBlob.files} currentIndex={leftBlob.selectedIndex} onSelect={(idx) => setLeftBlob((s) => ({ ...s, selectedFile: s.files[idx], selectedIndex: idx }))} />
                  )}                  
				  {leftSelectedUrl && (
					  <div className="relative group mt-3 w-full overflow-hidden rounded-xl border border-white/20 shadow-lg">
						<img src={leftSelectedUrl} className="mt-3 w-full max-h-[400px] object-contain rounded" alt="" />
						<div className="absolute inset-0 flex items-center justify-between px-2 opacity-0 group-hover:opacity-100 transition">
						
						  <button 
							onClick={() => handleStep("left", "prev")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Previous Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M15 18l-6-6 6-6"/>
							</svg>
						  </button>
						  
						  <button 
							onClick={() => handleStep("left", "next")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Next Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M9 18l6-6-6-6"/>
							</svg>
						  </button>
						  
						</div>
					  </div>
					)}
                </>
              )}
            </div>
          )}

          <FileExplorerModal
            open={leftExplorerOpen}
            onClose={() => setLeftExplorerOpen(false)}
            side="left"
            baseUrl={baseUrl}
            sasToken={sasToken}
            initialContainer={leftBlob.container}
            initialPathSegments={leftBlob.pathSegments}
            fallbackContainers={CONTAINER_OPTIONS}
            onSelectContainer={(name) => {
              setLeftBlob((s) => ({ ...s, container: name, pathSegments: [], folders: [], files: [], loading: true }));
              setTimeout(() => loadSide("left"), 0);
            }}
            onSelectFile={(file) => onSelectFile("left", file)}
            onSelectFiles={(files) => onSelectFiles("left", files)}
          />
        </div>

        {/* RIGHT PANEL */}
        {showRightPanel && (
          <div className="border border-white/20 bg-white/5 backdrop-blur rounded-lg p-4 relative">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-black">Right</h3>
              <div className="flex gap-2">
                <button
                  className={`px-3 py-1 rounded ${rightSource === "upload" ? "bg-blue-600 text-white" : "bg-white/20 text-white"}`}
                  onClick={() => setRightSource("upload")}
                >
                  Upload
                </button>
                <button
                  className={`px-3 py-1 rounded ${rightSource === "blob" ? "bg-blue-600 text-white" : "bg-white/20 text-white"}`}
                  onClick={() => setRightSource("blob")}
                >
                  Blob
                </button>
              </div>
            </div>

            {rightSource === "upload" ? (
              <div className="space-y-3">
                <FilePicker multiple onFiles={(files) => { setRightUploads(files); setRightUploadIndex(0); }} />
                {rightUploads.length > 0 && (
                  <>
                    <ThumbnailStrip images={rightUploads.map((f) => ({ url: URL.createObjectURL(f), name: f.name }))} currentIndex={rightUploadIndex} onSelect={setRightUploadIndex} />
                    {rightSelectedUrl && (
					  <div className="relative group mt-3 w-full overflow-hidden rounded-xl border border-white/20 shadow-lg bg-black/10">
						<div className="w-full aspect-[4/3] bg-black/20 flex items-center justify-center">
						  <img 
							src={rightSelectedUrl} 
							className="max-w-full max-h-full object-contain transition-transform duration-500" 
							alt="Right Preview" 
						  />
						</div>

						<div className="absolute inset-0 flex items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
						  <button 
							onClick={() => handleImageNav("right", "prev")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Previous Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M15 18l-6-6 6-6"/>
							</svg>
						  </button>
						  
						  <button 
							onClick={() => handleImageNav("right", "next")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Next Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M9 18l6-6-6-6"/>
							</svg>
						  </button>
						</div>
					  </div>
					)}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <button
                    onClick={() => setRightExplorerOpen(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 shadow-sm hover:bg-gray-50"
                  >
                    <GoldFolderIcon /> <span>Explorer</span>
                  </button>
                </div>

                {!rightExplorerOpen && (
                  <>
                    <Breadcrumbs pathSegments={rightBlob.pathSegments} onCrumbClick={(idx) => onCrumbClick("right", idx)} />
                    {rightBlob.loading ? (
                      <div className="text-sm text-gray-500">Loading…</div>
                    ) : (
                      <FolderBrowser folders={rightBlob.folders} files={rightBlob.files} onOpenFolder={(f) => onOpenFolder("right", f)} onSelectFile={(file) => onSelectFile("right", file)} />
                    )}
                    {rightBlob.files.length > 0 && (
                      <ThumbnailStrip images={rightBlob.files} currentIndex={rightBlob.selectedIndex} onSelect={(idx) => setRightBlob((s) => ({ ...s, selectedFile: s.files[idx], selectedIndex: idx }))} />
                    )}
                    {rightSelectedUrl && (
					  <div className="relative group mt-3 w-full overflow-hidden rounded-xl border border-white/20 shadow-lg bg-black/10">
						<div className="w-full aspect-video flex items-center justify-center">
						  <img 
							src={rightSelectedUrl} 
							className="mt-3 w-full max-h-[400px] object-contain rounded" 
							alt="Right Preview" 
						  />
						</div>

						<div className="absolute inset-0 flex items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
						  <button 
							onClick={() => handleImageNav("right", "prev")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Previous Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M15 18l-6-6 6-6"/>
							</svg>
						  </button>
						  
						  <button 
							onClick={() => handleImageNav("right", "next")}
							className="p-3 rounded-full bg-black/40 backdrop-blur-md border border-white/30 text-white hover:bg-black/60 transition shadow-xl pointer-events-auto"
							title="Next Image"
						  >
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							  <path d="M9 18l6-6-6-6"/>
							</svg>
						  </button>
						</div>
					  </div>
					)}
                  </>
                )}
              </div>
            )}

            <FileExplorerModal
              open={rightExplorerOpen}
              onClose={() => setRightExplorerOpen(false)}
              side="right"
              baseUrl={baseUrl}
              sasToken={sasToken}
              initialContainer={rightBlob.container}
              initialPathSegments={rightBlob.pathSegments}
              fallbackContainers={CONTAINER_OPTIONS}
              onSelectContainer={(name) => {
                setRightBlob((s) => ({ ...s, container: name, pathSegments: [], folders: [], files: [], loading: true }));
                setTimeout(() => loadSide("right"), 0);
              }}
              onSelectFile={(file) => onSelectFile("right", file)}
              onSelectFiles={(files) => onSelectFiles("right", files)}
            />
          </div>
        )}
      </div>
	  
      {/* MAPS */}
	<div className={`grid ${showRightPanel ? "grid-cols-2" : "grid-cols-1"} gap-4`}>
	  {/* LEFT MAP */}
	  <div
		ref={leftMapRef}
		className="rounded-lg border border-white/20"
		style={{ height: "400px", width: "100%", position: "relative" }}
	  >
		{/* PROGRESS: Left map overlay */}
		<MapProgressOverlay
		  show={leftMapLoading}
		  percent={leftMapProgress}
		  label="Plotting markers…"
		/>
	  </div>

	  {/* RIGHT MAP (conditional) */}
	  {showRightPanel && (
		<div
		  ref={rightMapRef}
		  className="rounded-lg border border-white/20"
		  style={{ height: "400px", width: "100%", position: "relative" }}
		>
		  {/* PROGRESS: Right map overlay */}
		  <MapProgressOverlay
			show={rightMapLoading}
			percent={rightMapProgress}
			label="Plotting markers…"
		  />
		</div>
	  )}
	</div>


    </div>
  );
}