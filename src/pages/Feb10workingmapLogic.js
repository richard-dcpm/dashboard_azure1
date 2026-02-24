
// mapLogic.js
import L from "leaflet";
import "leaflet.markercluster"; // ⬅️ enables clustering

/**
 * initMap: creates a Leaflet map with a single-marker layer and a cluster layer.
 * Returns { map, singleLayer, clusterLayer }
 *
 * NOTE: Ensure CSS for markercluster is imported in your app entry:
 *   import 'leaflet.markercluster/dist/MarkerCluster.css';
 *   import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
 */
export function initMap(ref, center, zoom) {
  if (!ref) return null;
  // Prevent double initialization
  if (ref._leaflet_instance) {
    return ref._leaflet_instance;
  }

  const map = L.map(ref, {
    zoomControl: true,
    attributionControl: true,
  }).setView(center, zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  const singleLayer = L.layerGroup().addTo(map);

  const clusterLayer = L.markerClusterGroup({
    spiderfyOnEveryZoom: false,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 45,
    iconCreateFunction: (cl) => {
	  const count = cl.getChildCount();
	  return L.divIcon({
		html: `
		  <div style="
			background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
			color: white;
			width: 36px;
			height: 36px;
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: bold;
			border: 2px solid white;
			box-shadow: 0 2px 6px rgba(0,0,0,0.4);
		  ">
			<span>${count}</span>
		  </div>`,
		className: "custom-cluster-marker",
		iconSize: [36, 36]
	  });
	},
  }).addTo(map);

  // Force Leaflet to recalc size after initialization
  setTimeout(() => map.invalidateSize(), 250);

  const instance = { map, singleLayer, clusterLayer };
  ref._leaflet_instance = instance;
  return instance;
}

export function destroyMap(ref) {
  if (!ref || !ref._leaflet_instance) return;
  try {
    const { map } = ref._leaflet_instance;
    map.remove();
  } catch (e) {
    console.warn("Leaflet cleanup warning:", e);
  }
  delete ref._leaflet_instance;
}

/**
 * updateMarker: single pin focus.
 */
 /*
export function updateMarker(map, singleLayer, pos, defaultCenter, defaultZoom, popupHtml = null) {
  if (!map || !singleLayer) return;
  singleLayer.clearLayers();

  if (pos) {
    const m = L.marker([pos.lat, pos.lon]).addTo(singleLayer);
    if (popupHtml) {
      m.bindPopup(popupHtml, {
        maxWidth: 400,
        closeButton: true,
        autoClose: true,
        className: "leaflet-popup-custom",
      });
    }
    map.setView([pos.lat, pos.lon], 17, { animate: true });
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}
*/

export function updateMarker(map, singleLayer, pos, defaultCenter, defaultZoom, popupHtml = null) {
  if (!map || !singleLayer) return;
  singleLayer.clearLayers();

  if (pos) {
    const m = L.marker([pos.lat, pos.lon]).addTo(singleLayer);
    if (popupHtml) m.bindPopup(popupHtml);
    
    // Logic Update: Set zoom to 15 (instead of 17) to keep road context 
    // and avoid "grey/blurred" tiles on slow connections.
    map.setView([pos.lat, pos.lon], 15, { animate: true });
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}

/**
 * updateMarkersCluster: add multiple markers with clustering.
 * positions: [{ lat, lon, popupHtml? }, ...]
 */
 /*
export function updateMarkersCluster(map, clusterLayer, positions = [], defaultCenter, defaultZoom) {
  if (!map || !clusterLayer) return;
  clusterLayer.clearLayers();

  if (positions.length > 0) {
    const bounds = [];
    positions.forEach((p) => {
      if (p && typeof p.lat === "number" && typeof p.lon === "number") {
        const m = L.marker([p.lat, p.lon]);
        if (p.popupHtml) {
          m.bindPopup(p.popupHtml, { maxWidth: 400, className: "leaflet-popup-custom" });
        }
        clusterLayer.addLayer(m);
        bounds.push([p.lat, p.lon]);
      }
    });
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}
*/
/*
export function updateMarkersCluster(map, clusterLayer, positions = [], defaultCenter, defaultZoom) {
  if (!map || !clusterLayer) return;
  clusterLayer.clearLayers();

  if (positions.length > 0) {
    const bounds = [];
    positions.forEach((p) => {
      if (p && typeof p.lat === "number" && typeof p.lon === "number") {
        const m = L.marker([p.lat, p.lon]);
        if (p.popupHtml) {
          m.bindPopup(p.popupHtml, { maxWidth: 250 });
        }
        clusterLayer.addLayer(m);
        bounds.push([p.lat, p.lon]);
      }
    });

    if (bounds.length > 0) {
      // Logic Fix: maxZoom: 15 prevents blurring and keeps road paths visible.
      // padding: [80, 80] ensures markers aren't touching the edge of the UI.
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    }
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}
*/
/*
export function updateMarkersCluster(map, clusterLayer, positions = [], defaultCenter, defaultZoom) {
  if (!map || !clusterLayer) return;
  clusterLayer.clearLayers();

  if (positions.length > 0) {
    const bounds = [];
    positions.forEach((p) => {
      if (p && typeof p.lat === "number" && typeof p.lon === "number") {
        const m = L.marker([p.lat, p.lon]);
        if (p.popupHtml) {
          m.bindPopup(p.popupHtml, { maxWidth: 250 });
        }
        clusterLayer.addLayer(m);
        bounds.push([p.lat, p.lon]);
      }
    });

    if (bounds.length > 0) {
      // Logic Fix: maxZoom: 15 prevents "blurring" by not zooming too deep.
      // padding: [80, 80] ensures markers aren't hidden behind UI elements.
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
    }
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}
*/
export function updateMarkersCluster(map, clusterLayer, positions = [], defaultCenter, defaultZoom) {
  if (!map || !clusterLayer) return;
  clusterLayer.clearLayers();

  if (positions.length > 0) {
    const bounds = [];
    positions.forEach((p) => {
      if (p && typeof p.lat === "number" && typeof p.lon === "number") {
        const m = L.marker([p.lat, p.lon]);
        if (p.popupHtml) {
          m.bindPopup(p.popupHtml, { maxWidth: 300 });
        }
        clusterLayer.addLayer(m);
        bounds.push([p.lat, p.lon]);
      }
    });

    if (bounds.length > 0) {
      // LOGIC FIX: Set maxZoom to 15 to prevent map blurring/loading issues.
      // Increased padding to [100, 100] to ensure road paths around markers are visible.
      map.fitBounds(bounds, { 
        padding: [100, 100], 
        maxZoom: 15,
        animate: true 
      });
    }
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}