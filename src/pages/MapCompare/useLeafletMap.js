// useLeafletMap.js
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet.markercluster";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Fan out markers that share the exact same lat/lon so every pin is
 * visible even when zoomed out. First item stays at the original
 * coordinate; the rest are placed in a circle around it.
 * offsetM = radius in metres between spread pins.
 */
export function spreadDuplicates(positions, offsetM = 8) {
  const EARTH_R = 6_378_137;
  const buckets = new Map();

  for (const p of positions) {
    const key = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }

  const out = [];
  for (const group of buckets.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    group.forEach((p, i) => {
      if (i === 0) { out.push(p); return; }
      const angle = ((2 * Math.PI) / (group.length - 1)) * (i - 1);
      const dLat = (offsetM / EARTH_R) * (180 / Math.PI);
      const dLon = (offsetM / (EARTH_R * Math.cos((p.lat * Math.PI) / 180))) * (180 / Math.PI);
      out.push({ ...p, lat: p.lat + dLat * Math.sin(angle), lon: p.lon + dLon * Math.cos(angle) });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useLeafletMap(ref, DEFAULT_CENTER, DEFAULT_ZOOM) {
  const mapRef          = useRef(null);
  const singleLayerRef  = useRef(null);
  const clusterRef      = useRef(null);
  const individualRef   = useRef(null);
  const roadTileRef     = useRef(null);
  const satelliteTileRef = useRef(null);

  const [isReady,  setIsReady]  = useState(false);
  const [mapType,  setMapType]  = useState("road");     // "road" | "satellite"
  const [plotMode, setPlotMode] = useState("cluster");  // "cluster" | "individual"

  const mapTypeRef = useRef(mapType);
  useEffect(() => { mapTypeRef.current = mapType; }, [mapType]);

  /* ---- initialise map once ---- */
  useEffect(() => {
    if (!ref?.current || mapRef.current) return;

    const map = L.map(ref.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    const roadTile = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap contributors" }
    );
    const satelliteTile = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" }
    );
    roadTile.addTo(map);
    roadTileRef.current      = roadTile;
    satelliteTileRef.current = satelliteTile;

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
            <div style="background:#FFFF00;width:44px;height:44px;border-radius:50%;
              display:flex;align-items:center;justify-content:center;border:3px solid #000;
              box-shadow:0 0 15px rgba(255,255,0,.9),0 3px 10px rgba(0,0,0,.5);">
              <strong style="color:#000!important;font-size:16px!important;
                font-weight:900!important;font-family:Arial,Helvetica,sans-serif!important;">
                ${count}
              </strong>
            </div>`,
          className: "",
          iconSize: [44, 44],
        });
      },
    });

    const singleLayer     = L.layerGroup();
    const individualLayer = L.layerGroup();

    cluster.addTo(map);
    singleLayer.addTo(map);
    individualLayer.addTo(map);

    mapRef.current         = map;
    clusterRef.current     = cluster;
    singleLayerRef.current = singleLayer;
    individualRef.current  = individualLayer;

    setTimeout(() => { map.invalidateSize(); setIsReady(true); }, 100);

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try {
        singleLayer.clearLayers();
        cluster.clearLayers();
        individualLayer.clearLayers();
        map.off();
        if (map.stop) map.stop();
        map.remove();
      } catch (err) {
        console.warn("Leaflet cleanup warning:", err);
      }
      mapRef.current = singleLayerRef.current = clusterRef.current =
        individualRef.current = roadTileRef.current = satelliteTileRef.current = null;
      setIsReady(false);
    };
  }, [ref, DEFAULT_CENTER, DEFAULT_ZOOM]);

  /* ---- satellite guard popup helper ---- */
  const attachMarkerClickBehavior = useCallback((marker) => {
    if (!marker || !mapRef.current) return;
    marker.off("click.__satellite_guard");
    marker.on("click.__satellite_guard", (e) => {
      if (mapTypeRef.current === "satellite") {
        e?.originalEvent?.preventDefault?.();
        e?.originalEvent?.stopPropagation?.();
        L.popup({ maxWidth: 260, className: "leaflet-popup-custom" })
          .setLatLng(marker.getLatLng())
          .setContent("Map data not yet available")
          .openOn(mapRef.current);
        return;
      }
      if (typeof marker.openPopup === "function" && marker.getPopup?.()) {
        marker.openPopup();
      }
    });
  }, []);

  /* ---- toggleMapType ---- */
  const toggleMapType = useCallback(() => {
    if (!mapRef.current || !roadTileRef.current || !satelliteTileRef.current) return;
    setMapType((prev) => {
      const next = prev === "road" ? "satellite" : "road";
      if (next === "satellite") {
        mapRef.current.removeLayer(roadTileRef.current);
        mapRef.current.addLayer(satelliteTileRef.current);
      } else {
        mapRef.current.removeLayer(satelliteTileRef.current);
        mapRef.current.addLayer(roadTileRef.current);
      }
      return next;
    });
  }, []);

  /* ---- togglePlotMode – just toggle; MapCompare re-plots via useEffect ---- */
  const togglePlotMode = useCallback(() => {
    setPlotMode((prev) => (prev === "cluster" ? "individual" : "cluster"));
  }, []);

  /* ---- setMarker (single-image focus) ---- */
  const setMarker = useCallback(
    (pos, center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, popupHtml = null) => {
      if (!mapRef.current || !singleLayerRef.current) return;
      clusterRef.current?.clearLayers();
      singleLayerRef.current.clearLayers();
      individualRef.current?.clearLayers();

      if (pos && typeof pos.lat === "number" && typeof pos.lon === "number") {
        const m = L.marker([pos.lat, pos.lon]).addTo(singleLayerRef.current);
        if (popupHtml) m.bindPopup(popupHtml, { maxWidth: 400, closeButton: true, autoClose: true, className: "leaflet-popup-custom" });
        attachMarkerClickBehavior(m);
        const targetZoom = mapTypeRef.current === "satellite" ? 15 : 17;
        mapRef.current.setView([pos.lat, pos.lon], targetZoom, { animate: true });
      } else {
        mapRef.current.setView(center, zoom);
      }
    },
    [DEFAULT_CENTER, DEFAULT_ZOOM, attachMarkerClickBehavior]
  );

  /**
   * setMarkers – called by MapCompare with pre-processed positions.
   * In CLUSTER mode  → positions are already grouped (one per coordinate).
   * In INDIVIDUAL mode → positions are ungrouped (one per image);
   *                      duplicates are spread into a small circle here.
   */
  const setMarkers = useCallback(
    (positions = [], center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, mode = "cluster") => {
      if (!mapRef.current) return;

      clusterRef.current?.clearLayers();
      singleLayerRef.current?.clearLayers();
      individualRef.current?.clearLayers();

      if (positions.length === 0) {
        mapRef.current.setView(center, zoom);
        return;
      }

      const bounds = [];

      if (mode === "individual") {
        const spread = spreadDuplicates(positions);
        spread.forEach((p) => {
          if (typeof p.lat !== "number" || typeof p.lon !== "number") return;
          const marker = L.marker([p.lat, p.lon]);
          if (p.popupHtml) marker.bindPopup(p.popupHtml, { maxWidth: 400, className: "leaflet-popup-custom" });
          attachMarkerClickBehavior(marker);
          individualRef.current.addLayer(marker);
          bounds.push([p.lat, p.lon]);
        });
      } else {
        positions.forEach((p) => {
          if (typeof p.lat !== "number" || typeof p.lon !== "number") return;
          const marker = L.marker([p.lat, p.lon]);
          if (p.popupHtml) marker.bindPopup(p.popupHtml, { maxWidth: 400, className: "leaflet-popup-custom" });
          attachMarkerClickBehavior(marker);
          clusterRef.current.addLayer(marker);
          bounds.push([p.lat, p.lon]);
        });
      }

      if (bounds.length > 0) {
        mapRef.current.fitBounds(bounds, { padding: [100, 100], maxZoom: 15 });
      }
    },
    [DEFAULT_CENTER, DEFAULT_ZOOM, attachMarkerClickBehavior]
  );

  const setMarkersCluster = setMarkers;

  return {
    mapInstance: mapRef.current,
    setMarker,
    setMarkers,
    setMarkersCluster,
    toggleMapType,
    mapType,
    togglePlotMode,
    plotMode,
    isReady,
  };
}