import { Download, X, CheckCircle, AlertCircle } from "lucide-react";
import { useDownload } from "./DownloadContext";

const glass = "bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl rounded-2xl";

export default function DownloadToast() {
  const { jobs, dismiss } = useDownload();
  if (!jobs.length) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[99999] flex flex-col gap-3 w-80">
      {jobs.map((job) => {
        const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
        const isDone  = job.status === "done";
        const isError = job.status === "error";

        return (
          <div key={job.id} className={`${glass} p-4 text-white`}>
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-medium truncate">
                {isDone  ? <CheckCircle size={16} className="text-green-400 shrink-0" /> :
                 isError ? <AlertCircle  size={16} className="text-red-400   shrink-0" /> :
                           <Download    size={16} className="text-blue-300  shrink-0 animate-bounce" />}
                <span className="truncate">{job.name}</span>
              </div>
              {(isDone || isError) && (
                <button
                  onClick={() => dismiss(job.id)}
                  className="p-1 rounded hover:bg-white/20 transition shrink-0 ml-2"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Progress bar */}
            {!isError && (
              <>
                <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isDone ? "bg-green-400" : "bg-blue-400"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs opacity-70 mt-1">
                  <span>
                    {isDone
                      ? `Done${job.failed > 0 ? ` (${job.failed} skipped)` : ""}`
                      : `${job.done} / ${job.total} files`}
                  </span>
                  <span>{pct}%</span>
                </div>
              </>
            )}

            {isError && (
              <div className="text-xs text-red-400 mt-1">
                Failed to generate zip. Check console for details.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}