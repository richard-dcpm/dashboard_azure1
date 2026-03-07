
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";

import AuthProvider from "./components/AuthProvider";
import UploadQueueProvider from "./components/UploadQueueProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import 'leaflet/dist/leaflet.css';
import UploadProgressModal from "./components/UploadProgressModal";

// Lazy load pages/components
const Dashboard    = lazy(() => import("./pages/Dashboard"));
const Uploader     = lazy(() => import("./components/Uploader/Uploader"));       // SDK-only version
const ImageGallery = lazy(() => import("./components/ImageGallery"));   // SDK-only version
const MapCompare   = lazy(() => import("./pages/MapCompare"));          // ensure SDK version
const Reck = lazy(() => import("./pages/Reck"));
const ADDi = lazy(() => import("./pages/ADDi")); 

const LoadingSpinner = () => (
  <div style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>
);

const NotFound = () => (
  <div style={{ padding: "2rem", textAlign: "center" }}>
    <h2>404 — Page not found</h2>
    <p>The page you’re looking for doesn’t exist.</p>
  </div>
);

function AppContent() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        {/* Primary */}
        <Route path="/dashboard"    element={<Dashboard />} />

        {/* Tools (updated, SDK-only) */}
        <Route path="/uploader"     element={<Uploader />} />
        {/* Aliases to handle legacy links or different casing */}
        <Route path="/Uploader"     element={<Navigate to="/uploader" replace />} />
        <Route path="/upload"       element={<Navigate to="/uploader" replace />} />

        <Route path="/gallery"      element={<ImageGallery />} />
        <Route path="/Gallery"      element={<Navigate to="/gallery" replace />} />
		<Route path="/reck"         element={<Reck />} />
		<Route path="/addi"         element={<ADDi />} />
		
        /*<Route path="/map-compare"  element={<MapCompare />} />*/
		<Route path="/map"          element={
                                <ErrorBoundary>
                                    <MapCompare />
                                </ErrorBoundary>
                            }
                        />
        {/* Default redirect */}
        <Route path="/"             element={<Navigate to="/dashboard" replace />} />

        {/* 404 */}
        <Route path="*"             element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <UploadQueueProvider>
		  <UploadProgressModal />
          <HashRouter>
            <AppContent />
          </HashRouter>
        </UploadQueueProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
