// useLeafletMap.js
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet.markercluster"; // ⬅️ clustering plugin

/**
 * NOTE: Remember to import the markercluster CSS in your app entry:
 *   import 'leaflet.markercluster/dist/MarkerCluster.css';
 *   import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
 *
 * Optional CSS for an elegant cluster badge (put into your global CSS):
 *
 * .custom-cluster-icon { background: transparent !important; border: none !important; }
 * .cluster-badge {
 *   display: grid; place-items: center; border-radius: 9999px;
 *   color: #0b1220;
 *   background: linear-gradient(180deg, #ffffff 0%, #e6f0ff 100%);
 *   box-shadow: 0 4px 12px rgba(9, 30, 66, 0.15);
 *   border: 1px solid rgba(9, 30, 66, 0.08);
 * }
 * .cluster-badge > span { font-weight: 700; line-height: 1; }
 * .cluster-sm { width: 32px; height: 32px; font-size: 12px; }
 * .cluster-md { width: 40px; height: 40px; font-size: 13px; }
 * .cluster-lg { width: 48px; height: 48px; font-size: 14px; }
 */

export function useLeafletMap(ref, DEFAULT_CENTER, DEFAULT_ZOOM) {
  const mapRef = useRef(null);
  const singleLayerRef = useRef(null); // single marker layer group
  const clusterRef = useRef(null);     // cluster group
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!ref?.current) return;
    if (mapRef.current) return;

    const map = L.map(ref.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    // --- Elegant cluster group ---
	// Inside your L.markerClusterGroup configuration in useLeafletMap.js
	const cluster = L.markerClusterGroup({
	  showCoverageOnHover: false,
	  zoomToBoundsOnClick: true,
	  maxClusterRadius: 50,
	  iconCreateFunction: (cl) => {
		const count = cl.getChildCount();
		// High-contrast blue styling
		return L.divIcon({
		  html: `
			<div style="
			  background: #2563eb; 
			  color: white; 
			  width: 36px; height: 36px; 
			  border-radius: 50%; 
			  display: flex; align-items: center; justify-content: center; 
			  font-weight: bold; border: 2px solid white; 
			  box-shadow: 0 2px 6px rgba(0,0,0,0.4);">
			  ${count}
			</div>`,
		  className: "custom-cluster-marker",
		  iconSize: [36, 36]
		});
	  },
	});
    // Dedicated layer for single marker behavior
    const singleLayer = L.layerGroup();

    cluster.addTo(map);
    singleLayer.addTo(map);

    mapRef.current = map;
    clusterRef.current = cluster;
    singleLayerRef.current = singleLayer;

    // Initial resize fix
    setTimeout(() => {
      map.invalidateSize();
      setIsReady(true);
    }, 100);

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try {
        singleLayer.clearLayers();
        cluster.clearLayers();
        // Stop animations & detach events before removing to avoid _leaflet_pos issues
        map.off();
        if (map.stop) map.stop();
        map.remove();
      } catch (err) {
        console.warn("Leaflet cleanup warning:", err);
      }
      mapRef.current = null;
      singleLayerRef.current = null;
      clusterRef.current = null;
      setIsReady(false);
    };
  }, [ref, DEFAULT_CENTER, DEFAULT_ZOOM]);

  /**
   * Place a single marker and optionally bind popup HTML.
   * Keeps backward compatibility with your existing usage.
   */
  const setMarker = useCallback(
    (pos, center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, popupHtml = null) => {
      if (!mapRef.current || !singleLayerRef.current) return;

      singleLayerRef.current.clearLayers();

      if (pos && typeof pos.lat === "number" && typeof pos.lon === "number") {
        const m = L.marker([pos.lat, pos.lon]).addTo(singleLayerRef.current);
        if (popupHtml) {
          m.bindPopup(popupHtml, {
            maxWidth: 400,
            closeButton: true,
            autoClose: true,
            className: "leaflet-popup-custom",
          });
        }
        mapRef.current.setView([pos.lat, pos.lon], 17, { animate: true });
      } else {
        mapRef.current.setView(center, zoom);
      }
    },
    [DEFAULT_CENTER, DEFAULT_ZOOM]
  );
  
  /**
   * Multi-marker clustering with optional popup per point.
   * positions: [{ lat, lon, popupHtml? }, ...]
   */
  const setMarkersCluster = useCallback(
    (positions = [], center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM) => {
      if (!mapRef.current || !clusterRef.current) return;
      clusterRef.current.clearLayers();

      if (positions.length > 0) {
        const bounds = [];
        positions.forEach((p) => {
          if (p && typeof p.lat === "number" && typeof p.lon === "number") {
            const marker = L.marker([p.lat, p.lon]);
            if (p.popupHtml) {
              marker.bindPopup(p.popupHtml, {
                maxWidth: 400,
                className: "leaflet-popup-custom",
              });
            }
            clusterRef.current.addLayer(marker);
            bounds.push([p.lat, p.lon]);
          }
        });
        if (bounds.length > 0) {
          mapRef.current.fitBounds(bounds, { padding: [100, 100] });
        }
      } else {
        mapRef.current.setView(center, zoom);
      }
    },
    [DEFAULT_CENTER, DEFAULT_ZOOM]
  );

  /**
   * Backward compatible "setMarkers" API: now clusters by default.
   */
	const setMarkers = useCallback(
	  (positions = [], center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM) => {
		if (!mapRef.current || !clusterRef.current) return;
		clusterRef.current.clearLayers();
		singleLayerRef.current.clearLayers(); // Ensure single pins don't overlap clusters

		if (positions.length > 0) {
		  const bounds = [];
		  positions.forEach((p) => {
			const marker = L.marker([p.lat, p.lon]);
			if (p.popupHtml) marker.bindPopup(p.popupHtml);
			clusterRef.current.addLayer(marker);
			bounds.push([p.lat, p.lon]);
		  });
		  
		  // padding: [100, 100] ensures road paths are visible around the markers
		  mapRef.current.fitBounds(bounds, { padding: [100, 100], maxZoom: 15 });
		} else {
		  mapRef.current.setView(center, zoom);
		}
	  },
	  [DEFAULT_CENTER, DEFAULT_ZOOM]
	);
  return {
    mapInstance: mapRef.current,
    setMarker,
    setMarkers,
    setMarkersCluster,
    isReady,
  };
}