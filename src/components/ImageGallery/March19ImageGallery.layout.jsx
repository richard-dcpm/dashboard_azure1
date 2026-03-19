import { useState, useEffect, useRef } from "react";
import { Home, X, Folder, Download, Search, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { useDownload } from "../DownloadContext";

const glass = "bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl rounded-2xl";

/* ── FolderCard ── */
function FolderCard({ folder, selectedContainer, openFolder, viewImages, viewMap, hasSubfolders }) {
  const [childCheck, setChildCheck] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await hasSubfolders(selectedContainer, folder.fullPath);
      if (mounted) setChildCheck(res);
    })();
    return () => { mounted = false; };
  }, [selectedContainer, folder.fullPath, hasSubfolders]);

  return (
    <div className={`${glass} p-4 text-black`}>
      <div className="mb-1 font-medium flex items-center gap-2">
        <Folder size={18} className="text-yellow-400" />
        {folder.name}
      </div>
      {childCheck === null && <div className="mt-2 text-xs opacity-70">Checking folder…</div>}
      {childCheck === true && (
        <div className="mt-3 flex gap-2">
          <button className={`${glass} px-3 py-2`} onClick={() => openFolder(folder)}>Open</button>
        </div>
      )}
      {childCheck === false && (
        <div className="mt-3 flex gap-2">
          <button className={`${glass} px-3 py-2`} onClick={() => viewMap(folder)}>View Map</button>
          <button className={`${glass} px-3 py-2`} onClick={() => viewImages(folder)}>View Images</button>
        </div>
      )}
    </div>
  );
}

/* ── Lightbox ── */
function Lightbox({ images, index, onClose, onPrev, onNext }) {
  if (index === null || !images[index]) return null;
  const img = images[index];
  return (
    <div
      className="fixed inset-0 bg-black/90 z-[99999] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white z-10"
        onClick={onClose}
      >
        <X size={22} />
      </button>

      {/* Counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
        {index + 1} / {images.length}
      </div>

      {/* Prev */}
      {index > 0 && (
        <button
          className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Image */}
      <div className="max-w-5xl max-h-[85vh] px-16" onClick={(e) => e.stopPropagation()}>
        <img
          src={img.url}
          alt={img.name}
          className="max-h-[80vh] max-w-full object-contain rounded-xl shadow-2xl"
        />
        <div className="text-white/80 text-sm text-center mt-3">{img.name}</div>
      </div>

      {/* Next */}
      {index < images.length - 1 && (
        <button
          className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
        >
          <ChevronRight size={28} />
        </button>
      )}
    </div>
  );
}

/* ── ImageGrid (with pagination) ── */
function ImageGrid({ images, selectedImages, setSelectedImages, openLightbox, IMAGES_PER_PAGE, imagePage, setImagePage }) {
  const totalPages = Math.ceil(images.length / IMAGES_PER_PAGE);
  const pageImgs   = images.slice(imagePage * IMAGES_PER_PAGE, (imagePage + 1) * IMAGES_PER_PAGE);
  const pageOffset = imagePage * IMAGES_PER_PAGE;

  return (
    <div>
      <div className="grid md:grid-cols-3 gap-4">
        {pageImgs.map((img, i) => (
          <div key={img.name} className={`${glass} p-2 text-black`}>
            <label className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={!!selectedImages[img.name]}
                onChange={(e) => setSelectedImages((s) => ({ ...s, [img.name]: e.target.checked }))}
              />
              <span className="text-sm truncate">{img.name}</span>
            </label>
            <img
              src={img.url}
              alt={img.name}
              className="w-full h-40 object-cover rounded-lg cursor-zoom-in hover:opacity-90 transition"
              onClick={() => openLightbox(images, pageOffset + i)}
            />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <span className="text-sm opacity-70">
            {imagePage * IMAGES_PER_PAGE + 1}–{Math.min((imagePage + 1) * IMAGES_PER_PAGE, images.length)} of {images.length} images
          </span>
          <div className="flex gap-2">
            <button
              disabled={imagePage === 0}
              onClick={() => setImagePage((p) => p - 1)}
              className={`${glass} px-4 py-2 flex items-center gap-1 disabled:opacity-40`}
            >
              <ChevronLeft size={16} /> Prev
            </button>
            {Array.from({ length: totalPages }, (_, n) => (
              <button
                key={n}
                onClick={() => setImagePage(n)}
                className={`${glass} px-3 py-2 text-sm ${n === imagePage ? "bg-white/30 font-bold" : ""}`}
              >
                {n + 1}
              </button>
            ))}
            <button
              disabled={imagePage >= totalPages - 1}
              onClick={() => setImagePage((p) => p + 1)}
              className={`${glass} px-4 py-2 flex items-center gap-1 disabled:opacity-40`}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Search Results ── */
function SearchResults({ results, searching, searchStatus, query,
  setSelectedContainer, fetchFolders, setSelectedPath, setImages,
  setSelectedImages, openLightbox, viewImages, startDownload }) {
  if (!query.trim()) return null;

  const [selected, setSelected] = useState({});

  // reset selection when results change
  useEffect(() => setSelected({}), [results]);

  const toggleOne  = (url) => setSelected((s) => ({ ...s, [url]: !s[url] }));
  const selectAll  = () => { const m = {}; results.forEach((r) => (m[r.url] = true)); setSelected(m); };
  const clearAll   = () => setSelected({});
  const anySelected = results.some((r) => selected[r.url]);

  const downloadSelected = () => {
    const imgs = results.filter((r) => selected[r.url]).map((r) => ({ name: r.name, url: r.url }));
    if (imgs.length) startDownload(imgs, "search-selected.zip");
  };
  const downloadAll = () => {
    const imgs = results.map((r) => ({ name: r.name, url: r.url }));
    if (imgs.length) startDownload(imgs, `search-${query.trim()}.zip`);
  };

  const navigateToFolder = (r, setSelectedContainer, fetchFolders, setSelectedPath, setImages, setSelectedImages, viewImages) => {
    setSelectedContainer(r.container);
    const pathSegments = r.folderPath
      .split("/").filter(Boolean)
      .reduce((acc, seg, idx, arr) => {
        const fullPath = arr.slice(0, idx + 1).join("/");
        return [...acc, { name: seg, fullPath }];
      }, []);
    // Navigate into folder and load images directly
    const folder = { name: pathSegments.at(-1)?.name || r.container, fullPath: r.folderPath };
    setSelectedPath(pathSegments.slice(0, -1));
    setImages([]);
    setSelectedImages({});
    viewImages(folder);
  };

  return (
    <div className={`${glass} p-4 mb-6`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {searching ? (
            <>
              <Loader2 size={15} className="animate-spin shrink-0" />
              <span>{searchStatus || "Searching…"}</span>
              {results.length > 0 && <span className="ml-2 text-blue-300">{results.length} found so far…</span>}
            </>
          ) : (
            <>
              <Search size={15} className="shrink-0" />
              <span>{results.length} result{results.length !== 1 ? "s" : ""} for "</span>
              <span className="text-blue-300">{query}</span>"
            </>
          )}
        </div>

        {/* Bulk actions — only when there are results */}
        {results.length > 0 && !searching && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={selectAll}  className={`${glass} px-3 py-1 text-xs hover:bg-white/20 transition`}>Select all</button>
            <button onClick={clearAll}   className={`${glass} px-3 py-1 text-xs hover:bg-white/20 transition`}>Clear</button>
            <button
              disabled={!anySelected}
              onClick={downloadSelected}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-xl border border-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Download size={13} /> Download selected
            </button>
            <button
              onClick={downloadAll}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-500/30 hover:bg-blue-500/50 rounded-xl border border-blue-400/30 transition"
            >
              <Download size={13} /> Download all ({results.length})
            </button>
          </div>
        )}
      </div>

      {!searching && results.length === 0 && (
        <div className="text-sm opacity-60">No images found matching your search.</div>
      )}

      {results.length > 0 && (
        <div className="grid md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {results.map((r, i) => (
            <div
              key={`${r.container}/${r.fullPath}`}
              className={`${glass} p-2 transition ${selected[r.url] ? "ring-2 ring-blue-400" : ""}`}
            >
              {/* Path link — navigates to folder and loads images */}
              <button
                className="text-xs text-blue-300 hover:text-blue-200 mb-2 text-left w-full truncate flex items-center gap-1"
                title={`Open: ${r.container} / ${r.folderPath}`}
                onClick={() => navigateToFolder(r, setSelectedContainer, fetchFolders, setSelectedPath, setImages, setSelectedImages, viewImages)}
              >
                <Folder size={11} className="text-yellow-400 shrink-0" />
                {r.container}{r.folderPath ? ` / ${r.folderPath}` : ""}
              </button>

              {/* Thumbnail — click to lightbox, checkbox overlay */}
              <div className="relative">
                <img
                  src={r.url}
                  alt={r.name}
                  className="w-full h-32 object-cover rounded-lg cursor-zoom-in hover:opacity-90 transition"
                  onClick={() => openLightbox(results, i)}
                />
                <input
                  type="checkbox"
                  checked={!!selected[r.url]}
                  onChange={() => toggleOne(r.url)}
                  className="absolute top-2 left-2 w-4 h-4 cursor-pointer accent-blue-400"
                />
              </div>
              <div className="text-xs mt-1 truncate opacity-70">{r.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Layout ── */
export default function ImageGalleryLayout(props) {
	const { startDownload } = useDownload();
    const {
    navigate,
    availableContainers, selectedContainer, setSelectedContainer,
    containerPage, setContainerPage, CONTAINERS_PER_PAGE,
    selectedPath, setSelectedPath, currentFolders,
    images, setImages, selectedImages, setSelectedImages, loading,
    fetchFolders, navigateUp, openFolder, viewImages, viewMap, hasSubfolders,
    selectAll, clearAll, downloadFolderZip, downloadSelectedZip,
    showMap, setShowMap, mapRef,
    searchQuery, searchResults, searching, searchStatus, handleSearchChange,
    IMAGES_PER_PAGE, imagePage, setImagePage,
    lightboxIndex, lightboxPool, openLightbox, closeLightbox,
  } = props;

  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8 text-white">

      {/* Lightbox */}
      <Lightbox
        images={lightboxPool}
        index={lightboxIndex}
        onClose={closeLightbox}
        onPrev={() => props.openLightbox(lightboxPool, lightboxIndex - 1)}
        onNext={() => props.openLightbox(lightboxPool, lightboxIndex + 1)}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Azure Image Gallery</h2>
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition text-white"
        >
          <Home size={18} /><span>Back to Dashboard</span>
        </button>
      </div>

      {/* Search box — always visible */}
      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search images across all containers… (min 3 chars)"
          className="w-full pl-9 pr-10 py-2 bg-white/10 border border-white/20 rounded-xl text-white placeholder:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        {/* Spinner sits inside the input, absolutely — never shifts layout */}
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4">
          {searching && <Loader2 size={16} className="animate-spin opacity-60" />}
        </span>
      </div>

      {/* Search results */}
      <SearchResults
        results={searchResults}
        searching={searching}
        searchStatus={searchStatus}
        query={searchQuery}
        setSelectedContainer={setSelectedContainer}
        fetchFolders={fetchFolders}
        setSelectedPath={setSelectedPath}
        setImages={setImages}
        setSelectedImages={setSelectedImages}
        openLightbox={openLightbox}
        viewImages={viewImages}
        startDownload={startDownload}
      />

      {/* Container grid — hidden while searching */}
      {!selectedContainer && !searchQuery.trim() && (
        <div>
          <div className="mb-2 text-sm opacity-80">Containers</div>
          <div className="grid md:grid-cols-3 gap-6">
            {availableContainers
              .slice(containerPage * CONTAINERS_PER_PAGE, (containerPage + 1) * CONTAINERS_PER_PAGE)
              .map((c) => (
                <div
                  key={c}
                  className={`${glass} p-6 cursor-pointer hover:bg-white/20 transition text-black`}
                  onClick={() => { setSelectedContainer(c); fetchFolders(c); setSelectedPath([]); setImages([]); setSelectedImages({}); }}
                >
                  <div className="flex items-center gap-2 text-lg font-medium">
                    <Folder size={18} className="text-yellow-400" />{c}
                  </div>
                  <div className="text-xs opacity-70 mt-1">Container</div>
                </div>
              ))}
          </div>
          {availableContainers.length > CONTAINERS_PER_PAGE && (
            <div className="flex justify-end gap-2 mt-4">
              <button disabled={containerPage === 0} onClick={() => setContainerPage((p) => p - 1)} className={`${glass} px-4 py-2 disabled:opacity-40`}>Prev</button>
              <button disabled={(containerPage + 1) * CONTAINERS_PER_PAGE >= availableContainers.length} onClick={() => setContainerPage((p) => p + 1)} className={`${glass} px-4 py-2 disabled:opacity-40`}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* Inside container */}
      {selectedContainer && !searchQuery.trim() && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm opacity-80">Container:</span>
            <span className="font-semibold text-black">{selectedContainer}</span>
            <button onClick={navigateUp} className={`${glass} px-3 py-1 text-sm hover:bg-white/20 transition flex items-center gap-1`}>↑ Up</button>
            {selectedPath.length > 0 && (
              <div className="text-sm opacity-70">Current: {selectedPath.map((p) => p.name).join(" / ")}</div>
            )}
          </div>

          {images.length === 0 && currentFolders.length > 0 && (
            <div className="grid md:grid-cols-3 gap-4">
              {currentFolders.map((f) => (
                <FolderCard key={f.fullPath} folder={f} selectedContainer={selectedContainer}
                  openFolder={openFolder} viewImages={viewImages} viewMap={viewMap} hasSubfolders={hasSubfolders} />
              ))}
            </div>
          )}

          {images.length === 0 && currentFolders.length === 0 && loading && (
            <div className="text-center py-8 text-sm opacity-80">Loading folders…</div>
          )}
          {images.length === 0 && currentFolders.length === 0 && !loading && (
            <div className="text-center py-8 text-sm opacity-80">No folders found</div>
          )}

          {images.length > 0 && (
            <div>
              {/* Action bar */}
              <div className="flex items-center gap-3 mb-4">
                <button onClick={downloadFolderZip} className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition">
                  <Download size={16} /><span>Download folder (.zip)</span>
                </button>
                <button disabled={!images.some((i) => selectedImages[i.name])} onClick={downloadSelectedZip}
                  className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <Download size={16} /><span>Download selected (.zip)</span>
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={selectAll} className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition">Select all</button>
                  <button onClick={clearAll}  className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition">Clear all</button>
                </div>
              </div>

              <ImageGrid
                images={images}
                selectedImages={selectedImages}
                setSelectedImages={setSelectedImages}
                openLightbox={openLightbox}
                IMAGES_PER_PAGE={IMAGES_PER_PAGE}
                imagePage={imagePage}
                setImagePage={setImagePage}
              />
            </div>
          )}

          {/* Map overlay */}
          {showMap && (
            <div
              style={{
                position: "fixed",
                top: 0, left: 0,
                width: "100vw", height: "100vh",
                backgroundColor: "rgba(0,0,0,0.6)",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
              }}
              onClick={() => setShowMap(false)}
            >
              <div
                className={`${glass} relative text-white`}
                style={{
                  width: "100%",
                  maxWidth: "56rem",
                  height: "70vh",
                  maxHeight: "70vh",
                  flexShrink: 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 10000 }}
                  className="p-2 rounded-lg hover:bg-white/20 bg-white/10"
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