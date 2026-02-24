
// FolderBrowser.jsx
import React from "react";

export default function FolderBrowser({ folders, files, onOpenFolder, onSelectFile }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {folders.map((f) => {
        const name = f.endsWith("/") ? f.slice(0, -1) : f;
        const last = name.split("/").filter(Boolean).pop();
        return (
          <button
            key={f}
            onClick={() => onOpenFolder(f)}
            className="group flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:shadow transition text-left"
          >
            <div className="w-9 h-9 rounded bg-blue-50 flex items-center justify-center text-blue-600">📁</div>
            <div className="truncate">
              <div className="text-sm font-medium text-gray-900 truncate">{last}</div>
              <div className="text-xs text-gray-500">Folder</div>
            </div>
          </button>
        );
      })}
      {files.map((file) => {
        const name = file.name.split("/").pop();
        return (
          <button
            key={file.name}
            onClick={() => onSelectFile(file)}
            className="group p-2 rounded-lg border border-gray-200 bg-white hover:shadow transition text-left"
            title={name}
          >
            <div className="aspect-video w-full rounded bg-gray-50 overflow-hidden flex items-center justify-center">
              <img src={file.url} alt={name} className="max-h-24 object-contain" loading="lazy" />
            </div>
            <div className="mt-2 text-xs text-gray-600 truncate">{name}</div>
          </button>
        );
      })}
    </div>
  );
}
