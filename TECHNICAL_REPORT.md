# Requestal V2 — Comprehensive Technical Report

**Requestal** is an enterprise-grade Google Chrome DevTools and Side Panel extension designed to bridge the gap between manual web application security testing and automated fuzzing. Built on **Manifest V3 (MV3)**, Requestal enables security researchers, penetration testers, bug bounty hunters, and web developers to capture, intercept, modify, format-shift, replay, and diff network requests seamlessly within their browser workflow.

---

## 🛠️ 1. Technology Stack & Library Ecosystem

| Category | Technology / Library | Version | Technical Role & Purpose |
| :--- | :--- | :--- | :--- |
| **Extension Architecture** | Manifest V3 (MV3) | Latest Chrome Spec | Service worker background model, Chrome Side Panel API, webRequest interception, CDP debugger session, local storage IPC. |
| **UI Framework** | React | `^19.2.0` | Declarative UI rendering, reactive component state management, hook-based lifecycle isolation. |
| **State Management** | Zustand | `^5.0.15` | Modular, decoupled state stores (`useCaptureStore`, `useSettingsStore`, `useScopeStore`, `useProfileStore`). |
| **Database & Persistence** | Dexie (IndexedDB) | `^4.4.5` | High-capacity asynchronous storage for 10,000+ full requests, redirect chains, and responses with LRU auto-pruning. |
| **List Virtualization** | `@tanstack/react-virtual` | `^3.14.9` | 60 FPS smooth rendering for massive traffic captures without memory bottlenecks. |
| **Code Editor** | Monaco Editor | `^0.55.1` | VS Code editing engine powering single raw request editor, syntax highlighting, and dual diff views. |
| **Monaco React Wrapper** | `@monaco-editor/react` | `^4.7.0` | React component integration for Monaco initialization, lifecycle disposal, and instance management. |
| **Type System** | TypeScript | `~5.9.3` | Strict type definitions across HAR schemas, HTTP parser abstractions, and extension message payloads. |
| **Build & Bundling** | Vite | `^7.2.4` | High-speed ESM development and production bundling engine. |
| **Vite Plugins** | `@vitejs/plugin-react`<br>`@tailwindcss/vite` | `^5.1.1`<br>`^4.1.18` | React Fast Refresh support and Tailwind CSS v4 compilation pipeline. |
| **Styling Framework** | Tailwind CSS | `^4.1.18` | Modern design system with dark-mode color tokens and responsive utilities. |
| **Style Utilities** | `clsx`<br>`tailwind-merge` | `^2.1.1`<br>`^3.4.0` | Dynamic class merging and Tailwind specificity conflict resolution. |
| **Layout Management** | `react-resizable` | `^3.0.5` | Drag-and-drop handles for adjusting side panel sidebar width dynamically. |
| **Icons & Indicators** | `lucide-react` | `^0.562.0` | Vector icons for network controls, state indicators, diff tabs, and format warning badges. |
| **Unit Testing** | Vitest | `^4.1.10` | Fast unit and integration test runner covering parser engines, scope rules, and state transitions. |

---

## 🏗️ 2. Architectural Architecture & System Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  CHROME BROWSER ENGINE                                  │
└────────────────────────────┬────────────────────────────────────┬───────────────────────┘
                             │ (webRequest / CDP Debugger)        │ (Active Tab / DOM)
                             ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           BACKGROUND SERVICE WORKER                                     │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────────────────────┐  │
│  │     Standard Engine (webRequest)│   │          Pro Engine (chrome.debugger)       │  │
│  │  - onBeforeRequest (Body Map)   │   │  - CDP Fetch & Network domains              │  │
│  │  - onBeforeSendHeaders (HAR)    │   │  - Response body extraction                 │  │
│  │  - onBeforeRedirect (Multi-hop) │   │  - Live Traffic Intercept & Breakpoints     │  │
│  └────────────────┬────────────────┘   └──────────────────────┬──────────────────────┘  │
│                   │                                           │                         │
│                   └─────────────────────┬─────────────────────┘                         │
│                                         ▼                                               │
│                         ┌───────────────────────────────┐                               │
│                         │   IndexedDB Persistence (Dexie)│                              │
│                         │   - Request/Response Storage  │                               │
│                         │   - LRU Retention Pruning     │                               │
│                         └───────────────┬───────────────┘                               │
│                                         │                                               │
│                                         ▼                                               │
│                      Broadcast via chrome.runtime.sendMessage                           │
└─────────────────────────────────────────┬───────────────────────────────────────────────┘
                                          │ (Extension IPC Message)
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                SIDE PANEL APPLICATION                                   │
│                                                                                         │
│  ┌─────────────────────────┐   ┌─────────────────────────┐   ┌───────────────────────┐  │
│  │     useCaptureStore     │   │     useSettingsStore    │   │     useScopeStore     │  │
│  │ - Virtualized Table     │   │ - Clean / Diff / Pro    │   │ - Inclusion / Rules   │  │
│  │ - Request Selection     │   │ - Tab & Width State     │   │ - Exclusion Noise     │  │
│  └────────────┬────────────┘   └────────────┬────────────┘   └───────────┬───────────┘  │
│               │                             │                            │              │
│               └─────────────────────────────┼────────────────────────────┘              │
│                                             ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 MONACO WORKSPACE                                  │  │
│  │  - Raw HTTP/1.1 Editor & FUZZ Keybinding (Ctrl+Cmd+I)                             │  │
│  │  - Lossless Method Toggle (POST <-> GET & JSON structure reconstruction)          │  │
│  │  - Dual Diff View: Legacy Myers Text Diff + Structural JSON Diff                  │  │
│  │  - Passive Secret & Token Scanner (Real-time Token alerts)                        │  │
│  │  - 1-Click Multi-Account Auth Profile Swapper (Cookie & Bearer)                   │  │
│  └──────────────────────────────────────────┬────────────────────────────────────────┘  │
│                                             │                                           │
│                                             ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           DISPATCH & EXPLOITATION SUITE                           │  │
│  │  - Native HTTP Fetch Dispatcher (credentials: 'include')                          │  │
│  │  - CLI Command Generator: curl, ffuf (clusterbomb), sqlmap, nuclei                 │  │
│  │  - 1-Click .req File Downloader for external CLI fuzzing                          │  │
│  │  - Live Intercept Bar (Resume / Drop / Edit)                                      │  │
│  └───────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 3. Deep Dive into Core Subsystems

### 3.1. Dual Capture Engine & Live Traffic Interception
**Location**: `src/extension/background/index.ts` & `src/core/capture/proEngine.ts`

Requestal operates a dual-tier network interception pipeline:

1. **Standard Engine (`chrome.webRequest`)**:
   - `onBeforeRequest`: Intercepts and parses request payloads (Form URL-encoded, JSON, multipart).
   - `onBeforeSendHeaders`: Extracts actual wire headers and serializes to HAR 1.2.
   - `onBeforeRedirect`: Retains multi-hop redirect records (e.g. 302 login POST requests) so initial credentials are never lost.
2. **Pro Engine (`chrome.debugger` / CDP Protocol)**:
   - Attaches Chrome DevTools Protocol debugger sessions to capture full HTTP/HTTPS **response bodies** (`Network.getResponseBody`).
   - Extracts JavaScript **initiator stack traces** to determine exactly what line of code triggered each request.
   - **Live Interception & Breakpoints**: Pauses in-flight requests/responses via CDP `Fetch.requestPaused`. Displays real-time editable headers and body in the side panel, allowing researchers to inspect, alter, and forward (`Fetch.continueRequest`) or drop (`Fetch.failRequest`) traffic.
   - **Ghost-Pause SW Recovery**: Automatically unpauses stalled requests if the background service worker enters idle sleep.

---

### 3.2. Lossless Request Method Toggling (POST ⟷ GET)
**Location**: `src/core/format/methodToggle.ts`

Provides a 1-click conversion between HTTP methods with zero format loss:

- **POST (or PUT / PATCH) ➔ GET**:
  - Automatically parses Form-UrlEncoded or JSON request bodies and appends/merges parameters into the URL query string (`/path?user=admin&id=105`).
  - Cleans up `Content-Type` and `Content-Length` headers from the request.
  - Clears the request body.
- **GET ➔ POST**:
  - Extracts URL query parameters and strips them from the request line path.
  - **Intelligent Structure Reconstruction**: Parses nested JSON strings, boolean primitives (`true`/`false`), and numbers, restoring structured JSON bodies (`{"user":{"name":"admin"},"active":true}`) when complex structures or `Content-Type: application/json` are detected.
  - Sets `Content-Type: application/json` or `application/x-www-form-urlencoded` automatically.

---

### 3.3. Multi-Account Auth Profiles & IDOR Testing
**Location**: `src/panel/components/ProfileSwitcher.tsx` & `src/panel/stores/useProfileStore.ts`

Accelerates Broken Object-Level Authorization (BOLA/IDOR) testing:
- Manage multiple named authorization profiles (e.g. `Admin`, `User A (Victim)`, `User B (Attacker)`).
- Stores session cookies, Bearer tokens, or raw JWT strings.
- 1-click header injection into the active Monaco editor instance.

---

### 3.4. Target Scope Management & Real-Time Secret Scanner
**Location**: `src/core/scope/scopeEngine.ts` & `src/core/secrets/detect.ts`

1. **Target Scope Rules**:
   - Inclusion rules: Only log requests matching specific domains/regex patterns (e.g. `.*\.target\.com`).
   - Exclusion rules: Automatically drops analytics, font CDNs, telemetry, and tracking noise.
2. **Passive Secret Scanner**:
   - Continuously scans captured traffic for high-risk exposed credentials:
     - AWS Access Keys (`AKIA[0-9A-Z]{16}`)
     - Stripe Secret Keys (`sk_live_[0-9a-zA-Z]{24}`)
     - GitHub Personal Access Tokens (`ghp_[0-9a-zA-Z]{36}`)
     - Slack Webhooks & Bot Tokens (`xoxb-[0-9]{11,13}-...`)
     - Unmasked JSON Web Tokens (JWT)

---

### 3.5. Multi-Tool CLI Fuzzing & Exploitation Bridge
**Location**: `src/panel/components/CommandPreview.tsx`

Bridges in-browser testing directly into command-line tooling:
- **`curl`**: Generates exact terminal reproduction commands.
- **`ffuf`**: Generates fuzzing commands with automated wordlist placeholders (`FUZZ`).
- **`sqlmap`**: Generates database vulnerability exploitation commands with `--batch` and `--level=2`.
- **`nuclei`**: Generates vulnerability scanner commands targeting the endpoint.
- **1-Click `.req` File Download**: Exports raw HTTP requests as files for direct ingestion by CLI tools (`sqlmap -r request.req`).

---

### 3.6. Dual Diff Engine & Monaco Lifecycle Safety
**Location**: `src/core/diff/engine.ts`, `src/core/diff/structuralDiff.ts`, & `src/panel/components/RequestDiffEditor.tsx`

1. **Text Diff (`smartDiff`)**:
   - Normalizes line endings (`\n`) and masks volatile fields (ISO/Unix timestamps, cache headers, JWT signatures).
   - Configured with Monaco's `diffAlgorithm: 'legacy'` (Myers algorithm) to prevent line range computation errors.
2. **Structural JSON Diff (`computeStructuralDiff`)**:
   - Computes key-level semantic diffs on JSON payloads with metric chips (`+added`, `~modified`, `-removed`).
3. **Monaco React Lifecycle Safety**:
   - Explicitly disposes models and calls `.setModel(null)` prior to component unmount to eliminate race-condition memory leaks.

---

## 📁 4. Project Directory Map

```
Requestal/
├── public/
│   └── manifest.json                    # Extension Manifest V3 configuration (v2.0.0)
├── src/
│   ├── core/
│   │   ├── capture/
│   │   │   └── proEngine.ts             # CDP Debugger engine & live traffic interception
│   │   ├── diff/
│   │   │   ├── engine.ts                # Smart Diff noise-reduction engine (timestamps/JWT)
│   │   │   └── structuralDiff.ts        # Semantic JSON structural diff computer
│   │   ├── dispatcher/
│   │   │   ├── client.ts                # Raw HTTP parser and Fetch dispatcher
│   │   │   └── proxyRelay.ts            # Proxy relay integration
│   │   ├── format/
│   │   │   ├── converter.ts             # JSON <-> Form converter & format detector
│   │   │   ├── harAdapter.ts            # webRequest / CDP to HAR 1.2 adapter
│   │   │   └── methodToggle.ts          # Lossless POST <-> GET method switch engine
│   │   ├── scope/
│   │   │   └── scopeEngine.ts           # Target scope inclusion/exclusion matcher
│   │   ├── secrets/
│   │   │   └── detect.ts                # Real-time passive secret & token scanner
│   │   └── storage/
│   │       ├── db.ts                    # Dexie IndexedDB traffic database
│   │       ├── index.ts                 # Unified baseline storage interface
│   │       └── retention.ts             # LRU storage pruning & retention policies
│   ├── extension/
│   │   ├── background/
│   │   │   └── index.ts                 # Background service worker (dual capture listener)
│   │   └── devtools/
│   │       └── index.ts                 # DevTools panel registration
│   ├── pages/
│   │   ├── devtools.html                # DevTools entry point
│   │   ├── panel.html                   # Standalone panel view
│   │   └── sidepanel.html               # Chrome Side Panel entry point
│   ├── panel/
│   │   ├── components/
│   │   │   ├── CommandPreview.tsx       # CLI command generator (curl, ffuf, sqlmap, nuclei)
│   │   │   ├── ErrorBoundary.tsx        # React UI error boundary
│   │   │   ├── FidelityBadge.tsx        # Request capture fidelity indicator
│   │   │   ├── InterceptBar.tsx         # Live traffic interception control strip
│   │   │   ├── ProfileSwitcher.tsx      # Multi-account auth profile switcher
│   │   │   ├── RequestDiffEditor.tsx    # Monaco dual-pane diff editor (Text + Structural)
│   │   │   ├── RequestEditor.tsx        # Monaco single HTTP editor with FUZZ keybinding
│   │   │   └── ScopeModal.tsx           # Target scope configuration modal
│   │   ├── hooks/
│   │   │   └── useEditorState.ts        # Content validation & RFC violation detector
│   │   ├── stores/
│   │   │   ├── useCaptureStore.ts       # Captured traffic list, selection & baseline pinning
│   │   │   ├── useProfileStore.ts       # Multi-account auth profile store
│   │   │   ├── useScopeStore.ts         # Scope rules store
│   │   │   └── useSettingsStore.ts      # Settings, clean mode, diff mode & layout store
│   │   ├── App.tsx                      # Core Requestal layout & reactive coordinator
│   │   ├── main.tsx                     # React root mount
│   │   └── monacoSetup.ts               # Monaco web worker loaders
│   └── shared/
│       └── utils/
│           ├── encoding.ts              # UTF-8 & base64 encoding utilities
│           └── http.ts                  # HAR-to-Raw formatter & telemetry filter
├── tests/
│   └── unit/
│       ├── converter.test.ts            # Form/JSON conversion test suite
│       ├── diff_engine.test.ts          # Smart diff noise reduction tests
│       ├── dispatcher.test.ts           # HTTP parser and fetch dispatch tests
│       ├── interception_lifecycle.test.ts # CDP interception lifecycle tests
│       ├── method_toggle.test.ts        # POST <-> GET round-trip preservation tests
│       ├── scope.test.ts                # Scope matching tests
│       ├── secrets.test.ts              # Token & secret detection tests
│       ├── storage_retention.test.ts    # IndexedDB LRU retention tests
│       └── sw_restart_ghost_pause.test.ts # SW crash/restart ghost pause recovery tests
├── package.json                         # Project dependencies and npm scripts (v2.0.0)
├── vite.config.ts                       # Vite multi-entrypoint build configuration
├── eslint.config.js                     # ESLint 9 Flat Config
└── README.md                            # Public repository overview and quick start
```

---

## ⚙️ 5. Build, Quality Assurance & Verification

### 5.1. Automated Test Suite (Vitest)
Requestal includes **37 unit and integration tests** across 9 test suites:
```bash
npm test
```
- **Interception Lifecycle**: Validates CDP `Fetch.requestPaused`, `continueRequest`, and `failRequest`.
- **Method Toggle Integrity**: Verifies lossless `POST (JSON) ➔ GET ➔ POST (JSON)` round trips with nested hierarchy preservation.
- **Storage Retention**: Verifies automatic LRU eviction when reaching request limits.
- **Service Worker Restart Recovery**: Verifies that pending intercepted requests are cleanly resumed if the background service worker restarts.
- **Scope & Secret Scanning**: Validates regex boundaries across various token types and domain scopes.

### 5.2. Code Quality & Static Analysis
```bash
npm run lint
```
- Fully migrated to **ESLint 9 Flat Config** with TypeScript strict rules and zero linter warnings.

### 5.3. Production Build
```bash
npm run build
```
Executes TypeScript typecheck (`tsc -b`) and bundles multi-entry point HTML/JS assets into the `/dist` directory, optimized for Chrome Web Store and developer unpacking.
