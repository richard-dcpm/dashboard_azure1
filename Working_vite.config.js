import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  server: {
	headers: {
	   "Cross-Origin-Opener-Policy": "same-origin-allow-popups"
	}
  }
});
