
import React, { useState, useCallback, useEffect } from "react";
import { useUploadQueue } from "./UploadQueueProvider";
import { Folder, FileText, ArrowLeft, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  getContainerClient,
  getBlockBlobClient,
  normalizePrefix,
  sasToken,
  baseUrl,
} from "../azureBlob";

/** -----------------------------
 * Local helpers
 * ------------------------------*/

// Recursively traverse dropped folders (webkitEntry tree)
const traverseFileTree = (item, path = "") =>
  new Promise((resolve) => {
    if (item.isFile) {
      item.file((file) => {
        const fileWithPath = new File([file], file.name, { type: file.type });
        Object.defineProperty(fileWithPath, "webkitRelativePath", {
          value: path + file.name,
          writable: false,
        });
        resolve([fileWithPath]);
      });
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      const allFiles = [];
      const readEntries = () => {
        dirReader.readEntries((entries) => {
          if (entries.length === 0) {
            resolve(allFiles);
          } else {
            const promises = entries.map((entry) =>
              traverseFileTree(entry, path + item.name + "/")
            );
            Promise.all(promises).then((results) => {
              allFiles.push(...results.flat());
              readEntries();
            });
          }
        });
      };
      readEntries();
    } else {
      resolve([]);
    }
  });

// Ensure trailing slash (but keep empty string as "")
const ensureTrailingSlash = (s) => {
  if (!s) return "";
  return s.endsWith("/") ? s : s + "/";
};

// Derive parent prefix from a folder prefix with trailing slash
// e.g. "a/b/" -> "a/", "b/" -> ""
const getParentPrefix = (folderPrefixWithSlash) =>
  folderPrefixWithSlash.replace(/[^/]+\/$/, "");

// Hidden marker inside a folder prefix
const HIDDEN_MARKER = ".hidden";

// Check if an exact blob exists via LIST (avoids HEAD/404 noise)
const blobExistsByList = async (containerClient, exactBlobName) => {
  const iter = containerClient.listBlobsFlat({ prefix: exactBlobName });
  for await (const b of iter) {
    if (b.name === exactBlobName) return true; // exact match
  }
  return false;
};

// Encode a blob path for use inside a URL without encoding slashes
// (encode each segment individually)
const encodeBlobPath = (name) =>
  name
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

/** -----------------------------
 * Component
 * ------------------------------*/

export default function Uploader() {
  const {
    enqueueFiles,
    queue,
    globalProgress,
    canGoBack,
    canGoForward,
    pushHistory,
    goBack,
    goForward,
  } = useUploadQueue();
  const navigate = useNavigate();

  const [containers] = useState(["raw", "processed", "projects", "uploads", "issued"]);
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [currentPath, setCurrentPath] = useState([]); // breadcrumb segments
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [username] = useState("anonymous");
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  const [folders, setFolders] = useState([]); // full names like "parent/child"
  const [filesInFolder, setFilesInFolder] = useState([]);
  const [loadingBlobs, setLoadingBlobs] = useState(false);

  // Hidden folders
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenMap, setHiddenMap] = useState({}); // { "parent/child": true/false }

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  /** -----------------------------
   * Hidden handling (LIST-based; no HEAD/404s)
   * ------------------------------*/

  // LIST with prefix "<folder>/.hidden" to check presence (no 404 noise)
  const isFolderHidden = async (container, folderPrefix) => {
    const containerClient = getContainerClient(container);
    const markerPrefix = ensureTrailingSlash(folderPrefix) + HIDDEN_MARKER;
    for await (const _ of containerClient.listBlobsFlat({ prefix: markerPrefix })) {
      return true; // found marker
    }
    return false;
  };

  const setFolderHidden = async (container, folderPrefix, hidden) => {
    const containerClient = getContainerClient(container);
    const markerPath = ensureTrailingSlash(folderPrefix) + HIDDEN_MARKER;
    const markerClient = containerClient.getBlockBlobClient(markerPath);
    if (hidden) {
      // zero-byte marker
      await markerClient.uploadData(new Uint8Array(0), {
        blobHTTPHeaders: { blobContentType: "application/octet-stream" },
      });
    } else {
      try {
        await markerClient.delete();
      } catch {
        /* ignore if not exists */
      }
    }
  };

  /** -----------------------------
   * Folder listing (with hidden filter)
   * ------------------------------*/
  const fetchFolders = async (container, path) => {
    setLoadingBlobs(true);
    setFolders([]);
    setFilesInFolder([]);
    setHiddenMap({});
    try {
      const prefix = normalizePrefix(path);
      const containerClient = getContainerClient(container);

      const rawFolders = [];
      const filesList = [];

      // Gather immediate children under prefix
      for await (const item of containerClient.listBlobsByHierarchy("/", { prefix })) {
        if (item.kind === "prefix") {
          rawFolders.push(item.name.replace(/\/$/, "")); // store without trailing slash
        } else if (item.kind === "blob") {
          const name = item.name.split("/").pop();
          filesList.push({
            name,
            size: item.properties?.contentLength ?? 0,
            path: item.name,
          });
        }
      }

      // Determine hidden flags using LIST (no 404 spam)
      const checks = await Promise.all(
        rawFolders.map(async (full) => {
          const hidden = await isFolderHidden(container, full);
          return { full, hidden };
        })
      );

      const nextHiddenMap = {};
      checks.forEach(({ full, hidden }) => {
        nextHiddenMap[full] = hidden;
      });

      // Apply filter based on showHidden
      const visibleFolders = showHidden
        ? checks.map((x) => x.full) // include all if showHidden
        : checks.filter((x) => !x.hidden).map((x) => x.full);

      setHiddenMap(nextHiddenMap);
      setFolders(visibleFolders);
      setFilesInFolder(filesList);
    } catch (err) {
      console.error("Error fetching folders:", err?.message || err);
      showToast("Failed to fetch folders", "error");
      setFolders([]);
      setFilesInFolder([]);
    } finally {
      setLoadingBlobs(false);
    }
  };

  useEffect(() => {
    if (!selectedContainer) return;
    fetchFolders(selectedContainer, currentPath.join("/"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContainer, currentPath, showHidden]);

  /** -----------------------------
   * Date / base path
   * ------------------------------*/
  const getCurrentDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getRawBasePath = () => {
    if (selectedContainer !== "raw") return "";
    const date = getCurrentDate();
    return `${date}/${username}/`;
  };

  /** -----------------------------
   * Navigation
   * ------------------------------*/
  const handleContainerClick = (container) => {
    setSelectedContainer(container);
    setCurrentPath([]);
    setFiles([]);
    setCurrentPage(1);
    setSearchQuery("");
    pushHistory(container, []);
  };

  const handleFolderClick = (folderFullName) => {
    const name = folderFullName.split("/").pop();
    const nextPath = [...currentPath, name];
    setCurrentPath(nextPath);
    setFiles([]);
    setCurrentPage(1);
    pushHistory(selectedContainer, nextPath);
  };

  const handleBreadcrumbClick = (index) => {
    if (index === -1) {
      setSelectedContainer(null);
      setFiles([]);
      setCurrentPath([]);
      pushHistory(null, []);
      return;
    }
    const nextPath = currentPath.slice(0, index);
    setCurrentPath(nextPath);
    setFiles([]);
    setCurrentPage(1);
    pushHistory(selectedContainer, nextPath);
  };

  const handleBack = () => {
    const entry = goBack();
    if (!entry) return;
    setSelectedContainer(entry.container);
    setCurrentPath(entry.path);
    setFiles([]);
    setCurrentPage(1);
  };

  const handleForward = () => {
    const entry = goForward();
    if (!entry) return;
    setSelectedContainer(entry.container);
    setCurrentPath(entry.path);
    setFiles([]);
    setCurrentPage(1);
  };

  /** -----------------------------
   * Drag & drop / selection
   * ------------------------------*/
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const dt = e.dataTransfer;
    if (dt.items && dt.items.length > 0) {
      const promises = [];
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i].webkitGetAsEntry();
        if (item) promises.push(traverseFileTree(item));
      }
      Promise.all(promises).then((results) => {
        const allFiles = results.flat().filter(Boolean);
        setFiles((prev) => [...prev, ...allFiles]);
      });
    } else {
      const droppedFiles = Array.from(dt.files);
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  /** -----------------------------
   * Upload queue
   * ------------------------------*/
  const handleUploadClick = () => {
    if (!selectedContainer || files.length === 0) {
      showToast("Please select a container and files before queuing", "error");
      return;
    }
    const basePath =
      selectedContainer === "raw"
        ? getRawBasePath()
        : currentPath.length
        ? currentPath.join("/") + "/"
        : "";
    const count = files.length;
    enqueueFiles(files, selectedContainer, basePath);
    setFiles([]);
    showToast(`Added ${count} file(s) to upload queue`);
  };

  /** -----------------------------
   * Derived UI values
   * ------------------------------*/
  const filteredFolders = folders.filter((f) =>
    f.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filteredFolders.length / itemsPerPage));
  const paginatedFolders = filteredFolders.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalGlobalProgress =
    globalProgress.totalSize > 0
      ? Math.round((globalProgress.uploadedSize / globalProgress.totalSize) * 100)
      : 0;

  const currentUploadPath =
    selectedContainer === "raw"
      ? getRawBasePath() +
        currentPath.join("/") +
        (currentPath.length > 0 ? "/" : "")
      : currentPath.length
      ? currentPath.join("/") + "/"
      : "Root of Container";

  /** -----------------------------
   * Create folder (zero-byte placeholder)
   * ------------------------------*/
  const createFolder = async (name) => {
    if (!name) return;

    // basic validation: no slashes, trim spaces
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/")) {
      showToast("Invalid folder name", "error");
      return;
    }

    try {
      const folderPrefix =
        (currentPath.length ? currentPath.join("/") + "/" : "") + trimmed + "/";
      const blobPath = folderPrefix + ".folder"; // zero-byte placeholder
      const blobClient = getBlockBlobClient(selectedContainer, blobPath);

      await blobClient.uploadData(new Uint8Array(0), {
        blobHTTPHeaders: { blobContentType: "application/octet-stream" },
      });

      await fetchFolders(selectedContainer, currentPath.join("/"));
      showToast("Folder created successfully");
    } catch (err) {
      console.error("Create folder failed:", err);
      showToast("Failed to create folder", "error");
    }
  };

  /** -----------------------------
   * Rename folder (copy → poll → delete)
   * - Parent derived from the folder itself (not breadcrumb)
   * - Pre-deletes destination blob if it exists (LIST-based; no HEAD/404)
   * - URL-encodes source for beginCopyFromURL to avoid 400s
   * - Handles empty folders by moving placeholder
   * ------------------------------*/
  const renameFolder = async (oldFolderFullName) => {
    const defaultName = oldFolderFullName.split("/").pop();
    const newName = prompt("Enter new folder name:", defaultName);
    if (!newName || newName === defaultName) return;

    // basic validation
    const trimmed = newName.trim();
    if (!trimmed || /[\\:*?"<>|]/.test(trimmed) || trimmed.includes("/")) {
      showToast("Invalid folder name", "error");
      return;
    }

    try {
      const containerClient = getContainerClient(selectedContainer);

      // Work with explicit prefixes (trailing slash)
      const oldPrefix = ensureTrailingSlash(oldFolderFullName);
      const parentPrefix = getParentPrefix(oldPrefix); // may be ""
      const newPrefix = parentPrefix + ensureTrailingSlash(trimmed);

      // Track if we copied any blobs (handles empty folders)
      let copiedAny = false;

      // 1) Copy each blob from oldPrefix → newPrefix
      for await (const item of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
        const oldBlobName = item.name;
        const newBlobName = oldBlobName.replace(oldPrefix, newPrefix);

        const destClient = containerClient.getBlockBlobClient(newBlobName);

        // Pre-delete destination if it already exists (LIST-based, no HEAD/404)
        try {
          const destExists = await blobExistsByList(containerClient, newBlobName);
          if (destExists) {
            await destClient.delete(); // 202 when exists
          }
        } catch {
          // ignore deletion errors
        }

        // URL-encode the source blob path segment-wise to avoid 400
        const encodedSource = encodeBlobPath(oldBlobName);
        const sourceUrl = `${baseUrl}/${selectedContainer}/${encodedSource}?${sasToken}`;

        const poller = await destClient.beginCopyFromURL(sourceUrl);
        const result = await poller.pollUntilDone();
        const status = (result?.copyStatus || "").toLowerCase();
        if (status !== "success") {
          throw new Error(`Copy failed for ${oldBlobName}: ${result?.copyStatus}`);
        }

        copiedAny = true;
      }

      // If nothing was copied (empty folder), create a placeholder at newPrefix
      if (!copiedAny) {
        const placeholderDest = containerClient.getBlockBlobClient(
          newPrefix + ".folder"
        );
        await placeholderDest.uploadData(new Uint8Array(0), {
          blobHTTPHeaders: { blobContentType: "application/octet-stream" },
        });

        // Delete old placeholder if present
        const oldPlaceholderName = oldPrefix + ".folder";
        if (await blobExistsByList(containerClient, oldPlaceholderName)) {
          try {
            await containerClient.getBlobClient(oldPlaceholderName).delete();
          } catch {
            /* ignore */
          }
        }
      }

      // 2) Delete originals only after all copies succeed
      for await (const item of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
        try {
          const srcClient = containerClient.getBlobClient(item.name);
          await srcClient.delete();
        } catch (delErr) {
          console.warn("Delete source failed:", item.name, delErr?.message || delErr);
        }
      }

      await fetchFolders(selectedContainer, currentPath.join("/"));
      showToast("Folder renamed successfully");
    } catch (err) {
      console.error("Rename folder failed:", err);
      showToast("Failed to rename folder", "error");
    }
  };

  /** -----------------------------
   * Hide / Unhide folder
   * ------------------------------*/
  const toggleHidden = async (folderFullName) => {
    try {
      const currentlyHidden = !!hiddenMap[folderFullName];
      await setFolderHidden(selectedContainer, folderFullName, !currentlyHidden);
      await fetchFolders(selectedContainer, currentPath.join("/"));
      showToast(currentlyHidden ? "Folder unhidden" : "Folder hidden");
    } catch (err) {
      console.error("Hide/Unhide failed:", err);
      showToast("Failed to update hidden state", "error");
    }
  };

  /** -----------------------------
   * Render
   * ------------------------------*/
  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-fg/90">Azure Blob Uploader</h2>
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80"
        >
          <Home size={18} />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* New Folder + Show Hidden toggle */}
      {selectedContainer && (
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={async () => {
              const name = prompt("Enter new folder name:");
              await createFolder(name);
            }}
            className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition"
          >
            + New Folder
          </button>

          <label className="flex items-center gap-2 text-sm text-fg/80">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Show hidden folders
          </label>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg transition-opacity z-50 ${
            toast.type === "success" ? "bg-green-500" : "bg-red-500"
          } text-white`}
        >
          {toast.message}
        </div>
      )}

      {/* Container selection */}
      {!selectedContainer && (
        <div className="mb-6 p-4 bg-white/10 rounded-lg border border-glass-border">
          <h3 className="font-semibold text-fg/90 mb-3">1. Select Destination Container</h3>
          <div className="grid grid-cols-5 gap-4">
            {containers.map((container) => (
              <button
                key={container}
                onClick={() => handleContainerClick(container)}
                className="p-6 rounded-lg shadow-lg cursor-pointer bg-white/5 hover:bg-primary-600 hover:text-white transition text-fg/80 font-semibold capitalize"
              >
                {container}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Upload interface */}
      {selectedContainer && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 glass-card p-6">
            {/* Breadcrumb + nav */}
            <div className="flex items-center text-sm mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBack}
                  disabled={!canGoBack}
                  className="px-2 py-1 bg-white/10 rounded disabled:opacity-50 text-fg/80"
                  title="Back"
                >
                  ← Back
                </button>
                <button
                  onClick={handleForward}
                  disabled={!canGoForward}
                  className="px-2 py-1 bg-white/10 rounded disabled:opacity-50 text-fg/80"
                  title="Forward"
                >
                  Forward →
                </button>
              </div>
              <div className="flex items-center flex-wrap">
                <span
                  onClick={() => handleBreadcrumbClick(-1)}
                  className="cursor-pointer text-primary-600 hover:underline font-semibold"
                >
                  Home
                </span>
                <span className="mx-1 text-fg/70">/</span>
                <span
                  onClick={() => handleBreadcrumbClick(0)}
                  className="cursor-pointer text-primary-600 hover:underline font-semibold"
                >
                  {selectedContainer}
                </span>
                {currentPath.map((segment, index) => (
                  <span key={index} className="flex items-center">
                    <span className="mx-1 text-fg/70">/</span>
                    <span
                      onClick={() => handleBreadcrumbClick(index + 1)}
                      className="cursor-pointer text-fg/80 hover:underline"
                    >
                      {segment}
                    </span>
                  </span>
                ))}
                {currentPath.length > 0 && <span className="mx-1 text-fg/70">/</span>}
              </div>
            </div>

            {/* Search + pagination */}
            <div className="flex justify-between items-center mb-4 gap-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search folders..."
                className="border border-glass-border p-2 rounded bg-white/5 text-fg flex-1"
              />
              <div className="flex items-center gap-2">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(currentPage - 1)}
                  className="px-3 py-1 bg-white/10 rounded disabled:opacity-50 text-fg/80"
                >
                  Prev
                </button>
                <span className="text-fg/80 text-sm">
                  {Math.min(currentPage, totalPages)}/{totalPages}
                </span>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(currentPage + 1)}
                  className="px-3 py-1 bg-white/10 rounded disabled:opacity-50 text-fg/80"
                >
                  Next
                </button>
              </div>
            </div>

            {/* Folder/file listing */}
            <div className="min-h-72 border border-glass-border rounded-lg p-3 bg-white/5 overflow-y-auto">
              {loadingBlobs ? (
                <div className="text-center py-10 text-muted">Loading folder contents...</div>
              ) : (
                <>
                  {currentPath.length > 0 && (
                    <div
                      onClick={() => handleBreadcrumbClick(currentPath.length - 1)}
                      className="flex items-center p-2 rounded-md hover:bg-white/10 cursor-pointer text-fg/80 transition"
                    >
                      <ArrowLeft size={18} className="mr-3 text-fg/60" />
                      <span className="font-semibold">... Go Up</span>
                    </div>
                  )}

                  {paginatedFolders.length > 0 ? (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {paginatedFolders.map((item, index) => {
                        const isHidden = !!hiddenMap[item];
                        return (
                          <div key={index} className="p-3 rounded-lg bg-white/5 hover:bg-white/10 transition">
                            <div
                              onClick={() => handleFolderClick(item)}
                              className="flex items-center cursor-pointer text-fg/80"
                            >
                              <Folder size={18} className="mr-2 text-yellow-500" />
                              <span className="font-semibold flex items-center gap-2">
                                {item.split("/").pop()}
                                {isHidden && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-700/30 text-yellow-200 border border-yellow-600/30">
                                    hidden
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="mt-2 flex gap-3">
                              <button
                                onClick={async () => {
                                  await renameFolder(item);
                                }}
                                className="text-gray-900 text-xs hover:underline"
                              >
                                Rename
                              </button>

                              <button
                                onClick={async () => {
                                  await toggleHidden(item);
                                }}
                                className="text-gray-900 text-xs hover:underline"
                              >
                                {isHidden ? "Unhide" : "Hide"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    !loadingBlobs &&
                    folders.length === 0 && (
                      <p className="text-center py-10 text-muted">
                        No folders found in this location.
                      </p>
                    )
                  )}

                  {filesInFolder.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-semibold text-fg/80 mb-2">Files:</h4>
                      {filesInFolder.map((item, index) => (
                        <div key={`file-${index}`} className="flex items-center p-2 rounded-md text-fg/70">
                          <FileText size={18} className="mr-3 text-blue-500" />
                          <span>
                            {item.name} ({Math.round(item.size / 1024)} KB)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right column (select files + queue) */}
          <div className="lg:col-span-1 flex flex-col">
            <div className="glass-card p-6 flex-1">
              <h3 className="font-semibold text-fg/90 mb-3">3. Upload Target</h3>
              <p className="text-xs text-muted mb-4 p-2 bg-white/5 rounded-md break-all">
                <strong>Target Path:</strong>{" "}
                <span className="font-mono text-primary-600">{currentUploadPath}</span>
              </p>

              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
                  isDragging ? "bg-white/10 border-primary-400" : "border-glass-border text-fg/80"
                }`}
              >
                <input
                  id="fileInput"
                  type="file"
                  multiple
                  webkitdirectory="true"
                  directory="true"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <input
                  id="individualFileInput"
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="space-y-3">
                  {selectedContainer === "processed" ? (
                    <>
                      <button
                        onClick={() => document.getElementById("fileInput").click()}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition mr-2"
                      >
                        Select Folder
                      </button>
                      <button
                        onClick={() => document.getElementById("individualFileInput").click()}
                        className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition"
                      >
                        Select Files
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => document.getElementById("fileInput").click()}
                      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
                    >
                      Select Folder
                    </button>
                  )}
                  <p className="text-fg/70 mt-2">
                    {isDragging ? "Drop files/folder here..." : "Drag & Drop or Click to Select Folder/Files"}
                  </p>
                </div>
              </div>

              {files.length > 0 && (
                <div className="mt-4 border rounded-lg p-4 bg-white/10 max-h-40 overflow-y-auto border-glass-border">
                  <p className="font-semibold text-fg/80 mb-2">{files.length} file(s) selected:</p>
                  <ul className="text-sm text-fg/70 space-y-1">
                    {files.map((file, idx) => (
                      <li key={idx} className="truncate flex items-center gap-2">
                        <FileText size={14} className="flex-shrink-0" />
                        <span className="flex-1 truncate">{file.webkitRelativePath || file.name}</span>
                        <span className="flex-shrink-0">
                          ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={handleUploadClick}
                disabled={!files.length}
                className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add {files.length} file(s) to Background Queue
              </button>
            </div>

            {/* Global progress */}
            {queue.length > 0 && (
              <div className="mt-4 p-3 bg-white/5 rounded border border-glass-border">
                <div className="flex items-center justify-between text-sm">
                  <span>Overall Progress</span>
                  <span>{totalGlobalProgress}%</span>
                </div>
                <div className="w-full h-2 bg-white/10 mt-2 rounded">
                  <div
                    className="h-2 bg-blue-600 rounded"
                    style={{ width: `${totalGlobalProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detailed queue view */}
      {queue.length > 0 && (
        <div className="mt-8 pt-4 border-t border-glass-border">
          <h4 className="text-lg font-semibold text-fg/90 mb-3">Individual Upload Status</h4>
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {queue.map((item) => (
              <li
                key={item.id}
                className={`p-3 rounded-lg flex justify-between items-center ${
                  item.status === "complete"
                    ? "bg-green-600/20"
                    : item.status === "failed"
                    ? "bg-red-600/20"
                    : "bg-blue-600/10"
                }`}
              >
                <div className="flex-1 pr-4">
                  <p className="font-medium truncate text-fg">{item.name}</p>
                  <p className="text-xs text-muted">
                    {item.status === "failed"
                      ? `Error: ${item.error}`
                      : `Status: ${item.status} - Chunk ${item.currentChunk || 0} of ${
                          item.totalChunks || 0
                        }`}
                  </p>
                </div>
                <div className="w-24 text-right">
                  <p className="text-sm text-fg/80">{Math.round(item.progress)}%</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
