// Breadcrumbs.jsx
import React from "react";

/**
 * pathSegments: array of breadcrumb segments relative to container (e.g., ["processed","CouncilA","RoadX"])
 * onCrumbClick(index): navigate to this level (index inclusive). To go root, call onCrumbClick(-1) from your parent.
 */
export default function Breadcrumbs({ pathSegments, onCrumbClick }) {
  if (!pathSegments || pathSegments.length === 0) {
    // Nothing to show at top-level
    return null;
  }

  return (
    <nav className="flex items-center gap-2 text-sm text-gray-600" aria-label="Breadcrumb">
      {pathSegments.map((seg, idx) => (
        <span key={idx} className="flex items-center">
          {idx > 0 && <span className="mx-2 text-gray-300">/</span>}
          <button
            type="button"
            onClick={() => onCrumbClick(idx)}
            className="px-1 py-0.5 rounded hover:bg-gray-100 text-gray-700"
          >
            {seg}
          </button>
        </span>
      ))}
    </nav>
  );
}
