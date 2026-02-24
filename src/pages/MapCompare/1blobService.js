
// blobService.js
// Utilities for browsing and uploading images to Azure Blob Storage with SAS.
// This file provides:
//   - isImage(name)                       (unchanged behavior from your original code)
//   - listBlobImages(baseUrl, container, sasToken)       [FLAT listing; kept for compatibility]
//   - listByHierarchy({ baseUrl, container, sasToken, prefix })  [FOLDERS + FILES at a prefix]
//   - uploadFilesWithSAS({ baseUrl, container, sasToken, targetPrefix, files }) [UPLOAD]
//   - deleteBlob({ baseUrl, container, sasToken, fullName })     [optional]
//   - exists({ baseUrl, container, sasToken, fullName })         [optional]
//
// Notes:
// - Requires Storage CORS to allow your app’s origin if you call from the browser.
// - Uses Azure Blob REST API via fetch; no extra SDK needed.

// -----------------------------------------------------------------------------
// Basics
// -----------------------------------------------------------------------------

/** Image extension filter (kept compatible with your original helper) */
export const isImage = (name) =>
  /\.(jpe?g|png|gif|bmp|webp)$/i.test(name);

/** Normalize SAS token to always include the leading '?' when building URLs. */
const ensureQ = (sasToken) => (sasToken?.startsWith("?") ? sasToken : `?${sasToken}`);

/** Build a full SAS URL for a blob. `blobName` must be the full path from container root. */
const blobUrlOf = (baseUrl, container, blobName, sasToken) =>
  `${baseUrl}/${container}/${encodeURI(blobName)}${ensureQ(sasToken)}`;

/** Build a container list URL with query params + SAS. */
const containerListUrl = (baseUrl, container, sasToken, params) => {
  const qs = new URLSearchParams(params);
  return `${baseUrl}/${container}?${qs.toString()}${ensureQ(sasToken)}`;
};

/** Ensure prefix ends with `/` when provided. (Azure uses prefix + delimiter for hierarchy.) */
const ensureSlashSuffix = (p) => (p && !p.endsWith("/") ? `${p}/` : p || "");

// -----------------------------------------------------------------------------
// FLAT LISTING (kept for backward compatibility)
// -----------------------------------------------------------------------------

/**
 * Flat list of *all* image blobs in a container.
 * Returns [{ name, url, fullName }], where:
 *   - `name`     last path segment (file name only)
 *   - `url`      SAS URL you can `img src` directly
 *   - `fullName` full path from container root (e.g., "processed/Council/road/file.jpg")
 *
 * NOTE: This aggregates across all "folders" (virtual).
 */
export async function listBlobImages(baseUrl, container, sasToken) {
  const results = [];
  let marker = "";

  // Azure returns paginated results; loop until no NextMarker
  do {
    const params = {
      restype: "container",
      comp: "list",
    };
    if (marker) params.marker = marker;

    const url = containerListUrl(baseUrl, container, sasToken, params);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Blob list failed: ${resp.status}`);
    const xml = await resp.text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const names = Array.from(doc.getElementsByTagName("Name")).map((n) => n.textContent);
    const imageNames = names.filter(isImage);

    for (const fullName of imageNames) {
      results.push({
        name: fullName.split("/").pop(),
        url: blobUrlOf(baseUrl, container, fullName, sasToken),
        fullName,
      });
    }

    // NextMarker may be empty (no more pages)
    const next = doc.getElementsByTagName("NextMarker")[0]?.textContent || "";
    marker = next?.trim() || "";
  } while (marker);

  return results;
}

// -----------------------------------------------------------------------------
// HIERARCHICAL LISTING (folders + image files) at a specific prefix
// -----------------------------------------------------------------------------

/**
 * List folders and image files under a "directory" (prefix) using delimiter="/".
 *
 * @param {object} args
 * @param {string} args.baseUrl    e.g., https://dcpmcloudstorage.blob.core.windows.net
 * @param {string} args.container  e.g., "processed"
 * @param {string} args.sasToken   e.g., "?sv=..."
 * @param {string} [args.prefix]   e.g., "processed/CouncilA/RoadX/" or "" for container root
 *
 * @returns {Promise<{ folders: string[], files: Array<{ name, fullName, url, contentLength?, contentType? }> }>}
 *
 * - folders: array of full prefixes as returned by Azure (e.g., "processed/CouncilA/")
 * - files:   image files at this level only (not recursive)
 */
export async function listByHierarchy({ baseUrl, container, sasToken, prefix = "" }) {
  const results = { folders: [], files: [] };
  const normalizedPrefix = ensureSlashSuffix(prefix);
  let marker = "";

  do {
    const params = {
      restype: "container",
      comp: "list",
      delimiter: "/",
      ...(normalizedPrefix ? { prefix: normalizedPrefix } : {}),
      ...(marker ? { marker } : {}),
    };

    const url = containerListUrl(baseUrl, container, sasToken, params);
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`List failed: ${res.status}`);
    const text = await res.text();

    const doc = new window.DOMParser().parseFromString(text, "application/xml");

    // Folder prefixes (BlobPrefix/Name)
    const folderPrefixes = Array.from(doc.getElementsByTagName("BlobPrefix")).map((p) =>
      p.getElementsByTagName("Name")[0].textContent
    );
    results.folders.push(...folderPrefixes);

    // Blobs at this level
    const blobs = Array.from(doc.getElementsByTagName("Blob")).map((b) => {
      const fullName = b.getElementsByTagName("Name")[0].textContent;
      const props = b.getElementsByTagName("Properties")[0];
      const contentLength = props?.getElementsByTagName("Content-Length")[0]?.textContent;
      const contentType = props?.getElementsByTagName("Content-Type")[0]?.textContent;
      return {
        name: fullName.split("/").pop(),
        fullName,
        url: blobUrlOf(baseUrl, container, fullName, sasToken),
        contentLength,
        contentType,
      };
    });

    results.files.push(...blobs.filter((b) => isImage(b.fullName)));

    // Pagination
    const next = doc.getElementsByTagName("NextMarker")[0]?.textContent || "";
    marker = next?.trim() || "";
  } while (marker);

  return results;
}

// -----------------------------------------------------------------------------
// UPLOAD (BlockBlob PUT) to a folder (prefix)
// -----------------------------------------------------------------------------

/**
 * Upload one or more files to the specified prefix (folder path) in a container.
 *
 * @param {object} args
 * @param {string} args.baseUrl
 * @param {string} args.container
 * @param {string} args.sasToken
 * @param {string} [args.targetPrefix]  e.g., "processed/CouncilA/RoadX/" (include trailing slash when non-empty)
 * @param {File[]} args.files
 *
 * @returns {Promise<Array<{ name: string, fullName: string, url: string }>>}
 */
export async function uploadFilesWithSAS({ baseUrl, container, sasToken, targetPrefix = "", files }) {
  if (!files?.length) return [];

  const normalizedPrefix = ensureSlashSuffix(targetPrefix);
  const results = [];

  for (const file of files) {
    const fullName = `${normalizedPrefix}${file.name}`;
    const url = blobUrlOf(baseUrl, container, fullName, sasToken);

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upload failed for ${file.name}: ${res.status} ${text}`);
    }
    results.push({ name: file.name, fullName, url });
  }

  return results;
}

// -----------------------------------------------------------------------------
// OPTIONAL helpers
// -----------------------------------------------------------------------------

/**
 * Check if a blob exists (HEAD).
 * @param {{ baseUrl: string, container: string, sasToken: string, fullName: string }} args
 * @returns {Promise<boolean>}
 */
export async function exists({ baseUrl, container, sasToken, fullName }) {
  const url = blobUrlOf(baseUrl, container, fullName, sasToken);
  const res = await fetch(url, { method: "HEAD" });
  // 200 OK if exists, 404 otherwise
  return res.status === 200;
}

/**
 * Delete a blob (requires SAS with delete permission).
 * @param {{ baseUrl: string, container: string, sasToken: string, fullName: string }} args
 * @returns {Promise<void>}
 */
export async function deleteBlob({ baseUrl, container, sasToken, fullName }) {
  const url = blobUrlOf(baseUrl, container, fullName, sasToken);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Delete failed for ${fullName}: ${res.status} ${text}`);
  }
}
