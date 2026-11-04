import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
