
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
			background: linear-gradient(135deg, #FFFF00 0%, #FFD700 100%);
			width: 42px;
			height: 42px;
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
			border: 3px solid #000000;
			box-shadow: 0 0 12px rgba(255, 255, 0, 0.8), 0 2px 8px rgba(0,0,0,0.4);
		  ">
			<span style="
			  color: #000000 !important;
			  font-weight: 900 !important;
			  font-size: 15px !important;
			  font-family: Arial, sans-serif !important;
			  text-shadow: 0 0 2px rgba(255,255,255,0.5);
			  line-height: 1;
			">${count}</span>
		  </div>`,
		className: "custom-cluster-marker",
		iconSize: [42, 42]
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

// mapLogic.js
export function updateMarkersCluster(map, clusterLayer, positions = [], defaultCenter, defaultZoom) {
  if (!map || !clusterLayer) return;

  clusterLayer.clearLayers();

  if (positions.length > 0) {
    const markers = [];
    const bounds = [];

    for (const p of positions) {
      if (p && typeof p.lat === "number" && typeof p.lon === "number") {
        const m = L.marker([p.lat, p.lon]);
        if (p.popupHtml) m.bindPopup(p.popupHtml, { maxWidth: 300 });
        markers.push(m);
        bounds.push([p.lat, p.lon]);
      }
    }

    // ✅ one shot add (works nicely with chunkedLoading)
    clusterLayer.addLayers(markers);

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [100, 100], maxZoom: 15, animate: true });
    }
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}