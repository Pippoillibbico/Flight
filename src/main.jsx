import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import LoginSuccessPage from './components/LoginSuccessPage';
import './styles.css';
import './styles/presentation/index.css';
import './styles/cta-system.css';
import './styles/cinematic-theme.css';
import './styles/pricing-higgsfield.css';
import './styles/landing-pricing-refresh.css';

// Register service worker for VAPID Web Push support
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failure is non-fatal — app works without push
    });
  });
}

const isLoginSuccessRoute = typeof window !== 'undefined' && window.location.pathname === '/login-success';
const RootComponent = isLoginSuccessRoute ? LoginSuccessPage : App;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
