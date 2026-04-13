import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import LoginSuccessPage from './components/LoginSuccessPage';
import './styles.css';

const isLoginSuccessRoute = typeof window !== 'undefined' && window.location.pathname === '/login-success';
const RootComponent = isLoginSuccessRoute ? LoginSuccessPage : App;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
