// containerSearchUtil.js
// Utility functions for searching and filtering containers

/**
 * Priority order for containers
 */
const CONTAINER_PRIORITY = ["raw", "processed", "projects", "uploads", "issued"];

function getContainerPriority(name) {
  const idx = CONTAINER_PRIORITY.indexOf(name.toLowerCase());
  return idx >= 0 ? idx : 999;
}

/* ─── Container list helpers ─────────────────────────────────── */

export function sortContainersByPriority(containers) {
  return [...containers].sort(
    (a, b) => getContainerPriority(a) - getContainerPriority(b)
  );
}

export function searchContainers(containers, query = "") {
  const q = (query || "").toLowerCase().trim();
  const filtered = q
    ? containers.filter((c) => c.toLowerCase().includes(q))
    : containers;
  return sortContainersByPriority(filtered);
}

export function filterToPriorityContainers(containers) {
  const set = new Set(CONTAINER_PRIORITY);
  return sortContainersByPriority(containers.filter((c) => set.has(c.toLowerCase())));
}

export function isPriorityContainer(name) {
  return CONTAINER_PRIORITY.includes(name.toLowerCase());
}

export function findContainerByName(containers, target) {
  const t = target.toLowerCase();
  return containers.find((c) => c.toLowerCase() === t) || null;
}

export function searchFilesInContainer(files, query) {
  if (!query?.trim()) return files;
  const q = query.toLowerCase().trim();
  return files.filter(
    (f) => f.name?.toLowerCase().includes(q) || f.fullName?.toLowerCase().includes(q)
  );
}

/* ─── Flat blob listing (single API call per container) ──────── */
// Uses Azure Blob REST API without a delimiter so ALL blobs are
// returned in one paginated response — no recursive folder walking.

const IMAGE_EXTS = new Set(["jpg","jpeg","png","webp","gif","bmp","tiff","tif","heic","heif","avif"]);

function isImageBlob(name = "", contentType = "") {
  if (contentType.startsWith("image/")) return true;
  const ext = name.split(".").pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

/***** start of listAllBlobFlat *****/

async function listAllBlobsFlat({ baseUrl, sasToken, container, query, signal, stopOnFirst = false, maxPages = 20 }) {
  if (!sasToken) {
    console.warn(`[containerSearch] sasToken missing for "${container}" — skipping`);
    return [];
  }

  const needle  = query.toLowerCase().trim();
  const results = [];
  const sas     = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;
  let marker    = "";
  let page      = 0;

  do {
    if (signal?.aborted) break;
    if (page >= maxPages) break;                         // ← speed cap
    page++;

    const markerParam = marker ? `&marker=${encodeURIComponent(marker)}` : "";
    const url =
      `${baseUrl}/${container}?restype=container&comp=list` +
      `&maxresults=5000${markerParam}&${sas}`;

    const resp = await fetch(url, { signal });
    if (!resp.ok) throw new Error(`Blob list failed: ${resp.status}`);

    const xml = new DOMParser().parseFromString(await resp.text(), "application/xml");

    for (const blob of xml.querySelectorAll("Blob")) {
      if (signal?.aborted) break;
      const name        = blob.querySelector("Name")?.textContent || "";
      const contentType = blob.querySelector("Content-Type,ContentType")?.textContent || "";
      if (!isImageBlob(name, contentType)) continue;

      const shortName = name.split("/").pop();
      if (!shortName.toLowerCase().includes(needle) && !name.toLowerCase().includes(needle)) continue;

      results.push({ name, url: `${baseUrl}/${container}/${name}?${sas}`, contentType, container });

      if (stopOnFirst) break;                            // ← stop scanning this page
    }

    if (stopOnFirst && results.length > 0) break;        // ← stop paginating this container

    marker = xml.querySelector("NextMarker")?.textContent || "";
  } while (marker);

  return results;
}

/***** end of listAllBlobFlat *****/

/* ─── Cross-container search engine ─────────────────────────── */
export async function searchAcrossContainers({
  baseUrl,
  sasToken,
  query = "",
  containers = CONTAINER_PRIORITY,
  onProgress,
  signal,
  stopOnFirst = false,    // ← default OFF: show all matches across all containers
}) {
  if (!query.trim()) return [];

  const ordered   = sortContainersByPriority(containers);
  const total     = ordered.length;
  let   doneCount = 0;

  // Accumulate matches from ALL containers into one shared array
  const allMatches = [];

  await Promise.all(
    ordered.map(async (container) => {
      if (signal?.aborted) {
        doneCount++;
        onProgress?.({ container, found: allMatches.length, done: doneCount >= total, containerDone: true });
        return;
      }

      onProgress?.({ container, found: allMatches.length, done: false });

      try {
        const matched = await listAllBlobsFlat({
          baseUrl, sasToken, container, query,
          signal,
          stopOnFirst: false,   // always scan full container
          maxPages: 20,         // cap at 100k blobs per container
        });

        if (!signal?.aborted) {
          // Push this container's results into the shared array
          allMatches.push(...matched);
          doneCount++;

          // ← KEY: fire onProgress with the running matches array so UI can
          //   render incrementally — user sees raw results while processed
          //   is still searching
          onProgress?.({
            container,
            found:          allMatches.length,
            done:           doneCount >= total,   // true only when ALL containers finished
            containerDone:  true,
            containerMatches: matched.length,
            // Pass the current snapshot of all matches found so far
            currentMatches: [...allMatches],
          });
        } else {
          doneCount++;
          onProgress?.({ container, found: allMatches.length, done: doneCount >= total, containerDone: true });
        }
      } catch (err) {
        if (!signal?.aborted) {
          console.warn(`[containerSearch] Error in "${container}":`, err);
        }
        doneCount++;
        onProgress?.({ container, found: allMatches.length, done: doneCount >= total, containerDone: true, error: err });
      }
    })
  );

  onProgress?.({ container: null, found: allMatches.length, done: true, currentMatches: [...allMatches] });
  return allMatches;
}

export default {
  searchContainers,
  sortContainersByPriority,
  filterToPriorityContainers,
  searchFilesInContainer,
  searchAcrossContainers,
  findContainerByName,
  isPriorityContainer,
};