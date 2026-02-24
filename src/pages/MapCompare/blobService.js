// blobService.js
// Utilities for browsing and uploading images to Azure Blob Storage with SAS.
// This module now supports two configuration modes:
//  1) Explicit: you pass baseUrl and sasToken in each call (back-compat).
//  2) Implicit: omit baseUrl/sasToken and it auto-reads from ./constants
//     which resolves values from your .env(.local/.production) files.
//
// Public functions:
// - isImage(name)
// - listBlobImages(baseUrl?, container, sasToken?, opts?)
// - listByHierarchy({ baseUrl?, container, sasToken?, prefix? })
// - uploadFilesWithSAS({ baseUrl?, container, sasToken?, targetPrefix?, files })
// - exists({ baseUrl?, container, sasToken?, fullName })
// - deleteBlob({ baseUrl?, container, sasToken?, fullName })
//
// Notes:
// - Requires Storage CORS to allow your app’s origin if you call from the browser.
// - Uses the Azure Blob REST API via fetch; no extra SDK needed.

import { BASE_URL as CONST_BASE_URL, SAS as CONST_SAS } from "./constants";

// ------------------ Basics & Config ------------------

/** Image extension filter (kept compatible with your helper) */
export const isImage = (name) => /\.(jpe?g|png|gif|bmp|webp)$/i.test(name);

/** Strip leading '?' from SAS so we can safely join query strings. */
const stripQ = (sasToken) => (sasToken || "").replace(/^\?/, "");

/** Ensure prefix ends with `/` or return empty string. */
const ensureSlashSuffix = (p) => (p && !p.endsWith("/") ? `${p}/` : (p || ""));

/**
 * Resolve configuration for a call:
 * - If the caller passes baseUrl / sasToken, use those.
 * - Otherwise fall back to constants (env-driven).
 */
function resolveConfig(passedBaseUrl, passedSasToken) {
  const baseUrl = passedBaseUrl || CONST_BASE_URL || "";
  const sasToken = passedSasToken != null ? passedSasToken : (CONST_SAS || "");

  if (!baseUrl) {
    console.warn(
      "[blobService] Missing baseUrl — set VITE_STORAGE_ACCOUNT_NAME in .env or pass baseUrl explicitly."
    );
  }
  if (!sasToken) {
    console.warn(
      "[blobService] Missing SAS — set VITE_ACCOUNT_SAS_TOKEN in .env or pass sasToken explicitly."
    );
  }
  return { baseUrl, sasToken };
}

/**
 * Build a container list URL with query params + SAS.
 * Ensures there is exactly ONE '?' and all params are '&'-joined.
 */
const containerListUrl = (baseUrl, container, sasToken, params = {}) => {
  const qsParams = new URLSearchParams(params).toString(); // e.g., "restype=container&comp=list&delimiter=%2F"
  const sasNoQ = stripQ(sasToken);                         // e.g., "sv=...&ss=b&sp=rl...&se=...&sig=..."
  const joined = [qsParams, sasNoQ].filter(Boolean).join("&");
  return `${baseUrl}/${container}?${joined}`;
};

/** Build a full SAS URL for a blob. `blobName` is the full path from container root. */
const blobUrlOf = (baseUrl, container, blobName, sasToken) =>
  `${baseUrl}/${container}/${encodeURI(blobName)}?${stripQ(sasToken)}`;

// ------------------ FLAT LISTING ------------------

/**
 * Flat list of *all* image blobs in a container.
 * Usage:
 *   listBlobImages(baseUrl, "processed", sasToken)
 *   listBlobImages(undefined, "processed") // will use ./constants
 *
 * Returns [{ name, url, fullName }].
 */
export async function listBlobImages(baseUrl, container, sasToken) {
  const { baseUrl: resolvedBaseUrl, sasToken: resolvedSas } = resolveConfig(baseUrl, sasToken);
  if (!resolvedBaseUrl || !resolvedSas) {
    throw new Error("Missing baseUrl or SAS token for listBlobImages.");
  }

  const results = [];
  let marker = "";

  do {
    const params = {
      restype: "container",
      comp: "list",
      ...(marker ? { marker } : {}),
    };

    const url = containerListUrl(resolvedBaseUrl, container, resolvedSas, params);
    // console.debug("[blobService] LIST flat =>", url);

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Blob list failed: ${resp.status}`);

    const xml = await resp.text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const names = Array.from(doc.getElementsByTagName("Name")).map((n) => n.textContent);
    const imageNames = names.filter(isImage);

    for (const fullName of imageNames) {
      results.push({
        name: fullName.split("/").pop(),
        url: blobUrlOf(resolvedBaseUrl, container, fullName, resolvedSas),
        fullName,
      });
    }

    const next = doc.getElementsByTagName("NextMarker")[0]?.textContent || "";
    marker = next.trim();
  } while (marker);

  return results;
}

// ------------------ HIERARCHICAL LISTING ------------------

/**
 * List folders and image files under a "directory" (prefix) using delimiter="/".
 *
 * @param {object} args
 * @param {string} [args.baseUrl]  - optional; if omitted uses ./constants
 * @param {string} args.container  - required
 * @param {string} [args.sasToken] - optional; if omitted uses ./constants
 * @param {string} [args.prefix]   - e.g., "CouncilA/RoadX/" or "" for container root
 *
 * @returns {Promise<{ folders: string[], files: Array<{ name, fullName, url, contentLength?, contentType? }> }>}
 */
export async function listByHierarchy({ baseUrl, container, sasToken, prefix = "" }) {
  const { baseUrl: resolvedBaseUrl, sasToken: resolvedSas } = resolveConfig(baseUrl, sasToken);
  if (!resolvedBaseUrl || !resolvedSas) {
    throw new Error("Missing baseUrl or SAS token for listByHierarchy.");
  }

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

    const url = containerListUrl(resolvedBaseUrl, container, resolvedSas, params);
    // console.debug("[blobService] LIST hier =>", url);

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`List failed: ${res.status}`);

    const text = await res.text();
    const doc = new window.DOMParser().parseFromString(text, "application/xml");

    // Folder prefixes
    const folderPrefixes = Array.from(doc.getElementsByTagName("BlobPrefix")).map(
      (p) => p.getElementsByTagName("Name")[0].textContent
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
        url: blobUrlOf(resolvedBaseUrl, container, fullName, resolvedSas),
        contentLength,
        contentType,
      };
    });

    results.files.push(...blobs.filter((b) => isImage(b.fullName)));

    const next = doc.getElementsByTagName("NextMarker")[0]?.textContent || "";
    marker = next.trim();
  } while (marker);

  return results;
}

// ------------------ UPLOAD (BlockBlob PUT) ------------------

/**
 * Upload one or more files to the specified prefix (folder path) in a container.
 *
 * @param {object} args
 * @param {string} [args.baseUrl]     - optional; if omitted uses ./constants
 * @param {string} args.container     - required
 * @param {string} [args.sasToken]    - optional; if omitted uses ./constants
 * @param {string} [args.targetPrefix] e.g., "CouncilA/RoadX/"
 * @param {File[]} args.files
 *
 * @returns {Promise<Array<{ name: string, fullName: string, url: string }>>}
 */
export async function uploadFilesWithSAS({ baseUrl, container, sasToken, targetPrefix = "", files }) {
  const { baseUrl: resolvedBaseUrl, sasToken: resolvedSas } = resolveConfig(baseUrl, sasToken);
  if (!resolvedBaseUrl || !resolvedSas) {
    throw new Error("Missing baseUrl or SAS token for uploadFilesWithSAS.");
  }

  if (!files?.length) return [];
  const normalizedPrefix = ensureSlashSuffix(targetPrefix);
  const results = [];

  for (const file of files) {
    const fullName = `${normalizedPrefix}${file.name}`;
    const url = blobUrlOf(resolvedBaseUrl, container, fullName, resolvedSas);

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

// ------------------ OPTIONAL helpers ------------------

/** Check if a blob exists (HEAD). */
export async function exists({ baseUrl, container, sasToken, fullName }) {
  const { baseUrl: resolvedBaseUrl, sasToken: resolvedSas } = resolveConfig(baseUrl, sasToken);
  if (!resolvedBaseUrl || !resolvedSas) {
    throw new Error("Missing baseUrl or SAS token for exists.");
  }
  const url = blobUrlOf(resolvedBaseUrl, container, fullName, resolvedSas);
  const res = await fetch(url, { method: "HEAD" });
  return res.status === 200;
}

/** Delete a blob (requires SAS with delete permission). */
export async function deleteBlob({ baseUrl, container, sasToken, fullName }) {
  const { baseUrl: resolvedBaseUrl, sasToken: resolvedSas } = resolveConfig(baseUrl, sasToken);
  if (!resolvedBaseUrl || !resolvedSas) {
    throw new Error("Missing baseUrl or SAS token for deleteBlob.");
  }
  const url = blobUrlOf(resolvedBaseUrl, container, fullName, resolvedSas);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Delete failed for ${fullName}: ${res.status} ${text}`);
  }
}

/**
 * List all containers in the storage account (requires account-level SAS with "list").
 * Returns: string[] of container names.
 */
export async function listContainers(baseUrl, sasToken) {
  const { baseUrl: resolvedBaseUrl, sasToken: resolvedSas } = resolveConfig(baseUrl, sasToken);
  if (!resolvedBaseUrl || !resolvedSas) {
    throw new Error("Missing baseUrl or SAS token for listContainers.");
  }

  const results = [];
  let marker = "";
  do {
    const params = {
      comp: "list",
      ...(marker ? { marker } : {}),
    };
    // https://{account}.blob.core.windows.net/?comp=list&{sas}
    const qs = new URLSearchParams(params).toString();
    const url = `${resolvedBaseUrl}/?${qs}&${stripQ(resolvedSas)}`;

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`Container list failed: ${res.status}`);
    const xml = await res.text();

    const doc = new window.DOMParser().parseFromString(xml, "application/xml");
    const names = Array.from(doc.getElementsByTagName("Container")).map((c) =>
      c.getElementsByTagName("Name")[0]?.textContent || ""
    );
    results.push(...names.filter(Boolean));

    const next = doc.getElementsByTagName("NextMarker")[0]?.textContent || "";
    marker = next.trim();
  } while (marker);

  return results;
}