import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initAnalytics } from './analytics.ts';
import { initErrors } from './errors.ts';
import './index.css';
import { Root } from './Root.tsx';
import { LocaleProvider } from './strings/index.tsx';

initErrors();
initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <Root />
    </LocaleProvider>
  </StrictMode>,
);
