import { useState, useEffect, useRef } from "react";
import {
  Home, X, Folder, Download, Search, Loader2,
  ChevronLeft, ChevronRight, Star, Info, Tag,
  LayoutGrid, List, ArrowUpDown, Copy, Scissors,
  CheckSquare, AlertCircle,
} from "lucide-react";
import { useDownload } from "../DownloadContext";

const glass = "bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl rounded-2xl";
const btn   = `${glass} px-3 py-1.5 text-sm hover:bg-white/20 transition flex items-center gap-1.5`;

/* ══════════════════════════════════════════════════════════
   FolderCard
══════════════════════════════════════════════════════════ */
function FolderCard({ folder, selectedContainer, openFolder, viewImages, viewMap, hasSubfolders }) {
  const [childCheck, setChildCheck] = useState(null);
  useEffect(() => {
    let ok = true;
    (async () => { const r = await hasSubfolders(selectedContainer, folder.fullPath); if (ok) setChildCheck(r); })();
    return () => { ok = false; };
  }, [selectedContainer, folder.fullPath, hasSubfolders]);

  return (
    <div className={`${glass} p-4 text-black`}>
      <div className="mb-1 font-medium flex items-center gap-2">
        <Folder size={18} className="text-yellow-400" />{folder.name}
      </div>
      {childCheck === null && <div className="mt-2 text-xs opacity-60">Checking…</div>}
      {childCheck === true  && <div className="mt-3"><button className={btn} onClick={() => openFolder(folder)}>Open</button></div>}
      {childCheck === false && (
        <div className="mt-3 flex gap-2">
          <button className={btn} onClick={() => viewMap(folder)}>View Map</button>
          <button className={btn} onClick={() => viewImages(folder)}>View Images</button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Lightbox
══════════════════════════════════════════════════════════ */
function Lightbox({ images, index, onClose, onPrev, onNext }) {
  if (index === null || !images[index]) return null;
  const img = images[index];
  return (
    <div className="fixed inset-0 bg-black/90 z-[99999] flex items-center justify-center" onClick={onClose}>
      <button className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white z-10" onClick={onClose}><X size={22} /></button>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">{index + 1} / {images.length}</div>
      {index > 0 && (
        <button className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}><ChevronLeft size={28} /></button>
      )}
      <div className="max-w-5xl max-h-[85vh] px-16" onClick={(e) => e.stopPropagation()}>
        <img src={img.url} alt={img.name} className="max-h-[80vh] max-w-full object-contain rounded-xl shadow-2xl" />
        <div className="text-white/80 text-sm text-center mt-3">{img.name}</div>
      </div>
      {index < images.length - 1 && (
        <button className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
          onClick={(e) => { e.stopPropagation(); onNext(); }}><ChevronRight size={28} /></button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   EXIF Panel (slide-in from right)
══════════════════════════════════════════════════════════ */
function ExifPanel({ image, data, loading, onClose, fmtSize }) {
  if (!image) return null;

  const rows = [];
  const add  = (label, val) => { if (val !== undefined && val !== null && val !== "") rows.push({ label, val: String(val) }); };

  if (data) {
    add("File",      image.name);
    add("Size",      image.sizeLabel || fmtSize(image.size));
    add("Date Taken", data.DateTimeOriginal
      ? new Date(data.DateTimeOriginal).toLocaleString() : undefined);
    add("Make",       data.Make);
    add("Model",      data.Model);
    add("Software",   data.Software);
    add("Width",      data.ImageWidth  || data.ExifImageWidth);
    add("Height",     data.ImageHeight || data.ExifImageHeight);
    add("ISO",        data.ISO);
    add("Aperture",   data.FNumber    ? `f/${data.FNumber}` : undefined);
    add("Shutter",    data.ExposureTime ? `1/${Math.round(1 / data.ExposureTime)}s` : undefined);
    add("Focal Len.", data.FocalLength ? `${data.FocalLength}mm` : undefined);
    add("GPS Lat",    data.latitude?.toFixed(6));
    add("GPS Lon",    data.longitude?.toFixed(6));
    add("Orientation", data.Orientation);
  }

  return (
    <div
      className={`${glass} fixed top-0 right-0 h-full w-80 z-[9998] flex flex-col text-white overflow-hidden`}
      style={{ boxShadow: "-4px 0 24px rgba(0,0,0,0.4)" }}
    >
      <div className="flex items-center justify-between p-4 border-b border-white/20">
        <div className="flex items-center gap-2 font-semibold"><Info size={16} /> Image Info</div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/20"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <img src={image.url} alt={image.name} className="w-full h-40 object-cover rounded-xl mb-4" />

        {loading && (
          <div className="flex items-center gap-2 text-sm opacity-70">
            <Loader2 size={14} className="animate-spin" /> Reading EXIF data…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="text-sm opacity-60">No EXIF metadata found.</div>
        )}

        {!loading && rows.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {rows.map(({ label, val }) => (
                <tr key={label} className="border-b border-white/10">
                  <td className="py-1.5 pr-3 opacity-60 font-medium whitespace-nowrap">{label}</td>
                  <td className="py-1.5 break-all">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Batch Modal
══════════════════════════════════════════════════════════ */
function BatchModal({ mode, target, setTarget, availableContainers, currentContainer, onConfirm, onCancel, progress }) {
  const isDone = progress && progress.done >= progress.total;
  const pct    = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div
      style={{ position:"fixed",top:0,left:0,width:"100vw",height:"100vh",backgroundColor:"rgba(0,0,0,0.6)",zIndex:9997,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}
      onClick={onCancel}
    >
      <div className={`${glass} text-white p-6 w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-lg font-semibold mb-4">
          {mode === "move" ? <Scissors size={18} /> : <Copy size={18} />}
          {mode === "move" ? "Move" : "Copy"} selected images
        </div>

        {!progress && (
          <>
            <label className="text-sm opacity-70 block mb-2">Destination container</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 mb-4 text-white"
            >
              <option value="">— Select container —</option>
              {availableContainers.filter((c) => c !== currentContainer).map((c) => (
                <option key={c} value={c} className="text-black">{c}</option>
              ))}
            </select>
            <div className="flex gap-3 justify-end">
              <button onClick={onCancel} className={btn}>Cancel</button>
              <button
                disabled={!target}
                onClick={onConfirm}
                className="px-4 py-2 bg-blue-500/40 hover:bg-blue-500/60 border border-blue-400/30 rounded-xl text-sm disabled:opacity-40 transition"
              >
                {mode === "move" ? "Move" : "Copy"}
              </button>
            </div>
          </>
        )}

        {progress && (
          <div>
            <div className="text-sm mb-2">{isDone ? "Done!" : `${mode === "move" ? "Moving" : "Copying"}… ${progress.done} / ${progress.total}`}</div>
            <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full transition-all ${isDone ? "bg-green-400" : "bg-blue-400"}`} style={{ width: `${pct}%` }} />
            </div>
            {progress.errors > 0 && (
              <div className="flex items-center gap-1 text-xs text-red-400 mt-1">
                <AlertCircle size={12} /> {progress.errors} file(s) failed
              </div>
            )}
            {isDone && <button onClick={onCancel} className={`${btn} mt-3`}>Close</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sort + View toolbar
══════════════════════════════════════════════════════════ */
function SortToolbar({ viewMode, setViewMode, sortBy, setSortBy, sortOrder, setSortOrder, total }) {
  return (
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      <span className="text-xs opacity-60">{total} image{total !== 1 ? "s" : ""}</span>

      <div className="flex items-center gap-1 ml-auto">
        {/* Sort field */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white"
        >
          <option value="name"  className="text-black">Name</option>
          <option value="date"  className="text-black">Date</option>
          <option value="size"  className="text-black">Size</option>
        </select>

        {/* Asc/Desc toggle */}
        <button
          onClick={() => setSortOrder((o) => o === "asc" ? "desc" : "asc")}
          className={`${btn} px-2`}
          title={sortOrder === "asc" ? "Ascending" : "Descending"}
        >
          <ArrowUpDown size={14} />
          <span className="text-xs">{sortOrder === "asc" ? "A→Z" : "Z→A"}</span>
        </button>

        {/* Grid / List toggle */}
        <button onClick={() => setViewMode("grid")} className={`${btn} px-2 ${viewMode === "grid" ? "bg-white/30" : ""}`} title="Grid view">
          <LayoutGrid size={14} />
        </button>
        <button onClick={() => setViewMode("list")} className={`${btn} px-2 ${viewMode === "list" ? "bg-white/30" : ""}`} title="List view">
          <List size={14} />
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Enhanced Image Card (grid mode)
══════════════════════════════════════════════════════════ */
function ImageCard({ img, checked, onCheck, onLightbox, onExif, isFav, onFav, imgTags, onAddTag, onRemoveTag }) {
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);

  const submitTag = (e) => {
    e.preventDefault();
    onAddTag(img.url, tagInput);
    setTagInput(""); setShowTagInput(false);
  };

  return (
    <div className={`${glass} p-2 text-black flex flex-col gap-1`}>
      {/* Top row: checkbox + name + actions */}
      <div className="flex items-center gap-1">
        <input type="checkbox" checked={checked} onChange={onCheck} className="shrink-0" />
        <span className="text-xs truncate flex-1 text-white/80">{img.name}</span>
        <button onClick={() => onFav(img.url)} className={`p-1 rounded hover:bg-white/20 ${isFav ? "text-yellow-400" : "text-white/40"}`} title="Favourite">
          <Star size={13} fill={isFav ? "currentColor" : "none"} />
        </button>
        <button onClick={() => onExif(img)} className="p-1 rounded hover:bg-white/20 text-white/40 hover:text-white" title="Image info">
          <Info size={13} />
        </button>
      </div>

      {/* Thumbnail */}
      <div className="relative">
        <img
          src={img.url} alt={img.name}
          className="w-full h-40 object-cover rounded-lg cursor-zoom-in hover:opacity-90 transition"
          onClick={onLightbox}
        />
        {img.sizeLabel && (
          <span className="absolute bottom-1 right-1 text-[10px] bg-black/50 text-white px-1 rounded">
            {img.sizeLabel}
          </span>
        )}
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mt-0.5">
        {(imgTags || []).map((t) => (
          <span key={t} className="flex items-center gap-0.5 bg-blue-500/30 border border-blue-400/30 text-white text-[10px] px-1.5 py-0.5 rounded-full">
            {t}
            <button onClick={() => onRemoveTag(img.url, t)} className="hover:text-red-300 ml-0.5"><X size={9} /></button>
          </span>
        ))}
        {!showTagInput && (
          <button onClick={() => setShowTagInput(true)} className="text-[10px] text-white/40 hover:text-white flex items-center gap-0.5">
            <Tag size={10} /> add tag
          </button>
        )}
      </div>

      {showTagInput && (
        <form onSubmit={submitTag} className="flex gap-1 mt-0.5">
          <input
            autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)}
            placeholder="tag name…"
            className="flex-1 text-xs bg-white/10 border border-white/20 rounded px-2 py-0.5 text-white placeholder:opacity-40 outline-none"
          />
          <button type="submit" className="text-xs bg-white/20 rounded px-2">+</button>
          <button type="button" onClick={() => setShowTagInput(false)} className="text-xs opacity-50 hover:opacity-100"><X size={12} /></button>
        </form>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   List row (list mode)
══════════════════════════════════════════════════════════ */
function ImageListRow({ img, checked, onCheck, onLightbox, onExif, isFav, onFav, imgTags }) {
  return (
    <div className={`${glass} px-3 py-2 flex items-center gap-3 text-white`}>
      <input type="checkbox" checked={checked} onChange={onCheck} className="shrink-0" />
      <img src={img.url} alt={img.name}
        className="w-12 h-12 object-cover rounded-lg cursor-zoom-in hover:opacity-90 shrink-0"
        onClick={onLightbox}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{img.name}</div>
        <div className="flex gap-2 text-xs opacity-60 mt-0.5">
          {img.sizeLabel && <span>{img.sizeLabel}</span>}
          {img.lastModified ? <span>{new Date(img.lastModified).toLocaleDateString()}</span> : null}
        </div>
        {(imgTags || []).length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {imgTags.map((t) => (
              <span key={t} className="bg-blue-500/30 text-[10px] px-1.5 py-0.5 rounded-full border border-blue-400/30">{t}</span>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => onFav(img.url)} className={`p-1 shrink-0 ${isFav ? "text-yellow-400" : "text-white/40"}`}>
        <Star size={14} fill={isFav ? "currentColor" : "none"} />
      </button>
      <button onClick={() => onExif(img)} className="p-1 shrink-0 text-white/40 hover:text-white"><Info size={14} /></button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   ImageGrid (grid + list + pagination)
══════════════════════════════════════════════════════════ */
function ImageGrid({
  images, selectedImages, setSelectedImages, openLightbox,
  IMAGES_PER_PAGE, imagePage, setImagePage,
  viewMode, sortBy, setSortBy, sortOrder, setSortOrder, setViewMode,
  openExifPanel, favourites, toggleFavourite, tags, addTag, removeTag,
}) {
  const totalPages = Math.ceil(images.length / IMAGES_PER_PAGE);
  const pageImgs   = images.slice(imagePage * IMAGES_PER_PAGE, (imagePage + 1) * IMAGES_PER_PAGE);
  const offset     = imagePage * IMAGES_PER_PAGE;

  return (
    <div>
      <SortToolbar viewMode={viewMode} setViewMode={setViewMode}
        sortBy={sortBy} setSortBy={setSortBy} sortOrder={sortOrder} setSortOrder={setSortOrder}
        total={images.length} />

      {viewMode === "grid" ? (
        <div className="grid md:grid-cols-3 gap-4">
          {pageImgs.map((img, i) => (
            <ImageCard key={img.blobPath || img.name} img={img}
              checked={!!selectedImages[img.name]}
              onCheck={(e) => setSelectedImages((s) => ({ ...s, [img.name]: e.target.checked }))}
              onLightbox={() => openLightbox(images, offset + i)}
              onExif={openExifPanel}
              isFav={!!favourites[img.url]}
              onFav={toggleFavourite}
              imgTags={tags[img.url]}
              onAddTag={addTag} onRemoveTag={removeTag}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pageImgs.map((img, i) => (
            <ImageListRow key={img.blobPath || img.name} img={img}
              checked={!!selectedImages[img.name]}
              onCheck={(e) => setSelectedImages((s) => ({ ...s, [img.name]: e.target.checked }))}
              onLightbox={() => openLightbox(images, offset + i)}
              onExif={openExifPanel}
              isFav={!!favourites[img.url]}
              onFav={toggleFavourite}
              imgTags={tags[img.url]}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <span className="text-xs opacity-60">
            {offset + 1}–{Math.min(offset + IMAGES_PER_PAGE, images.length)} of {images.length}
          </span>
          <div className="flex gap-1 flex-wrap">
            <button disabled={imagePage === 0} onClick={() => setImagePage((p) => p - 1)} className={`${btn} disabled:opacity-40`}>
              <ChevronLeft size={14} /> Prev
            </button>
            {Array.from({ length: totalPages }, (_, n) => (
              <button key={n} onClick={() => setImagePage(n)}
                className={`${glass} px-3 py-1.5 text-xs ${n === imagePage ? "bg-white/30 font-bold" : "hover:bg-white/20"}`}>
                {n + 1}
              </button>
            ))}
            <button disabled={imagePage >= totalPages - 1} onClick={() => setImagePage((p) => p + 1)} className={`${btn} disabled:opacity-40`}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Search Results
══════════════════════════════════════════════════════════ */
function SearchResults({
  results, searching, searchStatus, query,
  setSelectedContainer, fetchFolders, setSelectedPath, setImages, setSelectedImages,
  openLightbox, viewImages, startDownload,
}) {
  if (!query.trim()) return null;
  const [selected, setSelected] = useState({});
  useEffect(() => setSelected({}), [results]);

  const toggle   = (url) => setSelected((s) => ({ ...s, [url]: !s[url] }));
  const selAll   = () => { const m = {}; results.forEach((r) => (m[r.url] = true)); setSelected(m); };
  const clrAll   = () => setSelected({});
  const anySelected = results.some((r) => selected[r.url]);

  const dlSelected = () => {
    const imgs = results.filter((r) => selected[r.url]).map((r) => ({ name: r.name, url: r.url }));
    if (imgs.length) startDownload(imgs, "search-selected.zip");
  };
  const dlAll = () => startDownload(results.map((r) => ({ name: r.name, url: r.url })), `search-${query.trim()}.zip`);

  const goToFolder = (r) => {
    setSelectedContainer(r.container);
    const segs = r.folderPath.split("/").filter(Boolean)
      .reduce((acc, seg, idx, arr) => [...acc, { name: seg, fullPath: arr.slice(0, idx + 1).join("/") }], []);
    setSelectedPath(segs.slice(0, -1));
    setImages([]); setSelectedImages({});
    viewImages({ name: segs.at(-1)?.name || r.container, fullPath: r.folderPath });
  };

  return (
    <div className={`${glass} p-4 mb-6`}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {searching
            ? <><Loader2 size={15} className="animate-spin shrink-0" />{searchStatus || "Searching…"}{results.length > 0 && <span className="text-blue-300 ml-1">{results.length} found…</span>}</>
            : <><Search size={15} className="shrink-0" />{results.length} result{results.length !== 1 ? "s" : ""} for "<span className="text-blue-300">{query}</span>"</>
          }
        </div>
        {results.length > 0 && !searching && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={selAll}  className={`${btn} text-xs`}><CheckSquare size={13} /> Select all</button>
            <button onClick={clrAll}  className={`${btn} text-xs`}>Clear</button>
            <button disabled={!anySelected} onClick={dlSelected}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-xl border border-white/20 disabled:opacity-40 transition">
              <Download size={13} /> Selected
            </button>
            <button onClick={dlAll}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-500/30 hover:bg-blue-500/50 rounded-xl border border-blue-400/30 transition">
              <Download size={13} /> All ({results.length})
            </button>
          </div>
        )}
      </div>

      {!searching && results.length === 0 && <div className="text-sm opacity-60">No images found.</div>}

      {results.length > 0 && (
        <div className="grid md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {results.map((r, i) => (
            <div key={`${r.container}/${r.fullPath}`}
              className={`${glass} p-2 transition ${selected[r.url] ? "ring-2 ring-blue-400" : ""}`}>
              <button className="text-xs text-blue-300 hover:text-blue-200 mb-2 text-left w-full truncate flex items-center gap-1"
                onClick={() => goToFolder(r)}>
                <Folder size={11} className="text-yellow-400 shrink-0" />
                {r.container}{r.folderPath ? ` / ${r.folderPath}` : ""}
              </button>
              <div className="relative">
                <img src={r.url} alt={r.name}
                  className="w-full h-32 object-cover rounded-lg cursor-zoom-in hover:opacity-90 transition"
                  onClick={() => openLightbox(results, i)} />
                <input type="checkbox" checked={!!selected[r.url]} onChange={() => toggle(r.url)}
                  className="absolute top-2 left-2 w-4 h-4 cursor-pointer accent-blue-400" />
              </div>
              <div className="text-xs mt-1 truncate opacity-70">{r.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Layout
══════════════════════════════════════════════════════════ */
export default function ImageGalleryLayout(props) {
  const { startDownload } = useDownload();
  const {
    navigate,
    availableContainers, selectedContainer, setSelectedContainer,
    containerPage, setContainerPage, CONTAINERS_PER_PAGE,
    selectedPath, setSelectedPath, currentFolders,
    images, setImages, sortedImages,
    selectedImages, setSelectedImages, loading,
    fetchFolders, navigateUp, openFolder, viewImages, viewMap, hasSubfolders,
    selectAll, clearAll, downloadFolderZip, downloadSelectedZip,
    showMap, setShowMap, mapRef,
    searchQuery, searchResults, searching, searchStatus, handleSearchChange,
    IMAGES_PER_PAGE, imagePage, setImagePage,
    lightboxIndex, lightboxPool, openLightbox, closeLightbox,
    viewMode, setViewMode, sortBy, setSortBy, sortOrder, setSortOrder,
    exifImage, exifData, exifLoading, openExifPanel, closeExifPanel,
    favourites, toggleFavourite, tags, addTag, removeTag,
    batchMode, setBatchMode, batchTarget, setBatchTarget, batchProgress, executeBatch,
    fmtSize,
  } = props;

  const selectedCount = images.filter((i) => selectedImages[i.name]).length;

  return (
    <div className="glass-card p-8 max-w-7xl mx-auto mt-8 text-white">

      {/* Lightbox */}
      <Lightbox images={lightboxPool} index={lightboxIndex} onClose={closeLightbox}
        onPrev={() => openLightbox(lightboxPool, lightboxIndex - 1)}
        onNext={() => openLightbox(lightboxPool, lightboxIndex + 1)} />

      {/* EXIF Panel */}
      <ExifPanel image={exifImage} data={exifData} loading={exifLoading} onClose={closeExifPanel} fmtSize={fmtSize} />

      {/* Batch Modal */}
      {batchMode && (
        <BatchModal
          mode={batchMode} target={batchTarget} setTarget={setBatchTarget}
          availableContainers={availableContainers} currentContainer={selectedContainer}
          onConfirm={executeBatch} onCancel={() => { setBatchMode(null); setBatchTarget(""); }}
          progress={batchProgress}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Azure Image Gallery</h2>
        <button onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition">
          <Home size={18} /><span>Back to Dashboard</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
        <input type="text" value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search images across all containers… (min 3 chars)"
          className="w-full pl-9 pr-10 py-2 bg-white/10 border border-white/20 rounded-xl text-white placeholder:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/30" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4">
          {searching && <Loader2 size={16} className="animate-spin opacity-60" />}
        </span>
      </div>

      {/* Search Results */}
      <SearchResults results={searchResults} searching={searching} searchStatus={searchStatus}
        query={searchQuery} setSelectedContainer={setSelectedContainer} fetchFolders={fetchFolders}
        setSelectedPath={setSelectedPath} setImages={setImages} setSelectedImages={setSelectedImages}
        openLightbox={openLightbox} viewImages={viewImages} startDownload={startDownload} />

      {/* Container grid */}
      {!selectedContainer && !searchQuery.trim() && (
        <div>
          <div className="mb-2 text-sm opacity-80">Containers</div>
          <div className="grid md:grid-cols-3 gap-6">
            {availableContainers.slice(containerPage * CONTAINERS_PER_PAGE, (containerPage + 1) * CONTAINERS_PER_PAGE)
              .map((c) => (
                <div key={c} className={`${glass} p-6 cursor-pointer hover:bg-white/20 transition text-black`}
                  onClick={() => { setSelectedContainer(c); fetchFolders(c); setSelectedPath([]); setImages([]); setSelectedImages({}); }}>
                  <div className="flex items-center gap-2 text-lg font-medium">
                    <Folder size={18} className="text-yellow-400" />{c}
                  </div>
                  <div className="text-xs opacity-70 mt-1">Container</div>
                </div>
              ))}
          </div>
          {availableContainers.length > CONTAINERS_PER_PAGE && (
            <div className="flex justify-end gap-2 mt-4">
              <button disabled={containerPage === 0} onClick={() => setContainerPage((p) => p - 1)} className={`${btn} disabled:opacity-40`}>Prev</button>
              <button disabled={(containerPage + 1) * CONTAINERS_PER_PAGE >= availableContainers.length} onClick={() => setContainerPage((p) => p + 1)} className={`${btn} disabled:opacity-40`}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* Inside container */}
      {selectedContainer && !searchQuery.trim() && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm opacity-80">Container:</span>
            <span className="font-semibold">{selectedContainer}</span>
            <button onClick={navigateUp} className={btn}>↑ Up</button>
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
          {images.length === 0 && currentFolders.length === 0 && loading  && <div className="text-center py-8 text-sm opacity-80">Loading…</div>}
          {images.length === 0 && currentFolders.length === 0 && !loading && <div className="text-center py-8 text-sm opacity-80">No folders found</div>}

          {images.length > 0 && (
            <div>
              {/* Action bar */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <button onClick={downloadFolderZip} className={btn}><Download size={15} /> Download folder</button>
                <button disabled={!selectedCount} onClick={downloadSelectedZip} className={`${btn} disabled:opacity-40`}>
                  <Download size={15} /> Download selected {selectedCount > 0 && `(${selectedCount})`}
                </button>
                <button onClick={selectAll} className={btn}><CheckSquare size={15} /> Select all</button>
                <button onClick={clearAll}  className={btn}>Clear</button>

                {/* Batch ops — visible when images selected */}
                {selectedCount > 0 && (
                  <>
                    <button onClick={() => setBatchMode("copy")} className={`${btn} text-blue-300`}>
                      <Copy size={15} /> Copy to…
                    </button>
                    <button onClick={() => setBatchMode("move")} className={`${btn} text-orange-300`}>
                      <Scissors size={15} /> Move to…
                    </button>
                  </>
                )}
              </div>

              <ImageGrid
                images={sortedImages}
                selectedImages={selectedImages} setSelectedImages={setSelectedImages}
                openLightbox={openLightbox}
                IMAGES_PER_PAGE={IMAGES_PER_PAGE} imagePage={imagePage} setImagePage={setImagePage}
                viewMode={viewMode} setViewMode={setViewMode}
                sortBy={sortBy} setSortBy={setSortBy}
                sortOrder={sortOrder} setSortOrder={setSortOrder}
                openExifPanel={openExifPanel}
                favourites={favourites} toggleFavourite={toggleFavourite}
                tags={tags} addTag={addTag} removeTag={removeTag}
              />
            </div>
          )}

          {/* Map overlay */}
          {showMap && (
            <div style={{ position:"fixed",top:0,left:0,width:"100vw",height:"100vh",backgroundColor:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}
              onClick={() => setShowMap(false)}>
              <div className={`${glass} relative text-white`}
                style={{ width:"100%",maxWidth:"56rem",height:"70vh",maxHeight:"70vh",flexShrink:0 }}
                onClick={(e) => e.stopPropagation()}>
                <button style={{ position:"absolute",top:"0.75rem",right:"0.75rem",zIndex:10000 }}
                  className="p-2 rounded-lg hover:bg-white/20 bg-white/10" onClick={() => setShowMap(false)}>
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