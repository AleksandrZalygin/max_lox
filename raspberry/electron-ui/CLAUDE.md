# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`iot-water-ui` — local Electron + React + TypeScript GUI for a water-tank monitoring system that runs on a Raspberry Pi 4 touchscreen. This app is the **thin client only**; all business logic, hardware control, persistence, and remote sync live in the sibling FastAPI service at `../api/`. The broader system (Arduino/ESP sensors → Raspberry Pi → optional VPS relay) is documented in `../../README.md`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Copies `index.html`, then in parallel: `tsc -w` for main, `esbuild --watch` for renderer, and launches Electron via `wait-on` once both outputs exist. |
| `npm run build` | One-shot: build main (`tsc`) → type-check renderer (`tsc --noEmit`) → bundle renderer (`esbuild`) → copy `index.html`. |
| `npm start` | Launch Electron against the existing `dist/` output (no rebuild). |
| `npm run pack` | Build + run `electron-builder` to produce a `.deb` for Raspberry Pi / Debian Linux. |
| `npm run typecheck:renderer` | Renderer type-check only (esbuild strips types without checking them). |
| `npm run build:main` / `npm run build:renderer` / `npm run copy:html` | Run just one stage when iterating. |

There is **no test runner, no ESLint, and no Prettier** configured. Type checking is the only correctness gate: `npm run build` runs `tsc --noEmit` on the renderer and emits via `tsc` for the main process.

The app expects the FastAPI backend reachable at `http://localhost:8000`. Without it, the UI loads but every panel errors. Start the backend (see `../api/` and the parent README) before `npm run dev`.

## Build pipeline

- **Main process**: `tsc -p tsconfig.main.json` → CommonJS into `dist/main/` (compiles `src/main.ts` + `src/preload.ts`).
- **Renderer**: `esbuild` bundles `src/renderer/App.tsx` (and everything it transitively imports — React, Recharts, all components/pages) into a single ESM file at `dist/renderer/App.js`. `tsconfig.renderer.json` exists purely for type checking via `tsc --noEmit`; it does not emit.
- **HTML**: `src/renderer/index.html` is copied verbatim to `dist/renderer/index.html` by `copy:html`. It loads `<script type="module" src="./App.js">`. Without the copy step the BrowserWindow loads nothing — keep it wired into every build path.
- The renderer bundle is unminified by design (faster builds, easier debugging on a Pi). Source maps are emitted in `dev` only.

## Architecture

### Process layout
- **Main** (`src/main.ts`) — creates a 1280×800 BrowserWindow. The `fullscreen` flag is the toggle for Pi touchscreen deployment; leave it `false` during desktop development.
- **Preload** (`src/preload.ts`) — exposes a single function `window.api.call(method, path, body?)` through `contextBridge`. Context isolation is on; node integration is off. Do not weaken either.
- **Renderer** (`src/renderer/`) — React 18 with a hand-rolled hash router in `App.tsx`. `react-router-dom` is in `package.json` but unused; do not import it. Routes today: `#/` (Dashboard), `#/history`, `#/calibration`.

### IPC bridge — one generic channel
There is exactly one IPC channel: `api-call`. The main process implements it as a thin HTTP proxy to `http://localhost:8000`, returning parsed JSON (or `null` for 204). To add a new backend endpoint, **add it on the FastAPI side and call it from the renderer via `window.api.call(...)`** — do not add new IPC channels unless you genuinely need privileged main-process capability (filesystem, native modules, etc.).

### Live updates bypass IPC
`Dashboard.tsx` opens its own `WebSocket` directly to `ws://localhost:8000/ws/clients` from the renderer and listens for `state_update`, `alert`, and `leak_detected` messages. This is intentional — keep new live streams in the renderer too rather than tunneling them through the main process.

### Styling
Inline style objects only. No Tailwind, no CSS modules, no global stylesheet. The palette is dark-slate (`#0f172a` background) with blue/green/red accents — match it when adding components.

## Domain rules to respect

- **Pumps toggle together.** The backend exposes a single pump-state command; never design UI that implies independent control of pump 1 vs pump 2.
- **Single `STATION_ID`** flows through Arduino, Raspberry, and VPS. UI changes that key off station identity must use the value the backend returns, not a hardcoded constant.
- **Calibration is linear.** Tank level/volume are derived from HC-SR04 distance using `distance_empty` and `distance_full` stored per-station on the backend. The conversion lives in `src/renderer/pages/CalibrationModal.tsx`; reuse it rather than re-deriving.
- **Auto-mode has ±5% hysteresis** around the target level (enforced server-side). UI should not try to issue commands inside that band — surface the current mode/target instead.
- **Leak alerts** arrive over the WebSocket (`leak_detected`); the UI is the display, not the detector.

## Packaging

`electron-builder` config lives inline in `package.json` (`appId: com.iot.watertank`, Linux `deb` target). `npm run pack` writes the installer under `dist/`. There is no Windows/macOS build configured.
