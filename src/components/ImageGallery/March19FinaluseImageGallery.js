import { useState, useEffect, useRef } from "react";
import exifr from "exifr";
import { useDownload } from "../DownloadContext";
import L from "leaflet";
import { useNavigate } from "react-router-dom";
import { searchAcrossContainers } from "../../pages/MapCompare/containerSearchUtil"; 
import { getContainerClient, normalizePrefix, baseUrl, sasToken } from "../../azureBlob";

/* Leaflet icon fix */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

/* SAS normalization */
const safeSasToken = String(sasToken || "").replace(/&amp;/g, "&");

function encodeBlobPath(name) {
  return String(name || "")
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

export function useImageGallery() {
  const navigate = useNavigate();

  const containersToCheck = ["raw","processed","projects","uploads","issued"];
  const CONTAINERS_PER_PAGE = 9;

  const [containerPage, setContainerPage] = useState(0);
  const [availableContainers, setAvailableContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState(null);

  const [selectedPath, setSelectedPath] = useState([]);
  const [currentFolders, setCurrentFolders] = useState([]);
  const [images, setImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState({});
  const [loading, setLoading] = useState(false);

  const folderCache = useRef(new Map());
  const childrenCache = useRef(new Map());

  /* ── Search ── */
  const [searchQuery, setSearchQuery]     = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]         = useState(false);
  const [searchStatus, setSearchStatus]   = useState(""); // e.g. "Searching raw…"
  const searchTimer    = useRef(null);
  const searchAbortRef = useRef(null);

  const runSearch = async (query) => {
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearching(true);
    setSearchResults([]);
    setSearchStatus("Starting search…");

    try {
      await searchAcrossContainers({
        baseUrl,
        sasToken,
        query,
        containers: availableContainers,
        signal: controller.signal,
        onProgress: ({ container, currentMatches, done, containerDone }) => {
          if (controller.signal.aborted) return;

          // Stream partial results into UI as each container finishes
          if (currentMatches) {
            setSearchResults(
              currentMatches.map((r) => {
                const parts      = r.name.split("/");
                const name       = parts.pop();
                const folderPath = parts.join("/");
                return { ...r, name, folderPath, fullPath: r.name };
              })
            );
          }

          if (containerDone && container)
            setSearchStatus(done ? "" : `Searching remaining containers…`);
        },
      });
    } catch (err) {
      if (!controller.signal.aborted) console.error("Search error:", err);
    } finally {
      if (!controller.signal.aborted) {
        setSearching(false);
        setSearchStatus("");
      }
    }
  };

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    clearTimeout(searchTimer.current);

    if (!val.trim()) {
      setSearchResults([]);
      setSearching(false);
      setSearchStatus("");
      if (searchAbortRef.current) searchAbortRef.current.abort();
      return;
    }

    if (val.trim().length < 3) return;

    setSearching(true);
    searchTimer.current = setTimeout(() => runSearch(val.trim()), 400);
  };

  /* ── Pagination ── */
  const IMAGES_PER_PAGE = 30;
  const [imagePage, setImagePage] = useState(0);

  /* ── Lightbox ── */
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [lightboxPool,  setLightboxPool]  = useState([]); // images currently being browsed

  const openLightbox = (imgs, idx) => { setLightboxPool(imgs); setLightboxIndex(idx); };
  const closeLightbox = () => setLightboxIndex(null);

  /* ── Lightbox keyboard nav ── */
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

  const [showMap, setShowMap] = useState(false);
  const [mapImages, setMapImages] = useState([]);

  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const baseOSMRef = useRef(null);
  const baseSatRef = useRef(null);
  const layersControlRef = useRef(null);

  const isImageFile = (n) => /\.(jpe?g|png|gif|webp)$/i.test(n);

  /* ── Container probe ── */
  useEffect(() => {
    const loadContainers = async () => {
      const existing = [];
      for (const c of containersToCheck) {
        try {
          const client = getContainerClient(c);
          const iter = client.listBlobsByHierarchy("/");
          await iter.next();
          existing.push(c);
        } catch {}
      }
      setAvailableContainers(existing);
    };
    loadContainers();
  }, []);

  /* ── Folder listing + eager child-check prefetch ── */
  const fetchFolders = async (container, prefix = "") => {
    const key = `${container}/${prefix}`;
    if (folderCache.current.has(key)) {
      setCurrentFolders(folderCache.current.get(key));
      // still kick off prefetch in case child cache is cold
      prefetchChildChecks(container, folderCache.current.get(key));
      return;
    }
    const client = getContainerClient(container);
    const folders = [];
    for await (const item of client.listBlobsByHierarchy("/", {
      prefix: normalizePrefix(prefix),
    })) {
      if (item.kind === "prefix") {
        const cleaned = item.name.replace(/\/$/, "");
        folders.push({ fullPath: cleaned, name: cleaned.split("/").pop() });
      }
    }
    folderCache.current.set(key, folders);
    setCurrentFolders(folders);
    // fire-and-forget: pre-populate childrenCache for all folders in parallel
    prefetchChildChecks(container, folders);
  };

  /* ── Batch child-check (parallel, non-blocking) ── */
  const prefetchChildChecks = (container, folders) => {
    folders.forEach((f) => {
      const key = `${container}/${f.fullPath}`;
      if (childrenCache.current.has(key)) return; // already cached
      const client = getContainerClient(container);
      (async () => {
        let found = false;
        for await (const item of client.listBlobsByHierarchy("/", {
          prefix: normalizePrefix(f.fullPath),
        })) {
          if (item.kind === "prefix") { found = true; break; }
        }
        childrenCache.current.set(key, found);
      })();
    });
  };

  /* ── Child check (has subfolders?) — reads from cache first ── */
  const hasSubfolders = async (container, folderFullPath) => {
    const key = `${container}/${folderFullPath}`;
    if (childrenCache.current.has(key)) return childrenCache.current.get(key);
    const client = getContainerClient(container);
    let foundPrefix = false;
    for await (const item of client.listBlobsByHierarchy("/", {
      prefix: normalizePrefix(folderFullPath),
    })) {
      if (item.kind === "prefix") { foundPrefix = true; break; }
    }
    childrenCache.current.set(key, foundPrefix);
    return foundPrefix;
  };

  /* ── Navigate up ── */
  const navigateUp = async () => {
    if (selectedPath.length === 0) {
      setSelectedContainer(null);
      setCurrentFolders([]);
      setImages([]);
      return;
    }
    const newPath = selectedPath.slice(0, -1);
    setSelectedPath(newPath);
    setImages([]);
    setSelectedImages({});
    await fetchFolders(
      selectedContainer,
      newPath.length ? newPath.at(-1).fullPath + "/" : ""
    );
  };

  /* ── Open folder ── */
  const openFolder = async (folder) => {
    setLoading(true);
    setSelectedPath((p) => [...p, folder]);
    await fetchFolders(selectedContainer, folder.fullPath + "/");
    setImages([]);
    setSelectedImages({});
    setLoading(false);
  };

  /* ── View images ── */
  const viewImages = async (folder) => {
    setLoading(true);
    const client = getContainerClient(selectedContainer);
    const imgs = [];
    for await (const blob of client.listBlobsFlat({
      prefix: normalizePrefix(folder.fullPath),
    })) {
      if (isImageFile(blob.name)) {
        const encoded = encodeBlobPath(blob.name);
        imgs.push({
          name: blob.name.split("/").pop(),
          url: `${baseUrl}/${selectedContainer}/${encoded}?${safeSasToken}`,
        });
      }
    }
    setSelectedPath((p) => [...p, folder]);
    setImages(imgs);
    setCurrentFolders([]);
    setSelectedImages({});
    setImagePage(0); // reset pagination on new folder
    setLoading(false);
  };

  /* ── View map ── */
  const viewMap = async (folder) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setShowMap(true);
    setMapImages([]);
    const client = getContainerClient(selectedContainer);
    const imgs = [];
    for await (const blob of client.listBlobsFlat({
      prefix: normalizePrefix(folder.fullPath),
    })) {
      if (!isImageFile(blob.name)) continue;
      const encoded = encodeBlobPath(blob.name);
      const url = `${baseUrl}/${selectedContainer}/${encoded}?${safeSasToken}`;
      let lat, lon;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const exifData = await exifr.parse(buf, { gps: true });
          if (exifData?.latitude && exifData?.longitude) {
            lat = exifData.latitude;
            lon = exifData.longitude;
          }
        }
      } catch (err) {
        console.log("EXIF fetch error for", blob.name, err);
      }
      if (!lat || !lon) {
        const m = blob.name.match(/([-\d.]+)_([-\d.]+)/);
        if (m) { lat = parseFloat(m[1]); lon = parseFloat(m[2]); }
      }
      if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
        imgs.push({ lat, lon, url, name: blob.name.split("/").pop() });
      }
    }
    setMapImages(imgs);
  };

  /* ── Select helpers ── */
  const selectAll = () => {
    const map = {};
    images.forEach((i) => (map[i.name] = true));
    setSelectedImages(map);
  };
  const clearAll = () => setSelectedImages({});

  /* ── Downloads (delegated to global DownloadContext) ── */
  const { startDownload } = useDownload();

  const downloadFolderZip = () => {
    if (!images.length) return;
    const name = selectedPath.at(-1)?.name || "images";
    startDownload(images, `${name}.zip`);
  };

  const downloadSelectedZip = () => {
    const chosen = images.filter((i) => selectedImages[i.name]);
    if (!chosen.length) return;
    startDownload(chosen, "selected-images.zip");
  };

  /* ── Initialize Leaflet map when overlay opens ── */
  useEffect(() => {
    if (!showMap || !mapRef.current) return;
    if (leafletMap.current) {
      try { leafletMap.current.remove(); } catch {}
      leafletMap.current = null;
    }
    const map = L.map(mapRef.current, { zoomControl: true });
    leafletMap.current = map;
    baseOSMRef.current = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap contributors" }
    ).addTo(map);
    baseSatRef.current = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "© Esri — World Imagery" }
    );
    layersControlRef.current = L.control
      .layers({ Road: baseOSMRef.current, Satellite: baseSatRef.current }, null, {
        position: "bottomright", collapsed: false,
      })
      .addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.setView([0, 0], 2);
    setTimeout(() => map.invalidateSize(), 150);
  }, [showMap]);

  /* ── Render markers whenever mapImages changes ── */
  useEffect(() => {
    if (!showMap || !leafletMap.current) return;
    const map = leafletMap.current;

    map.eachLayer((layer) => {
      if (layer && typeof layer.getLatLng === "function") map.removeLayer(layer);
    });

    if (!mapImages || mapImages.length === 0) {
      map.setView([0, 0], 2);
      setTimeout(() => map.invalidateSize(), 100);
      return;
    }

    let centerLat = 0, centerLon = 0;

    mapImages.forEach((img) => {
      centerLat += img.lat;
      centerLon += img.lon;

      const popupEl = document.createElement("div");
      popupEl.style.textAlign = "center";

      const imageTag = document.createElement("img");
      imageTag.src = img.url;
      imageTag.loading = "eager";
      imageTag.style.maxWidth = "360px";
      imageTag.style.height = "auto";
      imageTag.style.borderRadius = "4px";
      imageTag.style.marginBottom = "8px";

      const marker = L.marker([img.lat, img.lon]).addTo(map);

      imageTag.onerror = () => {
        popupEl.innerHTML = `
          <div style="text-align:center;max-width:380px;word-wrap:break-word;">
            <div style="font-size:12px;color:#333;">${img.name}</div>
            <div style="font-size:11px;color:#555;">${img.lat.toFixed(6)}, ${img.lon.toFixed(6)}</div>
            <div style="font-size:11px;color:#aa0000;margin-top:6px;">Image load error</div>
          </div>`;
        try { marker.getPopup?.()?.update(); } catch {}
      };

      imageTag.onload = () => {
        const nameEl = document.createElement("div");
        nameEl.style.cssText = "font-size:12px;color:#333;font-weight:600;";
        nameEl.textContent = img.name;
        const coordEl = document.createElement("div");
        coordEl.style.cssText = "font-size:11px;color:#555;";
        coordEl.textContent = `${img.lat.toFixed(6)}, ${img.lon.toFixed(6)}`;
        popupEl.innerHTML = "";
        popupEl.appendChild(imageTag);
        popupEl.appendChild(nameEl);
        popupEl.appendChild(coordEl);
        try { marker.getPopup?.()?.update(); } catch {}
      };

      popupEl.appendChild(imageTag);
      marker.bindPopup(popupEl, {
        maxWidth: 420,
        autoPanPaddingTopLeft: [30, 30],
        autoPanPaddingBottomRight: [30, 30],
      });
    });

    centerLat /= mapImages.length;
    centerLon /= mapImages.length;

    setTimeout(() => {
      if (!leafletMap.current) return;
      const tmp = L.circle([centerLat, centerLon], { radius: 500 }).addTo(map);
      map.fitBounds(tmp.getBounds(), { padding: [40, 40], maxZoom: 16 });
      map.removeLayer(tmp);
      map.invalidateSize();
    }, 200);
  }, [mapImages, showMap]);

  /* ── Map cleanup on close ── */
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setShowMap(false);
    if (showMap) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", onKey);
    } else {
      document.body.style.overflow = "";
      if (leafletMap.current) {
        try { leafletMap.current.remove(); } catch {}
        leafletMap.current = null;
        baseOSMRef.current = null;
        baseSatRef.current = null;
        layersControlRef.current = null;
      }
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [showMap]);

  return {
    searchQuery, searchResults, searching, searchStatus,
    handleSearchChange,

    IMAGES_PER_PAGE, imagePage, setImagePage,

    lightboxIndex, lightboxPool, openLightbox, closeLightbox,

    navigate,

    containerPage,
    setContainerPage,

    availableContainers,
    selectedContainer,
    setSelectedContainer,

    selectedPath,
    setSelectedPath,
    currentFolders,
    images,
    setImages,
    selectedImages,
    setSelectedImages,

    loading,

    showMap,
    setShowMap,

    mapImages,
    mapRef,

    CONTAINERS_PER_PAGE,

    fetchFolders,
    navigateUp,
    openFolder,
    viewImages,
    viewMap,        // ← was missing
    hasSubfolders,  // ← was missing

    selectAll,
    clearAll,

    downloadFolderZip,
    downloadSelectedZip,
  };
}