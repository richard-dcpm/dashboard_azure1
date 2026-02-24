// ContainerPicker.jsx
import React from "react";

/**
 * Props:
 * - value: string (currently selected option)
 * - options: string[] (e.g., ["raw", "processed", "labeled"])
 * - onChange: (opt: string) => void
 */
export default function ContainerPicker({ value, options, onChange }) {
  return (
    <div
      role="group"
      aria-label="Select container"
      className="inline-flex flex-wrap items-center gap-2"
    >
      {options.map((opt) => {
        const isActive = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={isActive}
            className={
              "px-3 py-1.5 rounded-full border text-sm transition " +
              (isActive
                ? "bg-blue-600 border-blue-600 text-white shadow"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50")
            }
          >
            {opt.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
