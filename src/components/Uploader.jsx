import React, { useState, useCallback, useEffect } from "react";
import { useUploadQueue } from "./UploadQueueProvider";
import { Folder, FileText, ArrowLeft, Home, Eye, EyeOff } from "lucide-react";
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
    pushHistory,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
  } = useUploadQueue();

  const navigate = useNavigate();

  const HIDDEN_PREFIX = ".hidden_";
  const [containers] = useState(["raw", "processed", "projects", "uploads", "issued"]);
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [currentPath, setCurrentPath] = useState([]);
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [username] = useState("anonymous");
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showHidden, setShowHidden] = useState(false);
  const itemsPerPage = 9;

  const [folders, setFolders] = useState([]);
  const [filesInFolder, setFilesInFolder] = useState([]);
  const [loadingBlobs, setLoadingBlobs] = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchFolders = async (container, path) => {
    setLoadingBlobs(true);
    try {
      const prefix = normalizePrefix(path);
      const containerClient = getContainerClient(container);
      const folderSet = new Set();
      const filesList = [];

      for await (const item of containerClient.listBlobsByHierarchy("/", { prefix })) {
        if (item.kind === "prefix") {
          const folderFullName = item.name.replace(/\/$/, "");
          const folderNameOnly = folderFullName.split("/").pop();
          if (showHidden || !folderNameOnly.startsWith(HIDDEN_PREFIX)) {
            folderSet.add(folderFullName);
          }
        } else if (item.kind === "blob") {
          const fileName = item.name.split("/").pop();
          if (showHidden || !fileName.startsWith(HIDDEN_PREFIX)) {
            filesList.push({
              name: fileName,
              size: item.properties?.contentLength ?? 0,
              path: item.name,
            });
          }
        }
      }
      setFolders([...folderSet]);
      setFilesInFolder(filesList);
    } catch (err) {
      showToast("Error fetching contents", "error");
    } finally {
      setLoadingBlobs(false);
    }
  };

  useEffect(() => {
    if (selectedContainer) fetchFolders(selectedContainer, currentPath.join("/"));
  }, [selectedContainer, currentPath, showHidden]);

  const handleContainerClick = (container) => {
    setSelectedContainer(container);
    setCurrentPath([]);
    pushHistory(container, []);
  };

  const handleFolderClick = (folderFullName) => {
    const name = folderFullName.split("/").pop();
    const nextPath = [...currentPath, name];
    setCurrentPath(nextPath);
    pushHistory(selectedContainer, nextPath);
  };

  const handleBreadcrumbClick = (index) => {
    if (index === -1) {
      setSelectedContainer(null);
      setCurrentPath([]);
      return;
    }
    const nextPath = currentPath.slice(0, index);
    setCurrentPath(nextPath);
    pushHistory(selectedContainer, nextPath);
  };

  // REUSABLE MOVE LOGIC - Fixed for 403 and 400 errors
  const moveAzureFolder = async (oldFolderFullName, newFolderName) => {
    const containerClient = getContainerClient(selectedContainer);
    const oldPrefix = ensureSlash(oldFolderFullName);
    const parentPath = currentPath.length ? currentPath.join("/") + "/" : "";
    const newPrefix = parentPath + ensureSlash(newFolderName);

    // Clean SAS token (ensure no leading ?)
    const cleanSas = sasToken.startsWith("?") ? sasToken.substring(1) : sasToken;

    for await (const blob of containerClient.listBlobsFlat({ prefix: oldPrefix })) {
      const oldBlobName = blob.name;
      const newBlobName = oldBlobName.replace(oldPrefix, newPrefix);

      // FIX: Use URL object to prevent double slashes or encoding issues
      // This ensures the Source URL is exactly what Azure expects
      const sourceUrl = `${baseUrl}/${selectedContainer}/${oldBlobName.split('/').map(encodeURIComponent).join('/')}?${cleanSas}`;
      
      const destClient = containerClient.getBlockBlobClient(newBlobName);

      // Perform Copy
      const copyPoller = await destClient.beginCopyFromURL(sourceUrl);
      await copyPoller.pollUntilDone();

      // Delete original only after copy is successful
      await containerClient.getBlobClient(oldBlobName).delete();
    }
    return true;
  };

  const createFolder = async (name) => {
    if (!name) return;
    try {
      const currentPathStr = currentPath.length ? currentPath.join("/") + "/" : "";
      const blobPath = `${currentPathStr}${name}/placeholder.txt`;
      const blobClient = getBlockBlobClient(selectedContainer, blobPath);
      await blobClient.upload("placeholder", 11);
      fetchFolders(selectedContainer, currentPath.join("/"));
      showToast("Folder created");
    } catch {
      showToast("Creation failed", "error");
    }
  };

  const renameFolder = async (oldFolderFullName) => {
    const oldName = oldFolderFullName.split("/").pop();
    const newName = prompt("Rename folder to:", oldName);
    if (!newName || newName === oldName) return;

    try {
      setLoadingBlobs(true);
      await moveAzureFolder(oldFolderFullName, newName);
      showToast("Folder renamed");
      fetchFolders(selectedContainer, currentPath.join("/"));
    } catch (err) {
      console.error("Rename Error:", err);
      showToast("Rename failed. Check SAS permissions.", "error");
    } finally {
      setLoadingBlobs(false);
    }
  };

  const hideFolder = async (folderFullName) => {
    const folderName = folderFullName.split("/").pop();
    const isHidden = folderName.startsWith(HIDDEN_PREFIX);
    const newName = isHidden ? folderName.replace(HIDDEN_PREFIX, "") : HIDDEN_PREFIX + folderName;

    if (!window.confirm(`Are you sure you want to ${isHidden ? "unhide" : "hide"} this folder?`)) return;

    try {
      setLoadingBlobs(true);
      await moveAzureFolder(folderFullName, newName);
      showToast(isHidden ? "Folder visible" : "Folder hidden");
      fetchFolders(selectedContainer, currentPath.join("/"));
    } catch (err) {
      console.error("Hide Error:", err);
      showToast("Hide operation failed.", "error");
    } finally {
      setLoadingBlobs(false);
    }
  };

  const filteredFolders = folders.filter((f) => f.toLowerCase().includes(searchQuery.toLowerCase()));
  const paginatedFolders = filteredFolders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-fg/90">Azure Blob Uploader</h2>
        <div className="flex gap-2">
          {selectedContainer && (
            <button onClick={() => setShowHidden(!showHidden)} className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80">
              {showHidden ? <EyeOff size={18} /> : <Eye size={18} />}
              <span>{showHidden ? "Hide Hidden" : "Show Hidden"}</span>
            </button>
          )}
          <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80">
            <Home size={18} />
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>

      {toast && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${toast.type === "success" ? "bg-green-500" : "bg-red-500"} text-white`}>
          {toast.message}
        </div>
      )}

      {!selectedContainer ? (
        <div className="grid grid-cols-5 gap-4">
          {containers.map((c) => (
            <button key={c} onClick={() => handleContainerClick(c)} className="p-6 rounded-lg bg-white/5 hover:bg-primary-600 transition text-fg/80 font-semibold capitalize">
              {c}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-card p-6">
            {/* Nav */}
            <div className="flex items-center text-sm mb-4 flex-wrap gap-2 text-fg/80">
              <span onClick={() => handleBreadcrumbClick(-1)} className="cursor-pointer text-primary-600 font-bold">Home</span>
              <span>/</span>
              <span onClick={() => handleBreadcrumbClick(0)} className="cursor-pointer text-primary-600 font-bold">{selectedContainer}</span>
              {currentPath.map((seg, i) => (
                <React.Fragment key={i}>
                  <span>/</span>
                  <span onClick={() => handleBreadcrumbClick(i + 1)} className="cursor-pointer">{seg}</span>
                </React.Fragment>
              ))}
            </div>

            <div className="min-h-72 border border-glass-border rounded-lg p-3 bg-white/5">
              <div className="flex justify-between items-center mb-4">
                <input type="text" placeholder="Search folders..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-white/5 border border-glass-border rounded p-2 text-sm w-1/2 text-fg" />
                <button onClick={() => createFolder(prompt("Enter folder name:"))} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 transition">+ New Folder</button>
              </div>

              {loadingBlobs ? <div className="text-center py-10 text-fg/50">Processing Azure request...</div> : (
                <div className="grid grid-cols-3 gap-3">
                  {paginatedFolders.map((item, idx) => {
                    const name = item.split("/").pop();
                    const isHidden = name.startsWith(HIDDEN_PREFIX);
                    return (
                      <div key={idx} className={`p-4 rounded-lg bg-white/5 border border-glass-border hover:bg-white/10 transition ${isHidden ? 'opacity-40 border-dashed' : ''}`}>
                        <div onClick={() => handleFolderClick(item)} className="flex items-center cursor-pointer mb-3">
                          <Folder size={20} className={`mr-2 ${isHidden ? 'text-gray-400' : 'text-yellow-500'}`} />
                          <span className="font-semibold truncate text-fg/90">{name}</span>
                        </div>
                        <div className="flex gap-4 border-t border-white/10 pt-3">
                          {/* STYLING: Dark Blue for Rename */}
                          <button onClick={() => renameFolder(item)} className="text-blue-800 text-xs font-bold hover:underline">RENAME</button>
                          {/* STYLING: Dark Red for Hide */}
                          <button onClick={() => hideFolder(item)} className="text-red-800 text-xs font-bold hover:underline">{isHidden ? 'UNHIDE' : 'HIDE'}</button>
                        </div>
                      </div>
                    );
                  })}
                  {folders.length === 0 && !loadingBlobs && <div className="col-span-3 text-center py-10 text-fg/40">No folders found</div>}
                </div>
              )}
            </div>
          </div>
          
          <div className="lg:col-span-1 glass-card p-6">
             <h3 className="text-fg font-bold mb-4">Drag & Drop Upload</h3>
             <div className="border-2 border-dashed border-glass-border p-12 text-center text-fg/40 rounded-lg hover:border-primary-500 transition cursor-pointer">
                Select files or folders to upload to this directory
             </div>
          </div>
        </div>
      )}
    </div>
  );
}