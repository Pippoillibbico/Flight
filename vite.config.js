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
          if (normalized.includes('/src/features/admin-dashboard/')) return 'feature-admin-dashboard';
          if (normalized.includes('/src/features/ai-gateway/')) return 'feature-ai-gateway';
          if (normalized.includes('/src/features/app-shell/hooks/operations/')) return 'feature-app-shell-ops';
          if (normalized.includes('/src/features/app-shell/hooks/')) return 'feature-app-shell-hooks';
          if (normalized.includes('/src/features/app-shell/ui/')) return 'feature-app-shell-ui';
          if (normalized.includes('/src/features/app-shell/domain/')) return 'feature-app-shell-domain';
          if (normalized.includes('/src/features/booking-handoff/')) return 'feature-booking-handoff';
          if (normalized.includes('/src/features/funnel-tracking/')) return 'feature-funnel-tracking';
          if (normalized.includes('/src/features/monetization/')) return 'feature-monetization';
          if (normalized.includes('/src/components/LiveDealsRadarSection.jsx')) return 'feature-live-deals';
          if (normalized.includes('/src/components/OpportunityFeedSection.jsx')) return 'feature-opportunity-feed';
          if (normalized.includes('/src/components/PersonalHubSection.jsx')) return 'feature-personal-hub';
          if (normalized.includes('/node_modules/react')) return 'vendor-react';
          if (normalized.includes('/node_modules/date-fns')) return 'vendor-date';
          if (normalized.includes('/src/i18n/')) return 'app-i18n';
          if (normalized.includes('/src/components/')) return 'app-components-core';
          if (normalized.includes('/src/context/')) return 'app-context';
          if (normalized.includes('/src/api.js') || normalized.includes('/src/utils/')) return 'app-core';
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 450
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
