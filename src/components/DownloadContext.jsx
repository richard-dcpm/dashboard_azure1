import { createContext, useContext, useRef, useState, useCallback } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const DownloadContext = createContext(null);

export function useDownload() {
  return useContext(DownloadContext);
}

let nextId = 1;

export function DownloadProvider({ children }) {
  const [jobs, setJobs] = useState([]); // [{ id, name, total, done, failed, status }]
  const jobsRef = useRef([]);           // mirror for use inside async closures

  const updateJob = useCallback((id, patch) => {
    setJobs((prev) => {
      const next = prev.map((j) => (j.id === id ? { ...j, ...patch } : j));
      jobsRef.current = next;
      return next;
    });
  }, []);

  const startDownload = useCallback(async (imgs, zipName) => {
    if (!imgs || imgs.length === 0) return;

    const id = nextId++;
    const job = { id, name: zipName, total: imgs.length, done: 0, failed: 0, status: "downloading" };
    setJobs((prev) => { const next = [...prev, job]; jobsRef.current = next; return next; });

    try {
      const zip = new JSZip();

      for (const img of imgs) {
        try {
          const res = await fetch(img.url, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          zip.file(img.name, blob);
          updateJob(id, (j => ({ done: j.done + 1 }))(
            jobsRef.current.find((j) => j.id === id) ?? job
          ));
          // increment done properly
          setJobs((prev) => {
            const next = prev.map((j) =>
              j.id === id ? { ...j, done: j.done + 1 } : j
            );
            jobsRef.current = next;
            return next;
          });
        } catch (err) {
          console.warn("Download failed for", img.name, err);
          setJobs((prev) => {
            const next = prev.map((j) =>
              j.id === id ? { ...j, failed: j.failed + 1, done: j.done + 1 } : j
            );
            jobsRef.current = next;
            return next;
          });
        }
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, zipName);
      updateJob(id, { status: "done" });

      // auto-remove after 4 s
      setTimeout(() => {
        setJobs((prev) => { const next = prev.filter((j) => j.id !== id); jobsRef.current = next; return next; });
      }, 4000);

    } catch (err) {
      console.error("Zip generation failed", err);
      updateJob(id, { status: "error" });
    }
  }, [updateJob]);

  const dismiss = useCallback((id) => {
    setJobs((prev) => { const next = prev.filter((j) => j.id !== id); jobsRef.current = next; return next; });
  }, []);

  return (
    <DownloadContext.Provider value={{ startDownload, jobs, dismiss }}>
      {children}
    </DownloadContext.Provider>
  );
}