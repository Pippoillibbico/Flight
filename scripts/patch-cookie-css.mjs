import { readFileSync, writeFileSync } from 'node:fs';

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const path = resolve(__dirname, '../src/styles/base.css');
const lines = readFileSync(path, 'utf8').split('\n');

// Lines 7826–8180 (1-indexed) = indices 7825–8179 (0-indexed)
const START = 7825;
const END   = 8179; // exclusive in splice

const NEW_CSS = `/* ═══════════════════════════════════════════════════════════════════
   COOKIE CONSENT BANNER
   ═══════════════════════════════════════════════════════════════════ */

/* Push page content up while banner is visible */
body.has-cookie-banner .page,
body.has-cookie-banner main {
  padding-bottom: var(--cookie-banner-offset, 160px);
}
@media (max-width: 600px) {
  body.has-cookie-banner .page,
  body.has-cookie-banner main {
    padding-bottom: var(--cookie-banner-offset, 240px);
  }
}

/* ── Floating banner card ──────────────────────────────────────── */
.ck-banner {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  width: min(560px, calc(100vw - 32px));
  background: rgba(8, 14, 26, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.55),
    0 2px 8px rgba(0, 0, 0, 0.35),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  overflow: hidden;
  animation: ck-slide-up 0.25s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes ck-slide-up {
  from { opacity: 0; transform: translateX(-50%) translateY(16px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.ck-banner__body {
  padding: 20px 20px 16px;
  display: grid;
  gap: 10px;
}

.ck-banner__head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.ck-banner__icon {
  color: #5aabff;
  flex-shrink: 0;
  display: flex;
}

.ck-banner__title {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.01em;
}

.ck-banner__desc {
  font-size: 13px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.65);
  margin: 0;
}

.ck-banner__links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.ck-link {
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  min-height: auto;
  box-shadow: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.15s ease;
}
.ck-link:hover {
  color: rgba(255, 255, 255, 0.75);
}
.ck-link:focus-visible {
  outline: 2px solid #3f8dff;
  outline-offset: 2px;
  border-radius: 3px;
}

.ck-link-sep {
  color: rgba(255, 255, 255, 0.2);
  font-size: 11px;
  user-select: none;
}

/* ── Action buttons ────────────────────────────────────────────── */
.ck-banner__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.ck-btn {
  padding: 14px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  border-radius: 0;
  background: transparent;
  transition: background 0.15s ease;
  text-align: center;
  letter-spacing: 0.01em;
  min-height: 48px;
  line-height: 1;
}
.ck-btn:focus-visible {
  outline: 2px solid #3f8dff;
  outline-offset: -2px;
}

/* Reject — neutral, left */
.ck-btn--reject {
  color: rgba(255, 255, 255, 0.65);
  border-right: 1px solid rgba(255, 255, 255, 0.07);
}
.ck-btn--reject:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
}

/* Accept — brand blue, right */
.ck-btn--accept {
  color: #5ab4ff;
}
.ck-btn--accept:hover {
  background: rgba(63, 141, 255, 0.1);
  color: #78c4ff;
}

/* Save (modal footer) */
.ck-btn--save {
  background: #1a5fd4;
  color: #ffffff;
  border-radius: 8px;
  padding: 11px 20px;
}
.ck-btn--save:hover { background: #1e6de8; }

/* ── Settings overlay & modal ──────────────────────────────────── */
.ck-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(4, 9, 20, 0.7);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px;
  animation: ck-fade-in 0.2s ease both;
}

@keyframes ck-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@media (min-width: 480px) {
  .ck-overlay {
    align-items: center;
  }
}

.ck-modal {
  width: min(520px, 100%);
  max-height: min(600px, calc(100vh - 32px));
  background: #0c1422;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ck-modal-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes ck-modal-in {
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to   { opacity: 1; transform: none; }
}

.ck-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.ck-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
}

.ck-modal__close {
  appearance: none;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  padding: 0;
  min-height: auto;
  box-shadow: none;
}
.ck-modal__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}
.ck-modal__close:focus-visible {
  outline: 2px solid #3f8dff;
  outline-offset: 2px;
}

.ck-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

/* ── Category rows ─────────────────────────────────────────────── */
.ck-cat {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
}

.ck-cat__info {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 4px;
}

.ck-cat__name {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  cursor: default;
}

label.ck-cat__name {
  cursor: pointer;
}

.ck-cat__desc {
  font-size: 12px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.45);
}

.ck-cat__divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 0 20px;
}

/* ── Always-on badge ───────────────────────────────────────────── */
.ck-toggle--always {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #22d48a;
  background: rgba(34, 212, 138, 0.1);
  border: 1px solid rgba(34, 212, 138, 0.25);
  border-radius: 999px;
  padding: 4px 10px;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1;
}

/* ── Toggle switch button ──────────────────────────────────────── */
.ck-toggle__btn {
  appearance: none;
  flex-shrink: 0;
  width: 44px;
  height: 26px;
  border-radius: 999px;
  padding: 3px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.15);
  transition: background 0.2s ease, border-color 0.2s ease;
  position: relative;
  box-shadow: none;
  min-height: auto;
  display: flex;
  align-items: center;
}
.ck-toggle__btn:focus-visible {
  outline: 2px solid #3f8dff;
  outline-offset: 2px;
}
.ck-toggle__btn--on {
  background: #1a5fd4;
  border-color: #1a5fd4;
}
.ck-toggle__btn--on:hover { background: #1e6de8; border-color: #1e6de8; }
.ck-toggle__btn:not(.ck-toggle__btn--on):hover {
  background: rgba(255, 255, 255, 0.18);
}

.ck-toggle__knob {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}
.ck-toggle__btn--on .ck-toggle__knob {
  transform: translateX(18px);
  background: #ffffff;
}

/* ── Modal footer ──────────────────────────────────────────────── */
.ck-modal__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.ck-modal__footer .ck-btn--reject {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  padding: 11px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.ck-modal__footer .ck-btn--reject:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.75);
}

.ck-modal__footer .ck-btn--save,
.ck-modal__footer .ck-btn--accept {
  flex: 1;
}
.ck-modal__footer .ck-btn--accept {
  background: rgba(63, 141, 255, 0.12);
  color: #5ab4ff;
  border-radius: 8px;
  padding: 11px 16px;
  border: 1px solid rgba(63, 141, 255, 0.25);
}
.ck-modal__footer .ck-btn--accept:hover {
  background: rgba(63, 141, 255, 0.18);
  color: #78c4ff;
}

/* ── Reopen pill ───────────────────────────────────────────────── */
.ck-pill {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9980;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid rgba(90, 171, 255, 0.25);
  background: rgba(10, 18, 34, 0.88);
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  min-height: auto;
}
.ck-pill:hover {
  background: rgba(15, 28, 55, 0.95);
  border-color: rgba(90, 171, 255, 0.45);
  color: rgba(255, 255, 255, 0.75);
}
.ck-pill:focus-visible {
  outline: 2px solid #3f8dff;
  outline-offset: 2px;
}

/* ── Screen-reader only ────────────────────────────────────────── */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── Mobile tweaks ─────────────────────────────────────────────── */
@media (max-width: 480px) {
  .ck-banner {
    bottom: 12px;
    border-radius: 14px;
  }
  .ck-overlay {
    padding: 0;
    align-items: flex-end;
  }
  .ck-modal {
    border-radius: 16px 16px 0 0;
    max-height: 90vh;
  }
  .ck-pill {
    right: 10px;
    bottom: 10px;
  }
}

`;

lines.splice(START, END - START, NEW_CSS);

writeFileSync(path, lines.join('\n'), 'utf8');
console.log('CSS patched. New total lines:', lines.length);
