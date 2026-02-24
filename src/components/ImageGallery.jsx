
// src/components/ImageGallery.jsx
import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import exifr from "exifr";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Home, X, Folder, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getContainerClient, normalizePrefix, baseUrl, sasToken } from "../azureBlob";

/* ============== Leaflet icon patch for bundlers ============== */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

/* ================= PATCH: SAS normalization + path encoding ================= */
// Normalize HTML-escaped ampersands in SAS (prevents bad query strings if token came from HTML)
const safeSasToken = String(sasToken || "").replace(/&amp;/g, "&");

// Encode a blob path by encoding each path segment (keeps "/" as delimiters)
function encodeBlobPath(name) {
  return String(name || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export default function ImageGallery() {
  const navigate = useNavigate();

  /* ================= CONFIG ================= */
  const containersToCheck = ["raw", "processed", "projects", "uploads", "issued"];

  /* ================= STYLES ================= */
  const glass =
    "bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl rounded-2xl";

  /* ================= HELPERS ================= */
  const isImageFile = (n) => /\.(jpe?g|png|gif|webp)$/i.test(n);

  /* ================= STATE ================= */
  const CONTAINERS_PER_PAGE = 9;
  const [containerPage, setContainerPage] = useState(0);
  const [availableContainers, setAvailableContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState(null);

  const [selectedPath, setSelectedPath] = useState([]); // [{ fullPath, name }]
  const [currentFolders, setCurrentFolders] = useState([]);
  const [images, setImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState({});
  const [loading, setLoading] = useState(false);

  /* ================= CACHE ================= */
  const folderCache = useRef(new Map());
  const childrenCache = useRef(new Map());

  /* ================= MAP ================= */
  const [showMap, setShowMap] = useState(false);
  const [mapImages, setMapImages] = useState([]);
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const baseOSMRef = useRef(null);
  const baseSatRef = useRef(null);
  const layersControlRef = useRef(null);

  /* ================= CONTAINERS (existence via listing probe) ================= */
  useEffect(() => {
    const loadContainers = async () => {
      const existing = [];
      for (const c of containersToCheck) {
        try {
          const client = getContainerClient(c);
          // Probe listing once; avoids HEAD ?restype=container (which can 403 under CORS).
          const iter = client.listBlobsByHierarchy("/");
          await iter.next();
          existing.push(c);
        } catch (err) {
          console.log(`Skipping container ${c}:`, err?.message);
        }
      }
      setAvailableContainers(existing);
    };
    loadContainers();
  }, []);

  /* ================= FOLDER LISTING (CACHED) ================= */
  const fetchFolders = async (container, prefix = "") => {
    const key = `${container}/${prefix}`;
    if (folderCache.current.has(key)) {
      setCurrentFolders(folderCache.current.get(key));
      return;
    }
    const client = getContainerClient(container);
    const folders = [];
    for await (const item of client.listBlobsByHierarchy("/", { prefix: normalizePrefix(prefix) })) {
      if (item.kind === "prefix") {
        // Strip trailing slash BEFORE computing name, or it may render blank.
        const cleaned = item.name.replace(/\/$/, "");
        folders.push({ fullPath: cleaned, name: cleaned.split("/").pop() });
      }
    }
    folderCache.current.set(key, folders);
    setCurrentFolders(folders);
  };

  /* ================= CHILD CHECK (has subfolders?) ================= */
  const hasSubfolders = async (container, folderFullPath) => {
    const key = `${container}/${folderFullPath}`;
    if (childrenCache.current.has(key)) return childrenCache.current.get(key);
    const client = getContainerClient(container);
    let foundPrefix = false;
    for await (const item of client.listBlobsByHierarchy("/", { prefix: normalizePrefix(folderFullPath) })) {
      if (item.kind === "prefix") {
        foundPrefix = true;
        break;
      }
    }
    childrenCache.current.set(key, foundPrefix);
    return foundPrefix;
  };

  /* ================= BREADCRUMB NAV ================= */
  const navigateUp = async () => {
    if (selectedPath.length === 0) {
      setSelectedContainer(null);
      setSelectedPath([]);
      setImages([]);
      setSelectedImages({});
      setCurrentFolders([]);
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

  /* ================= OPEN FOLDER ================= */
  const openFolder = async (folder) => {
    setLoading(true);
    setSelectedPath((p) => [...p, folder]);
    await fetchFolders(selectedContainer, folder.fullPath + "/");
    setImages([]);
    setSelectedImages({});
    setLoading(false);
  };

  /* ================= VIEW IMAGES ================= */
  const viewImages = async (folder) => {
    setLoading(true);
    const client = getContainerClient(selectedContainer);
    const imgs = [];
    for await (const blob of client.listBlobsFlat({ prefix: normalizePrefix(folder.fullPath) })) {
      if (isImageFile(blob.name)) {
        // PATCH: encode path segments so spaces/specials render in <img src>
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
    setLoading(false);
  };

  /* ================= SELECT ALL / CLEAR ALL ================= */
  const selectAll = () => {
    const map = {};
    images.forEach((img) => (map[img.name] = true));
    setSelectedImages(map);
  };
  const clearAll = () => setSelectedImages({});

  /* ================= ZIP HELPERS ================= */
  const zipImages = async (imgs, zipName) => {
    const zip = new JSZip();
    for (const img of imgs) {
      const res = await fetch(img.url);
      if (!res.ok) {
        console.warn("Skip (fetch failed):", img.url, res.status);
        continue;
      }
      const blob = await res.blob();
      zip.file(img.name, blob);
    }
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, zipName);
  };
  const downloadFolderZip = () => {
    if (!images || images.length === 0) return;
    const folderName = selectedPath.at(-1)?.name || "images";
    return zipImages(images, `${folderName}.zip`);
  };
  const downloadSelectedZip = () => {
    const chosen = images.filter((i) => selectedImages[i.name]);
    if (!chosen.length) return;
    return zipImages(chosen, "selected-images.zip");
  };

  /* ================= MAP ================= */
  const viewMap = async (folder) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setShowMap(true);
    setMapImages([]);
    const client = getContainerClient(selectedContainer);
    const imgs = [];
    for await (const blob of client.listBlobsFlat({ prefix: normalizePrefix(folder.fullPath) })) {
      if (!isImageFile(blob.name)) continue;
      // PATCH: encode path segments for the popup image URL
      const encoded = encodeBlobPath(blob.name);
      const url = `${baseUrl}/${selectedContainer}/${encoded}?${safeSasToken}`;
      let lat, lon;
      // Try EXIF first (GPS)
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const exifData = await exifr.parse(buf, { gps: true });
          if (exifData?.latitude && exifData?.longitude) {
            lat = exifData.latitude;
            lon = exifData.longitude;
          }
        } else {
          console.warn("EXIF fetch failed:", url, res.status);
        }
      } catch (err) {
        console.log("EXIF fetch error for", blob.name, err);
      }
      // Fallback: parse "lat_lon" in filename
      if (!lat || !lon) {
        const m = blob.name.match(/([-\d.]+)_([-\d.]+)/);
        if (m) {
          lat = parseFloat(m[1]);
          lon = parseFloat(m[2]);
        }
      }
      if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
        imgs.push({ lat, lon, url, name: blob.name.split("/").pop() });
      }
    }
    setMapImages(imgs);
  };

  /* ================= INITIALIZE MAP ================= */
  useEffect(() => {
    if (!showMap || !mapRef.current) return;
    if (leafletMap.current) {
      try {
        leafletMap.current.remove();
      } catch {}
      leafletMap.current = null;
      baseOSMRef.current = null;
      baseSatRef.current = null;
      layersControlRef.current = null;
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
        position: "bottomright",
        collapsed: false,
      })
      .addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.setView([0, 0], 2);
    setTimeout(() => map.invalidateSize(), 150);
  }, [showMap]);

  /* ================= RENDER MARKERS (patch: render image directly, eager load, resize popup) ================= */
  useEffect(() => {
    if (!showMap || !leafletMap.current) return;
    const map = leafletMap.current;

    // Remove prior markers (robustly)
    map.eachLayer((layer) => {
      if (layer && typeof layer.getLatLng === "function") {
        map.removeLayer(layer);
      }
    });

    if (!mapImages || mapImages.length === 0) {
      map.setView([0, 0], 2);
      setTimeout(() => map.invalidateSize(), 100);
      return;
    }

    let centerLat = 0,
      centerLon = 0;

    mapImages.forEach((img) => {
      centerLat += img.lat;
      centerLon += img.lon;

      // Build DOM popup node and render the image directly
      const popupEl = document.createElement("div");
      popupEl.style.textAlign = "center";

      const imageTag = document.createElement("img");
      imageTag.src = img.url; // already encoded path + clean SAS
      imageTag.loading = "eager"; // prevent deferred load events
      imageTag.style.maxWidth = "360px"; // widen image (adjust to taste)
      imageTag.style.height = "auto";
      imageTag.style.borderRadius = "4px";
      imageTag.style.marginBottom = "8px";

      // Create marker first so we can call popup.update() later
      const marker = L.marker([img.lat, img.lon]).addTo(map);

      // Fallback if image load fails
      imageTag.onerror = () => {
        popupEl.innerHTML = `
          <div style="text-align:center;max-width:380px;word-wrap:break-word;">
            <div style="font-size:12px;color:#333;">${img.url}</div>
            <div style="font-size:12px;color:#333;font-weight:600;">${img.name}</div>
            <div style="font-size:11px;color:#555;">${img.lat.toFixed(6)}, ${img.lon.toFixed(6)}</div>
            <div style="font-size:11px;color:#aa0000;margin-top:6px;">Image load error</div>
          </div>
        `;
        try {
          const popup = marker.getPopup?.();
          popup && popup.update();
        } catch {}
      };

      // If it loads, append name/coords and force popup size recompute
      imageTag.onload = () => {
        const nameEl = document.createElement("div");
        nameEl.style.fontSize = "12px";
        nameEl.style.color = "#333";
        nameEl.style.fontWeight = "600";
        nameEl.textContent = img.name;

        const coordEl = document.createElement("div");
        coordEl.style.fontSize = "11px";
        coordEl.style.color = "#555";
        coordEl.textContent = `${img.lat.toFixed(6)}, ${img.lon.toFixed(6)}`;

        popupEl.innerHTML = "";
        popupEl.appendChild(imageTag);
        popupEl.appendChild(nameEl);
        popupEl.appendChild(coordEl);

        // After the image settles, force Leaflet to recompute popup size.
        try {
          const popup = marker.getPopup?.();
          popup && popup.update();
        } catch {}
      };

      // Start with the image tag (browser handles the load)
      popupEl.appendChild(imageTag);

      marker.bindPopup(popupEl, {
        maxWidth: 420, // more horizontal room than Leaflet default (300)
        className: "gallery-popup", // custom class for CSS overrides
        autoPanPaddingTopLeft: [30, 30],
        autoPanPaddingBottomRight: [30, 30],
      });
    });

    centerLat /= mapImages.length;
    centerLon /= mapImages.length;

    setTimeout(() => {
      if (!leafletMap.current) return;
      const tempCircle = L.circle([centerLat, centerLon], { radius: 500 }).addTo(map);
      const bounds = tempCircle.getBounds();
      map.removeLayer(tempCircle);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      map.invalidateSize();
    }, 200);
  }, [mapImages, showMap]);

  /* ================= MAP CLEANUP ================= */
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setShowMap(false);
    if (showMap) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", onKey);
    } else {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      if (leafletMap.current) {
        try {
          leafletMap.current.remove();
        } catch {}
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

  /* ================= UI ================= */
  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8 text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Azure Image Gallery</h2>
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-white"
        >
          <Home size={18} />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* Container grid */}
      {!selectedContainer && (
        <div>
          <div className="mb-2 text-sm opacity-80">Containers</div>
          <div className="grid md:grid-cols-3 gap-6">
            {availableContainers
              .slice(
                containerPage * CONTAINERS_PER_PAGE,
                (containerPage + 1) * CONTAINERS_PER_PAGE
              )
              .map((c) => (
                <div
                  key={c}
                  className={`${glass} p-6 cursor-pointer hover:bg-white/20 transition text-black`}
                  onClick={() => {
                    setSelectedContainer(c);
                    fetchFolders(c);
                    setSelectedPath([]);
                    setImages([]);
                    setSelectedImages({});
                  }}
                >
                  <div className="flex items-center gap-2 text-lg font-medium">
                    <Folder size={18} className="text-yellow-400" />
                    {c}
                  </div>
                  <div className="text-xs opacity-70 mt-1">Container</div>
                </div>
              ))}
          </div>
          {availableContainers.length > CONTAINERS_PER_PAGE && (
            <div className="flex justify-end gap-2 mt-4">
              <button
                disabled={containerPage === 0}
                onClick={() => setContainerPage((p) => p - 1)}
                className={`${glass} px-4 py-2 disabled:opacity-40`}
              >
                Prev
              </button>
              <button
                disabled={
                  (containerPage + 1) * CONTAINERS_PER_PAGE >= availableContainers.length
                }
                onClick={() => setContainerPage((p) => p + 1)}
                className={`${glass} px-4 py-2 disabled:opacity-40`}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inside a container */}
      {selectedContainer && (
        <>
          {/* Container header (black text) */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-80">Container:</span>
              <span className="font-semibold text-black">{selectedContainer}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={navigateUp}
                className={`${glass} px-3 py-1 text-sm hover:bg-white/20 transition flex items-center gap-1`}
              >
                ↑ Up
              </button>
            </div>
            {selectedPath.length > 0 && (
              <div className="text-sm opacity-70">
                Current: {selectedPath.map((p) => p.name).join(" / ")}
              </div>
            )}
          </div>

          {/* Folder grid (black text) */}
          {images.length === 0 && currentFolders.length > 0 && (
            <div>
              <div className="grid md:grid-cols-3 gap-4">
                {currentFolders.map((f) => (
                  <FolderCard
                    key={f.fullPath}
                    folder={f}
                    glass={glass}
                    selectedContainer={selectedContainer}
                    openFolder={openFolder}
                    viewImages={viewImages}
                    viewMap={viewMap}
                    hasSubfolders={hasSubfolders}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Loading / empty states */}
          {images.length === 0 && currentFolders.length === 0 && loading && (
            <div className="text-center py-8">
              <div className="text-sm opacity-80">Loading folders...</div>
            </div>
          )}
          {images.length === 0 && currentFolders.length === 0 && !loading && (
            <div className="text-center py-8">
              <div className="text-sm opacity-80">No folders found</div>
            </div>
          )}

          {/* Images view + actions */}
          {images.length > 0 && (
            <div>
              {/* Action bar */}
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={downloadFolderZip}
                  className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition"
                >
                  <Download size={16} />
                  <span>Download folder (.zip)</span>
                </button>
                <button
                  disabled={!images.some((i) => selectedImages[i.name])}
                  onClick={downloadSelectedZip}
                  className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download size={16} />
                  <span>Download selected (.zip)</span>
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={selectAll}
                    className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition"
                  >
                    Select all
                  </button>
                  <button
                    onClick={clearAll}
                    className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition"
                  >
                    Clear all
                  </button>
                </div>
              </div>

              {/* Grid */}
              <div className="grid md:grid-cols-3 gap-4">
                {images.map((img) => (
                  <div key={img.name} className={`${glass} p-2 text-black`}>
                    <label className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={!!selectedImages[img.name]}
                        onChange={(e) =>
                          setSelectedImages((s) => ({ ...s, [img.name]: e.target.checked }))
                        }
                      />
                      <span className="text-sm">{img.name}</span>
                    </label>
                    <img src={img.url} alt={img.name} className="w-full h-auto rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Map overlay */}
          {showMap && (
            <div
              className="fixed inset-0 bg-black/60 z-[9999]"
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
              }}
              onClick={() => setShowMap(false)}
            >
              <div
                className={`${glass} relative text-white`}
                style={{ width: "100%", maxWidth: "56rem", height: "70vh", maxHeight: "70vh" }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="absolute top-3 right-3 p-2 rounded-lg hover:bg-white/20 z-[10000] bg-white/10"
                  aria-label="Close"
                  onClick={() => setShowMap(false)}
                >
                  <X size={20} />
                </button>
                <div ref={mapRef} className="w-full h-full rounded-xl overflow-hidden" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============== FolderCard (black text) ============== */
function FolderCard({
  folder,
  glass,
  selectedContainer,
  openFolder,
  viewImages,
  viewMap,
  hasSubfolders,
}) {
  const [childCheck, setChildCheck] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await hasSubfolders(selectedContainer, folder.fullPath);
      if (mounted) setChildCheck(res);
    })();
    return () => {
      mounted = false;
    };
  }, [selectedContainer, folder.fullPath, hasSubfolders]);

  return (
    <div className={`${glass} p-4 text-black`}>
      <div className="mb-1 font-medium flex items-center gap-2">
        <Folder size={18} className="text-yellow-400" />
        {folder.name}
      </div>
      {childCheck === null && (
        <div className="mt-2 text-xs opacity-70">Checking folder…</div>
      )}
      {childCheck === true && (
        <div className="mt-3 flex gap-2">
          <button className={`${glass} px-3 py-2`} onClick={() => openFolder(folder)}>
            Open
          </button>
        </div>
      )}
      {childCheck === false && (
        <div className="mt-3 flex gap-2">
          <button className={`${glass} px-3 py-2`} onClick={() => viewMap(folder)}>
            View Map
          </button>
          <button className={`${glass} px-3 py-2`} onClick={() => viewImages(folder)}>
            View Images
          </button>
        </div>
      )}
    </div>
  );
}
