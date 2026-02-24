import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React core
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor'
            }
            
            // React Router
            if (id.includes('react-router')) {
              return 'router'
            }
            
            // Azure SDK (if you're using it)
            if (id.includes('@azure')) {
              return 'azure-sdk'
            }
            
            // Everything else
            return 'vendor'
          }
        }
      }
    },
    chunkSizeWarningLimit: 800,
  }
})