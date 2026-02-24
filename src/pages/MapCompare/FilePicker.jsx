
// FilePicker.jsx
import React, { useRef } from "react";

export default function FilePicker({ multiple = true, onFiles }) {
  const inputRef = useRef(null);

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => onFiles(Array.from(e.target.files || []))}
      />
      <button
        className="px-4 py-2 rounded-lg bg-blue-600 text-white shadow hover:bg-blue-700 transition"
        onClick={() => inputRef.current?.click()}
      >
        Choose image{multiple ? "s" : ""}
      </button>
      <span className="text-xs text-gray-500">PNG • JPG • WEBP</span>
    </div>
  );
}
