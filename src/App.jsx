import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";

import AuthProvider        from "./components/AuthProvider";
import UploadQueueProvider from "./components/UploadQueueProvider";
import UploadProgressModal from "./components/UploadProgressModal"; // ← still imported here
import ErrorBoundary       from "./components/ErrorBoundary";
import 'leaflet/dist/leaflet.css';

const Dashboard    = lazy(() => import("./pages/Dashboard"));
const Uploader     = lazy(() => import("./components/Uploader/Uploader"));
const ImageGallery = lazy(() => import("./components/ImageGallery"));
const MapCompare   = lazy(() => import("./pages/MapCompare"));
const Reck         = lazy(() => import("./pages/Reck"));
const ADDi         = lazy(() => import("./pages/ADDi"));

const LoadingSpinner = () => (
  <div style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>
);
const NotFound = () => (
  <div style={{ padding: "2rem", textAlign: "center" }}>
    <h2>404 — Page not found</h2>
    <p>The page you're looking for doesn't exist.</p>
  </div>
);

function AppContent() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      {/*
        Modal is INSIDE the router so useLocation() works.
        It renders nothing when on /uploader (layout handles progress inline there).
        On all other pages it shows the slim floating bar.
      */}
      <UploadProgressModal />

      <Routes>
        <Route path="/dashboard"   element={<Dashboard />} />
        <Route path="/uploader"    element={<Uploader />} />
        <Route path="/Uploader"    element={<Navigate to="/uploader" replace />} />
        <Route path="/upload"      element={<Navigate to="/uploader" replace />} />
        <Route path="/gallery"     element={<ImageGallery />} />
        <Route path="/Gallery"     element={<Navigate to="/gallery" replace />} />
        <Route path="/reck"        element={<Reck />} />
        <Route path="/addi"        element={<ADDi />} />
        <Route path="/map"         element={<ErrorBoundary><MapCompare /></ErrorBoundary>} />
        <Route path="/"            element={<Navigate to="/dashboard" replace />} />
        <Route path="*"            element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <UploadQueueProvider>
          <HashRouter>
            <AppContent />
          </HashRouter>
        </UploadQueueProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}