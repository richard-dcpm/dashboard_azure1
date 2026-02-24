// useLeafletMap.js
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet.markercluster";

export function useLeafletMap(ref, DEFAULT_CENTER, DEFAULT_ZOOM) {
  const mapRef = useRef(null);
  const singleLayerRef = useRef(null);
  const clusterRef = useRef(null);
  const roadTileRef = useRef(null);
  const satelliteTileRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [mapType, setMapType] = useState("road"); // "road" or "satellite"

  useEffect(() => {
    if (!ref?.current) return;
    if (mapRef.current) return;

    const map = L.map(ref.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    // Road map layer
    const roadTile = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    });

    // Satellite layer (Esri World Imagery)
    const satelliteTile = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "© Esri, Maxar, Earthstar Geographics",
    });

    // Add road layer by default
    roadTile.addTo(map);
    roadTileRef.current = roadTile;
    satelliteTileRef.current = satelliteTile;

    // Cluster layer with neon yellow styling
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 50,
      chunkedLoading: true,
      chunkDelay: 16,
      chunkInterval: 200,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: (cl) => {
        const count = cl.getChildCount();
        return L.divIcon({
          html: `
            <div style="
              background: #FFFF00;
              width: 44px;
              height: 44px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              border: 3px solid #000;
              box-shadow: 0 0 15px rgba(255,255,0,0.9), 0 3px 10px rgba(0,0,0,0.5);
            ">
              <strong style="
                color: #000 !important;
                font-size: 16px !important;
                font-weight: 900 !important;
                font-family: Arial, Helvetica, sans-serif !important;
                text-rendering: optimizeLegibility !important;
                -webkit-font-smoothing: antialiased !important;
              ">${count}</strong>
            </div>`,
          className: "",
          iconSize: [44, 44],
        });
      },
    });

    const singleLayer = L.layerGroup();

    cluster.addTo(map);
    singleLayer.addTo(map);

    mapRef.current = map;
    clusterRef.current = cluster;
    singleLayerRef.current = singleLayer;

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
        map.off();
        if (map.stop) map.stop();
        map.remove();
      } catch (err) {
        console.warn("Leaflet cleanup warning:", err);
      }
      mapRef.current = null;
      singleLayerRef.current = null;
      clusterRef.current = null;
      roadTileRef.current = null;
      satelliteTileRef.current = null;
      setIsReady(false);
    };
  }, [ref, DEFAULT_CENTER, DEFAULT_ZOOM]);

  const toggleMapType = useCallback(() => {
    if (!mapRef.current || !roadTileRef.current || !satelliteTileRef.current) return;

    setMapType((prev) => {
      const newType = prev === "road" ? "satellite" : "road";
      
      if (newType === "satellite") {
        mapRef.current.removeLayer(roadTileRef.current);
        mapRef.current.addLayer(satelliteTileRef.current);
      } else {
        mapRef.current.removeLayer(satelliteTileRef.current);
        mapRef.current.addLayer(roadTileRef.current);
      }
      
      return newType;
    });
  }, []);

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

  const setMarkers = useCallback(
    (positions = [], center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM) => {
      if (!mapRef.current || !clusterRef.current) return;
      clusterRef.current.clearLayers();
      singleLayerRef.current.clearLayers();

      if (positions.length > 0) {
        const bounds = [];
        positions.forEach((p) => {
          const marker = L.marker([p.lat, p.lon]);
          if (p.popupHtml) marker.bindPopup(p.popupHtml);
          clusterRef.current.addLayer(marker);
          bounds.push([p.lat, p.lon]);
        });

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
    toggleMapType,
    mapType,
    isReady,
  };
}