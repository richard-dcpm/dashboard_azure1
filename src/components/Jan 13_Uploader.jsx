
import React, { useState, useCallback, useEffect } from "react";
import { useUploadQueue } from "./UploadQueueProvider";
import { Folder, FileText, ArrowLeft, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  getContainerClient,
  getBlockBlobClient,
  ensureSlash,
  normalizePrefix,
  storageAccountName,
  sasToken,
  baseUrl,
} from "../azureBlob";

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
            const promises = entries.map((entry) => traverseFileTree(entry, path + item.name + "/"));
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
  const [currentPath, setCurrentPath] = useState([]);
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [username] = useState("anonymous");
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  const [folders, setFolders] = useState([]);
  const [filesInFolder, setFilesInFolder] = useState([]);
  const [loadingBlobs, setLoadingBlobs] = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ---------- SDK-based folder listing ----------
  const fetchFolders = async (container, path) => {
    setLoadingBlobs(true);
    setFolders([]);
    setFilesInFolder([]);

    try {
      const prefix = normalizePrefix(path);
      const containerClient = getContainerClient(container);

      const folderSet = new Set();
      const filesList = [];

      for await (const item of containerClient.listBlobsByHierarchy("/", { prefix })) {
        if (item.kind === "prefix") {
          folderSet.add(item.name.replace(/\/$/, ""));
        } else if (item.kind === "blob") {
          const name = item.name.split("/").pop();
          filesList.push({
            name,
            size: item.properties?.contentLength ?? 0,
            path: item.name,
          });
        }
      }

      setFolders([...folderSet]);
      setFilesInFolder(filesList);
    } catch (err) {
      console.error("Error fetching folders:", err.message);
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
  }, [selectedContainer, currentPath]);

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

  const filteredFolders = folders.filter((f) =>
    f.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const totalPages = Math.ceil(filteredFolders.length / itemsPerPage) || 1;
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
      ? getRawBasePath() + currentPath.join("/") + (currentPath.length > 0 ? "/" : "")
      : currentPath.length
      ? currentPath.join("/") + "/"
      : "Root of Container";

  // ---------- Create folder (via placeholder blob) ----------
  const createFolder = async (name) => {
    if (!name) return;
    try {
      const blobPath =
        (currentPath.length ? currentPath.join("/") + "/" : "") + name + "/placeholder.txt";
      const blobClient = getBlockBlobClient(selectedContainer, blobPath);
      await blobClient.upload("placeholder", {
        blobHTTPHeaders: { blobContentType: "text/plain" },
      });
      await fetchFolders(selectedContainer, currentPath.join("/"));
      showToast("Folder created successfully");
    } catch {
      showToast("Failed to create folder", "error");
    }
  };

  // ---------- Rename folder (copy + delete) ----------
  const renameFolder = async (oldFolderFullName) => {
    const newName = prompt("Enter new folder name:", oldFolderFullName.split("/").pop());
    if (!newName) return;

    try {
      const oldPrefix = ensureSlash(oldFolderFullName);
      const newPrefix =
        ensureSlash(currentPath.length ? currentPath.join("/") : "") + ensureSlash(newName);
      const containerClient = getContainerClient(selectedContainer);

      for await (const item of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
        const oldBlobName = item.name;
        const newBlobName = oldBlobName.replace(oldPrefix, newPrefix);

        const sourceUrl = `${baseUrl}/${selectedContainer}/${oldBlobName}?${sasToken}`;
        const destClient = containerClient.getBlockBlobClient(newBlobName);

        const copyPoller = await destClient.beginCopyFromURL(sourceUrl);
        await copyPoller.pollUntilDone();

        const sourceClient = containerClient.getBlobClient(oldBlobName);
        await sourceClient.delete();
      }

      await fetchFolders(selectedContainer, currentPath.join("/"));
      showToast("Folder renamed successfully");
    } catch {
      showToast("Failed to rename folder", "error");
    }
  };

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

      {/* New Folder */}
      {selectedContainer && (
        <div className="flex justify-end mb-3">
          <button
            onClick={async () => {
              const name = prompt("Enter new folder name:");
              await createFolder(name);
            }}
            className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition"
          >
            + New Folder
          </button>
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
                  {currentPage}/{Math.ceil(filteredFolders.length / itemsPerPage) || 1}
                </span>
                <button
                  disabled={currentPage === (Math.ceil(filteredFolders.length / itemsPerPage) || 1)}
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
                      {paginatedFolders.map((item, index) => (
                        <div key={index} className="p-3 rounded-lg bg-white/5 hover:bg-white/10 transition">
                          <div onClick={() => handleFolderClick(item)} className="flex items-center cursor-pointer text-fg/80">
                            <Folder size={18} className="mr-2 text-yellow-500" />
                            <span className="font-semibold">{item.split("/").pop()}</span>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={async () => {
                                await renameFolder(item);
                              }}
                              className="text-gray-900 text-xs hover:underline"
                            >
                              Rename
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    !loadingBlobs &&
                    folders.length === 0 && (
                      <p className="text-center py-10 text-muted">No folders found in this location.</p>
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
                <input id="fileInput" type="file" multiple webkitdirectory="true" directory="true" onChange={handleFileChange} className="hidden" />
                <input id="individualFileInput" type="file" multiple onChange={handleFileChange} className="hidden" />

                <div className="space-y-3">
                  {selectedContainer === "processed" ? (
                    <>
                      <button onClick={() => document.getElementById("fileInput").click()} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition mr-2">
                        Select Folder
                      </button>
                      <button onClick={() => document.getElementById("individualFileInput").click()} className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition">
                        Select Files
                      </button>
                    </>
                  ) : (
                    <button onClick={() => document.getElementById("fileInput").click()} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
                      Select Folder
                    </button>
                  )}
                  <p className="text-fg/70 mt-2">{isDragging ? "Drop files/folder here..." : "Drag & Drop or Click to Select Folder/Files"}</p>
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
                        <span className="flex-shrink-0">({(file.size / (1024 * 1024)).toFixed(1)} MB)</span>
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
                    : item.status === "pending"
                    ? "bg-blue-600/10"
                    : "bg-white/5"
                }`}
              >
                <div className="flex-1 pr-4">
                  <p className="font-medium truncate text-fg">{item.name}</p>
                  <p className="text-xs text-muted">
                    {item.status === "failed"
                      ? `Error: ${item.error}`
                      : `Status: ${item.status} - Chunk ${item.currentChunk || 0} of ${item.totalChunks || 0}`}
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
