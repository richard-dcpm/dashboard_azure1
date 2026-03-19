import { useState, useEffect, useRef, useMemo } from "react";
import exifr from "exifr";
import L from "leaflet";
import { useNavigate } from "react-router-dom";
import { useDownload } from "../DownloadContext";
import { searchAcrossContainers } from "../../pages/MapCompare/containerSearchUtil";
import { getContainerClient, normalizePrefix, baseUrl, sasToken } from "../../azureBlob";

/* ── Leaflet icon fix ── */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const safeSasToken = String(sasToken || "").replace(/&amp;/g, "&");

function encodeBlobPath(name) {
  return String(name || "").split("/").map((s) => encodeURIComponent(s)).join("/");
}

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useImageGallery() {
  const navigate = useNavigate();
  const { startDownload } = useDownload();

  const containersToCheck  = ["raw", "processed", "projects", "uploads", "issued"];
  const CONTAINERS_PER_PAGE = 9;
  const IMAGES_PER_PAGE     = 30;

  /* ── Core state ── */
  const [containerPage, setContainerPage]         = useState(0);
  const [availableContainers, setAvailableContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [selectedPath, setSelectedPath]           = useState([]);
  const [currentFolders, setCurrentFolders]       = useState([]);
  const [images, setImages]                       = useState([]);
  const [selectedImages, setSelectedImages]       = useState({});
  const [loading, setLoading]                     = useState(false);
  const [imagePage, setImagePage]                 = useState(0);

  /* ── Caches ── */
  const folderCache   = useRef(new Map());
  const childrenCache = useRef(new Map());

  /* ── View & Sort ── */
  const [viewMode,   setViewMode]   = useState("grid"); // 'grid' | 'list'
  const [sortBy,     setSortBy]     = useState("name"); // 'name' | 'date' | 'size'
  const [sortOrder,  setSortOrder]  = useState("asc");

  const sortedImages = useMemo(() => {
    const arr = [...images];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else if (sortBy === "date") cmp = (a.lastModified || 0) - (b.lastModified || 0);
      else if (sortBy === "size") cmp = (a.size || 0) - (b.size || 0);
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [images, sortBy, sortOrder]);

  /* ── EXIF Panel ── */
  const [exifImage,   setExifImage]   = useState(null);
  const [exifData,    setExifData]    = useState(null);
  const [exifLoading, setExifLoading] = useState(false);

  const openExifPanel = async (img) => {
    setExifImage(img);
    setExifData(null);
    setExifLoading(true);
    try {
      const res = await fetch(img.url);
      if (res.ok) {
        const buf  = await res.arrayBuffer();
        const data = await exifr.parse(buf, true);
        setExifData(data || {});
      } else {
        setExifData({});
      }
    } catch { setExifData({}); }
    finally  { setExifLoading(false); }
  };
  const closeExifPanel = () => { setExifImage(null); setExifData(null); };

  /* ── Favourites & Tags (localStorage) ── */
  const [favourites, setFavourites] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gallery-favourites") || "{}"); } catch { return {}; }
  });
  const [tags, setTags] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gallery-tags") || "{}"); } catch { return {}; }
  });

  const toggleFavourite = (url) => {
    setFavourites((prev) => {
      const next = { ...prev, [url]: !prev[url] };
      localStorage.setItem("gallery-favourites", JSON.stringify(next));
      return next;
    });
  };

  const addTag = (url, tag) => {
    if (!tag.trim()) return;
    setTags((prev) => {
      const existing = prev[url] || [];
      if (existing.includes(tag.trim())) return prev;
      const next = { ...prev, [url]: [...existing, tag.trim()] };
      localStorage.setItem("gallery-tags", JSON.stringify(next));
      return next;
    });
  };

  const removeTag = (url, tag) => {
    setTags((prev) => {
      const next = { ...prev, [url]: (prev[url] || []).filter((t) => t !== tag) };
      localStorage.setItem("gallery-tags", JSON.stringify(next));
      return next;
    });
  };

  /* ── Batch Move / Copy ── */
  const [batchMode,     setBatchMode]     = useState(null); // 'move' | 'copy' | null
  const [batchTarget,   setBatchTarget]   = useState("");
  const [batchProgress, setBatchProgress] = useState(null); // { done, total, errors }

  const executeBatch = async () => {
    const selected = images.filter((i) => selectedImages[i.name]);
    if (!selected.length || !batchTarget) return;

    setBatchProgress({ done: 0, total: selected.length, errors: 0 });

    for (const img of selected) {
      try {
        const destUrl = `${baseUrl}/${batchTarget}/${encodeBlobPath(img.blobPath)}?${safeSasToken}`;
        const srcUrl  = `${baseUrl}/${selectedContainer}/${encodeBlobPath(img.blobPath)}?${safeSasToken}`;

        const copyRes = await fetch(destUrl, {
          method: "PUT",
          headers: {
            "x-ms-copy-source":   srcUrl,
            "x-ms-version":       "2021-06-08",
            "x-ms-requires-sync": "true",
          },
        });
        if (!copyRes.ok) throw new Error(`Copy failed: ${copyRes.status}`);

        if (batchMode === "move") {
          await fetch(srcUrl, {
            method: "DELETE",
            headers: { "x-ms-version": "2021-06-08" },
          });
        }

        setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      } catch (err) {
        console.error("Batch op failed for", img.name, err);
        setBatchProgress((p) => ({ ...p, done: p.done + 1, errors: p.errors + 1 }));
      }
    }

    if (batchMode === "move") {
      setImages((prev) => prev.filter((i) => !selectedImages[i.name]));
      clearAll();
    }

    setTimeout(() => { setBatchProgress(null); setBatchMode(null); setBatchTarget(""); }, 3000);
  };

  /* ── Map ── */
  const [showMap, setShowMap] = useState(false);
  const [mapImages, setMapImages]   = useState([]);
  const mapRef            = useRef(null);
  const leafletMap        = useRef(null);
  const baseOSMRef        = useRef(null);
  const baseSatRef        = useRef(null);
  const layersControlRef  = useRef(null);

  const isImageFile = (n) => /\.(jpe?g|png|gif|webp)$/i.test(n);

  /* ── Container probe ── */
  useEffect(() => {
    const load = async () => {
      const existing = [];
      for (const c of containersToCheck) {
        try {
          const client = getContainerClient(c);
          const iter   = client.listBlobsByHierarchy("/");
          await iter.next();
          existing.push(c);
        } catch {}
      }
      setAvailableContainers(existing);
    };
    load();
  }, []);

  /* ── Folder listing + eager prefetch ── */
  const fetchFolders = async (container, prefix = "") => {
    const key = `${container}/${prefix}`;
    if (folderCache.current.has(key)) {
      setCurrentFolders(folderCache.current.get(key));
      prefetchChildChecks(container, folderCache.current.get(key));
      return;
    }
    const client  = getContainerClient(container);
    const folders = [];
    for await (const item of client.listBlobsByHierarchy("/", { prefix: normalizePrefix(prefix) })) {
      if (item.kind === "prefix") {
        const cleaned = item.name.replace(/\/$/, "");
        folders.push({ fullPath: cleaned, name: cleaned.split("/").pop() });
      }
    }
    folderCache.current.set(key, folders);
    setCurrentFolders(folders);
    prefetchChildChecks(container, folders);
  };

  const prefetchChildChecks = (container, folders) => {
    folders.forEach((f) => {
      const key = `${container}/${f.fullPath}`;
      if (childrenCache.current.has(key)) return;
      const client = getContainerClient(container);
      (async () => {
        let found = false;
        for await (const item of client.listBlobsByHierarchy("/", { prefix: normalizePrefix(f.fullPath) })) {
          if (item.kind === "prefix") { found = true; break; }
        }
        childrenCache.current.set(key, found);
      })();
    });
  };

  const hasSubfolders = async (container, folderFullPath) => {
    const key = `${container}/${folderFullPath}`;
    if (childrenCache.current.has(key)) return childrenCache.current.get(key);
    const client = getContainerClient(container);
    let found = false;
    for await (const item of client.listBlobsByHierarchy("/", { prefix: normalizePrefix(folderFullPath) })) {
      if (item.kind === "prefix") { found = true; break; }
    }
    childrenCache.current.set(key, found);
    return found;
  };

  /* ── Navigate up ── */
  const navigateUp = async () => {
    if (selectedPath.length === 0) {
      setSelectedContainer(null); setCurrentFolders([]); setImages([]); return;
    }
    const newPath = selectedPath.slice(0, -1);
    setSelectedPath(newPath); setImages([]); setSelectedImages({});
    await fetchFolders(selectedContainer, newPath.length ? newPath.at(-1).fullPath + "/" : "");
  };

  /* ── Open folder ── */
  const openFolder = async (folder) => {
    setLoading(true);
    setSelectedPath((p) => [...p, folder]);
    await fetchFolders(selectedContainer, folder.fullPath + "/");
    setImages([]); setSelectedImages({});
    setLoading(false);
  };

  /* ── View images ── */
  const viewImages = async (folder) => {
    setLoading(true);
    const client = getContainerClient(selectedContainer);
    const imgs   = [];
    for await (const blob of client.listBlobsFlat({ prefix: normalizePrefix(folder.fullPath) })) {
      if (isImageFile(blob.name)) {
        const encoded = encodeBlobPath(blob.name);
        imgs.push({
          name:         blob.name.split("/").pop(),
          blobPath:     blob.name,                    // full path for copy/delete
          url:          `${baseUrl}/${selectedContainer}/${encoded}?${safeSasToken}`,
          size:         blob.properties?.contentLength || 0,
          lastModified: blob.properties?.lastModified
            ? new Date(blob.properties.lastModified).getTime() : 0,
          sizeLabel:    fmtSize(blob.properties?.contentLength),
        });
      }
    }
    setSelectedPath((p) => [...p, folder]);
    setImages(imgs); setCurrentFolders([]); setSelectedImages({});
    setImagePage(0);
    setLoading(false);
  };

  /* ── View map ── */
  const viewMap = async (folder) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setShowMap(true); setMapImages([]);
    const client = getContainerClient(selectedContainer);
    const imgs   = [];
    for await (const blob of client.listBlobsFlat({ prefix: normalizePrefix(folder.fullPath) })) {
      if (!isImageFile(blob.name)) continue;
      const encoded = encodeBlobPath(blob.name);
      const url     = `${baseUrl}/${selectedContainer}/${encoded}?${safeSasToken}`;
      let lat, lon;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf      = await res.arrayBuffer();
          const exifData = await exifr.parse(buf, { gps: true });
          if (exifData?.latitude && exifData?.longitude) { lat = exifData.latitude; lon = exifData.longitude; }
        }
      } catch {}
      if (!lat || !lon) {
        const m = blob.name.match(/([-\d.]+)_([-\d.]+)/);
        if (m) { lat = parseFloat(m[1]); lon = parseFloat(m[2]); }
      }
      if (lat && lon && !isNaN(lat) && !isNaN(lon))
        imgs.push({ lat, lon, url, name: blob.name.split("/").pop() });
    }
    setMapImages(imgs);
  };

  /* ── Select helpers ── */
  const selectAll = () => { const m = {}; images.forEach((i) => (m[i.name] = true)); setSelectedImages(m); };
  const clearAll  = () => setSelectedImages({});

  /* ── Downloads ── */
  const downloadFolderZip = () => {
    if (!images.length) return;
    startDownload(images, `${selectedPath.at(-1)?.name || "images"}.zip`);
  };
  const downloadSelectedZip = () => {
    const chosen = images.filter((i) => selectedImages[i.name]);
    if (!chosen.length) return;
    startDownload(chosen, "selected-images.zip");
  };

  /* ── Search ── */
  const [searchQuery,   setSearchQuery]   = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [searchStatus,  setSearchStatus]  = useState("");
  const searchTimer    = useRef(null);
  const searchAbortRef = useRef(null);

  const runSearch = async (query) => {
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true); setSearchResults([]); setSearchStatus("Starting search…");
    try {
      await searchAcrossContainers({
        baseUrl, sasToken, query,
        containers: availableContainers,
        signal: controller.signal,
        onProgress: ({ container, currentMatches, done, containerDone }) => {
          if (controller.signal.aborted) return;
          if (currentMatches) {
            setSearchResults(
              currentMatches.map((r) => {
                const parts = r.name.split("/");
                const name  = parts.pop();
                return { ...r, name, folderPath: parts.join("/"), fullPath: r.name };
              })
            );
          }
          if (containerDone && !done) setSearchStatus("Searching remaining containers…");
        },
      });
    } catch (err) {
      if (!controller.signal.aborted) console.error("Search error:", err);
    } finally {
      if (!controller.signal.aborted) { setSearching(false); setSearchStatus(""); }
    }
  };

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) {
      setSearchResults([]); setSearching(false); setSearchStatus("");
      if (searchAbortRef.current) searchAbortRef.current.abort();
      return;
    }
    if (val.trim().length < 3) return;
    setSearching(true);
    searchTimer.current = setTimeout(() => runSearch(val.trim()), 400);
  };

  /* ── Pagination ── */
  /* ── Lightbox ── */
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [lightboxPool,  setLightboxPool]  = useState([]);
  const openLightbox  = (imgs, idx) => { setLightboxPool(imgs); setLightboxIndex(idx); };
  const closeLightbox = () => setLightboxIndex(null);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e) => {
      if (e.key === "Escape")     closeLightbox();
      if (e.key === "ArrowRight") setLightboxIndex((i) => Math.min(i + 1, lightboxPool.length - 1));
      if (e.key === "ArrowLeft")  setLightboxIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, lightboxPool]);

  /* ── Leaflet init ── */
  useEffect(() => {
    if (!showMap || !mapRef.current) return;
    if (leafletMap.current) { try { leafletMap.current.remove(); } catch {} leafletMap.current = null; }
    const map = L.map(mapRef.current, { zoomControl: true });
    leafletMap.current = map;
    baseOSMRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
    baseSatRef.current = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "© Esri" });
    layersControlRef.current = L.control.layers(
      { Road: baseOSMRef.current, Satellite: baseSatRef.current }, null,
      { position: "bottomright", collapsed: false }
    ).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.setView([0, 0], 2);
    setTimeout(() => map.invalidateSize(), 150);
  }, [showMap]);

  /* ── Leaflet markers ── */
  useEffect(() => {
    if (!showMap || !leafletMap.current) return;
    const map = leafletMap.current;
    map.eachLayer((l) => { if (l && typeof l.getLatLng === "function") map.removeLayer(l); });
    if (!mapImages?.length) { map.setView([0, 0], 2); return; }

    let cLat = 0, cLon = 0;
    mapImages.forEach((img) => {
      cLat += img.lat; cLon += img.lon;
      const el = document.createElement("div"); el.style.textAlign = "center";
      const tag = document.createElement("img");
      tag.src = img.url; tag.loading = "eager";
      tag.style.cssText = "max-width:360px;height:auto;border-radius:4px;margin-bottom:8px;";
      const marker = L.marker([img.lat, img.lon]).addTo(map);
      tag.onerror = () => { el.innerHTML = `<div style="font-size:12px">${img.name}</div>`; try { marker.getPopup?.()?.update(); } catch {} };
      tag.onload  = () => {
        const n = document.createElement("div"); n.style.cssText = "font-size:12px;font-weight:600;"; n.textContent = img.name;
        const c = document.createElement("div"); c.style.fontSize = "11px"; c.textContent = `${img.lat.toFixed(6)}, ${img.lon.toFixed(6)}`;
        el.innerHTML = ""; el.appendChild(tag); el.appendChild(n); el.appendChild(c);
        try { marker.getPopup?.()?.update(); } catch {}
      };
      el.appendChild(tag);
      marker.bindPopup(el, { maxWidth: 420 });
    });
    cLat /= mapImages.length; cLon /= mapImages.length;
    setTimeout(() => {
      if (!leafletMap.current) return;
      const tmp = L.circle([cLat, cLon], { radius: 500 }).addTo(map);
      map.fitBounds(tmp.getBounds(), { padding: [40, 40], maxZoom: 16 });
      map.removeLayer(tmp); map.invalidateSize();
    }, 200);
  }, [mapImages, showMap]);

  /* ── Leaflet cleanup ── */
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setShowMap(false);
    if (showMap) { document.body.style.overflow = "hidden"; window.addEventListener("keydown", onKey); }
    else {
      document.body.style.overflow = "";
      if (leafletMap.current) { try { leafletMap.current.remove(); } catch {} leafletMap.current = null; }
    }
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [showMap]);

  return {
    navigate,
    containerPage, setContainerPage,
    availableContainers, selectedContainer, setSelectedContainer,
    selectedPath, setSelectedPath,
    currentFolders,
    images, setImages,
    sortedImages,
    selectedImages, setSelectedImages,
    loading,
    CONTAINERS_PER_PAGE, IMAGES_PER_PAGE,
    imagePage, setImagePage,

    viewMode, setViewMode,
    sortBy, setSortBy,
    sortOrder, setSortOrder,

    exifImage, exifData, exifLoading,
    openExifPanel, closeExifPanel,

    favourites, toggleFavourite,
    tags, addTag, removeTag,

    batchMode, setBatchMode,
    batchTarget, setBatchTarget,
    batchProgress,
    executeBatch,

    showMap, setShowMap,
    mapImages, mapRef,

    fetchFolders, navigateUp, openFolder, viewImages, viewMap, hasSubfolders,
    selectAll, clearAll,
    downloadFolderZip, downloadSelectedZip,

    searchQuery, searchResults, searching, searchStatus,
    handleSearchChange,

    lightboxIndex, lightboxPool, openLightbox, closeLightbox,

    fmtSize,
  };
}