import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/');
          if (normalized.includes('/src/components/AdvancedAnalyticsSection.jsx')) return 'advanced-analytics';
          if (normalized.includes('/node_modules/react')) return 'vendor-react';
          if (normalized.includes('/node_modules/date-fns')) return 'vendor-date';
          if (normalized.includes('/src/i18n/')) return 'app-i18n';
          if (normalized.includes('/src/components/')) return 'app-components';
          if (normalized.includes('/src/context/')) return 'app-context';
          if (normalized.includes('/src/api.js') || normalized.includes('/src/utils/')) return 'app-core';
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 400
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/privacy-policy': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/cookie-policy': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/terms': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
