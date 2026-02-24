// src/components/ImageGallery.jsx
import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import exifr from "exifr";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Folder,
  Download,
  Image as ImageIcon,
  Map as MapIcon,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  getContainerClient,
  normalizePrefix,
  baseUrl,
  sasToken,
} from "../azureBlob";

/* ================= CONFIG ================= */
const CONTAINERS = ["raw", "processed", "projects", "uploads", "issued"];
const LIST_LIMIT = 50;

/* ================= STYLES ================= */
const glass =
  "bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl rounded-2xl";

/* ================= LEAFLET FIX ================= */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

export default function ImageGallery() {
  const navigate = useNavigate();

  /* ================= STATE ================= */
  const [availableContainers, setAvailableContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [selectedPath, setSelectedPath] = useState([]);
  const [currentFolders, setCurrentFolders] = useState([]);
  const [images, setImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState({});
  const [loading, setLoading] = useState(false);

  /* ================= MAP ================= */
  const [showMap, setShowMap] = useState(false);
  const [mapImages, setMapImages] = useState([]);
  const mapRef = useRef(null);
  const leafletMap = useRef(null);

  /* ================= HELPERS ================= */
  const isImage = (n) => /\.(jpe?g|png|webp)$/i.test(n);

  /* ================= CONTAINER PROBE ================= */
  useEffect(() => {
    (async () => {
      const valid = [];
      for (const c of CONTAINERS) {
        try {
          const client = getContainerClient(c);
          const it = client.listBlobsFlat({ maxPageSize: 1 });
          await it.next();
          valid.push(c);
        } catch {}
      }
      setAvailableContainers(valid);
    })();
  }, []);

  /* ================= LIST FOLDERS ================= */
  const fetchFolders = async (container, prefix = "") => {
    setLoading(true);
    const client = getContainerClient(container);
    const folders = [];
    let count = 0;

    for await (const item of client.listBlobsByHierarchy("/", {
      prefix: normalizePrefix(prefix),
      maxPageSize: LIST_LIMIT,
    })) {
      if (item.kind === "prefix") {
        const clean = item.name.replace(/\/$/, "");
        folders.push({
          fullPath: clean,
          name: clean.split("/").pop(),
        });
        if (++count >= LIST_LIMIT) break;
      }
    }

    setCurrentFolders(folders);
    setLoading(false);
  };

  /* ================= OPEN FOLDER ================= */
  const openFolder = async (folder) => {
    setSelectedPath((p) => [...p, folder]);
    setImages([]);
    await fetchFolders(selectedContainer, folder.fullPath + "/");
  };

  /* ================= VIEW IMAGES ================= */
  const viewImages = async (folder) => {
    setLoading(true);
    const client = getContainerClient(selectedContainer);
    const imgs = [];

    for await (const blob of client.listBlobsFlat({
      prefix: normalizePrefix(folder.fullPath),
      maxPageSize: LIST_LIMIT,
    })) {
      if (isImage(blob.name)) {
        imgs.push({
          name: blob.name.split("/").pop(),
          url: `${baseUrl}/${selectedContainer}/${blob.name}?${sasToken}`,
        });
      }
    }

    setSelectedPath((p) => [...p, folder]);
    setImages(imgs);
    setCurrentFolders([]);
    setSelectedImages({});
    setLoading(false);
  };

  /* ================= ZIP ================= */
  const zipImages = async (imgs, name) => {
    const zip = new JSZip();
    for (const img of imgs) {
      const res = await fetch(img.url);
      if (res.ok) zip.file(img.name, await res.blob());
    }
    saveAs(await zip.generateAsync({ type: "blob" }), name);
  };

  const downloadAll = () => zipImages(images, "folder-images.zip");
  const downloadSelected = () =>
    zipImages(
      images.filter((i) => selectedImages[i.name]),
      "selected-images.zip"
    );

  /* ================= VIEW MAP ================= */
  const viewMap = async (folder) => {
    setShowMap(true);
    setMapImages([]);
    const imgs = [];
    const client = getContainerClient(selectedContainer);

    for await (const blob of client.listBlobsFlat({
      prefix: normalizePrefix(folder.fullPath),
      maxPageSize: LIST_LIMIT,
    })) {
      if (!isImage(blob.name)) continue;

      try {
        const url = `${baseUrl}/${selectedContainer}/${blob.name}?${sasToken}`;
        const buf = await (await fetch(url)).arrayBuffer();
        const exif = await exifr.parse(buf, { gps: true });
        if (exif?.latitude && exif?.longitude) {
          imgs.push({
            lat: exif.latitude,
            lon: exif.longitude,
            name: blob.name.split("/").pop(),
            url,
          });
        }
      } catch {}
    }

    setMapImages(imgs);
  };

  /* ================= MAP INIT ================= */
  useEffect(() => {
    if (!showMap || !mapRef.current) return;

    leafletMap.current = L.map(mapRef.current).setView([0, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(leafletMap.current);
  }, [showMap]);

  /* ================= MAP MARKERS ================= */
  useEffect(() => {
    if (!leafletMap.current) return;
    mapImages.forEach((img) =>
      L.marker([img.lat, img.lon])
        .addTo(leafletMap.current)
        .bindPopup(`<img src="${img.url}" width="220"/><br/>${img.name}`)
    );
  }, [mapImages]);

  /* ================= UI ================= */
  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8 text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Azure Image Gallery</h2>
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-fg/80"
        >
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
            className="lucide lucide-house"
            aria-hidden="true"
          >
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* Info Panel */}
      <div className="mb-6 p-4 bg-white/10 rounded-lg border border-glass-border">
        {!selectedContainer && (
          <div className="text-sm opacity-80">
            Select a container to browse imagery.
          </div>
        )}
        {selectedContainer && (
          <div className="text-sm">
            <span className="opacity-70">Container:</span>{" "}
            <span className="font-semibold">{selectedContainer}</span>
            {selectedPath.length > 0 && (
              <>
                {" "}
                / {selectedPath.map((p) => p.name).join(" / ")}
              </>
            )}
          </div>
        )}
      </div>

      {/* Containers */}
      {!selectedContainer && (
        <div className="grid md:grid-cols-3 gap-6">
          {availableContainers.map((c) => (
            <div
              key={c}
              className={`${glass} p-6 cursor-pointer hover:bg-white/20`}
              onClick={() => {
                setSelectedContainer(c);
                fetchFolders(c);
              }}
            >
              <div className="flex items-center gap-2 text-lg font-medium">
                <Folder className="text-yellow-400" />
                {c}
              </div>
              <div className="text-xs opacity-70 mt-1">Container</div>
            </div>
          ))}
        </div>
      )}

      {/* Folders */}
      {selectedContainer && currentFolders.length > 0 && (
        <div className="grid md:grid-cols-3 gap-6">
          {currentFolders.map((f) => (
            <div key={f.fullPath} className={`${glass} p-5`}>
              <div className="flex items-center gap-2 mb-3">
                <Folder className="text-yellow-400" />
                <span className="font-medium">{f.name}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openFolder(f)}
                  className={`${glass} px-3 py-2`}
                >
                  Open
                </button>
                <button
                  onClick={() => viewImages(f)}
                  className={`${glass} px-3 py-2 flex items-center gap-1`}
                >
                  <ImageIcon size={16} /> Images
                </button>
                <button
                  onClick={() => viewMap(f)}
                  className={`${glass} px-3 py-2 flex items-center gap-1`}
                >
                  <MapIcon size={16} /> Map
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Images */}
      {images.length > 0 && (
        <>
          <div className="flex gap-3 my-4">
            <button
              onClick={downloadAll}
              className={`${glass} px-4 py-2 flex items-center gap-2`}
            >
              <Download size={16} /> Download Folder
            </button>
            <button
              onClick={downloadSelected}
              className={`${glass} px-4 py-2 flex items-center gap-2`}
            >
              <Download size={16} /> Download Selected
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {images.map((img) => (
              <div key={img.name} className={`${glass} p-2`}>
                <label className="flex gap-2 text-sm mb-2">
                  <input
                    type="checkbox"
                    onChange={(e) =>
                      setSelectedImages((s) => ({
                        ...s,
                        [img.name]: e.target.checked,
                      }))
                    }
                  />
                  {img.name}
                </label>
                <img
                  src={img.url}
                  loading="lazy"
                  className="rounded-lg w-full"
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Map Overlay */}
      {showMap && (
        <div className="fixed inset-0 bg-black/70 z-[9999] p-4">
          <div className={`${glass} relative h-full`}>
            <button
              onClick={() => setShowMap(false)}
              className="absolute top-3 right-3"
            >
              <X />
            </button>
            <div ref={mapRef} className="w-full h-full rounded-xl" />
          </div>
        </div>
      )}
    </div>
  );
}
