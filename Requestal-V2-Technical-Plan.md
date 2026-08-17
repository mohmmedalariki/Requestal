# Requestal V2 — Technical Architecture & Efficiency Plan

**Goal of this document:** turn Requestal from a "good enough for manual testing" capture tool into a wire-accurate, professional-grade traffic capture/replay/diff platform that can sit credibly next to Caido, Burp, and mitmproxy in a real engagement — without losing the thing that makes it valuable in the first place: it lives *inside the browser*, next to your session, with zero proxy/CA setup.

Everything below is grounded in the actual Chrome/Chromium extension platform behavior (webRequest, DevTools Protocol, chrome.debugger, storage quotas), verified against current Chrome documentation, not assumptions. Where a claim needs to be empirically re-verified against your own build, that's called out explicitly — I'd rather tell you "verify this" than let you ship on a guess.

---

## 0. Executive Summary

The Caido-vs-Requestal diff you posted is not a random inconsistency — it's two distinct, well-documented platform limitations plus one implementation bug, and all three are fixable:

| # | Symptom | Root Cause | Fix Complexity |
|---|---|---|---|
| 1 | `Cookie`, `Referer`, `Origin`, `Accept-Language`, `Accept-Encoding` missing | Chrome's `webRequest` API silently withholds these specific headers unless you pass `'extraHeaders'` in `opt_extraInfoSpec` | **Trivial** — one-line listener change, no new permissions |
| 2 | `Connection`, `Content-Length`, `Cache-Control` missing | These are **never** exposed to `webRequest`, under *any* flag combination — Chrome documents this explicitly as a hard API boundary | **Architectural** — requires switching capture engine to the DevTools Protocol (CDP) via `chrome.debugger` |
| 3 | Form body parameter order scrambled (`lcsrf_token, ptinstalledlang, ptlangcd...` vs. the real submission order) | Requestal is very likely reconstructing the body from `requestBody.formData` (a parsed key→value dictionary) instead of `requestBody.raw` (the actual byte stream) | **Trivial** — prefer raw bytes, fall back to formData only when raw is unavailable |

V2's job is to fix #1 and #3 immediately (same permissions, same architecture, just correcting API usage), and to introduce a second, optional high-fidelity capture engine built on CDP to close #2 and unlock a set of genuinely "pro" capabilities Caido/Burp have that a webRequest-only tool structurally cannot: full wire headers, WebSocket frames, response bodies for *organic* traffic (not just replay), initiator call stacks, and true request interception via the CDP `Fetch` domain.

The plan is organized so you can ship value incrementally: **Phase 1 (fidelity fixes) is a few days of work and requires zero new permissions or user-facing changes.** Everything after that is additive.

Fidelity is only one axis, though. §16 audits every other stage of the pipeline — capture→IPC, editing/validation, dispatch, response handling, diffing, rendering, startup, memory — for the same kind of "where does this actually lose time or correctness" scrutiny applied to capture in §1, since a wire-accurate capture that then jankers on a 5,000-row list or hangs on a stuck fetch isn't actually a professional-grade tool. §17 does the same pass for reliability: every place the current design (or the fixes proposed here) could silently produce wrong data, lose data, or crash, with a concrete fix for each.

---

## 1. Root Cause Analysis

### 1.1 Category A — Headers hidden by Chrome unless `extraHeaders` is set

Chrome's own `chrome.webRequest` reference is explicit about this. Starting in Chrome 72, these request headers are **not provided** to `onBeforeSendHeaders` / `onSendHeaders` unless the listener passes `'extraHeaders'` in `opt_extraInfoSpec`:

- `Accept-Language`
- `Accept-Encoding`
- `Referer`
- `Cookie`

And starting in Chrome 79, this one joined the list:

- `Origin`

The response-side equivalent: `Set-Cookie` has been hidden the same way since Chrome 72, and `X-Frame-Options` since Chrome 89.

**This maps exactly onto your diff.** Every header Requestal is missing that Caido has — `Origin`, `Accept-Language`, `Referer`, `Cookie` — is in this list. Nothing else needs to change; you don't need CDP, you don't need a new permission, you don't need the `debugger` API. You need to add one string to two `addListener` calls.

```ts
// src/extension/background/index.ts — current (implied)
chrome.webRequest.onBeforeSendHeaders.addListener(
  handleHeaders,
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// Fixed
chrome.webRequest.onBeforeSendHeaders.addListener(
  handleHeaders,
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]   // <-- the fix
);
```

Chrome's own docs note that `extraHeaders` "may have a negative impact on performance" — in practice this is negligible for an observational (non-blocking) listener; it matters more for blocking listeners that hold up every request. Since Requestal is purely observational, this is a non-issue. Worth a quick before/after profiling pass anyway (see §12).

**Cookie deserves a callout of its own** since it's the highest-value fix in your diff and also the most sensitive: once this is on, Requestal is capturing live session cookies for every request it observes, on every site the extension has host permission for. That has real implications for §9 (redaction defaults, storage encryption posture, and being honest in your permissions justification if this ever goes to the Chrome Web Store).

### 1.2 Category B — Headers `webRequest` never exposes, period

This is the part that's easy to miss because it isn't a flag you forgot — it's a hard boundary Chrome documents directly:

> *"The API does not provide the final HTTP headers that are sent to the network. For example, all headers that are related to caching are invisible to the extension."*

And the explicit list of headers **never provided to `onBeforeSendHeaders`, under any `opt_extraInfoSpec`**:

```
Authorization, Cache-Control, Connection, Content-Length, Host,
If-Modified-Since, If-None-Match, If-Range, Partial-Data, Pragma,
Proxy-Authorization, Proxy-Connection, Transfer-Encoding
```

`Connection`, `Content-Length`, and `Cache-Control` — the three headers missing from your Requestal capture that aren't in Category A — are all on this list. There is no `opt_extraInfoSpec` value that recovers them from `webRequest`. This isn't a Requestal bug; it's `webRequest` sitting on top of an abstraction that doesn't guarantee to show you what Chrome's own network stack does after the extension layer.

This category splits further into two useful buckets for the fix:

- **B1 — safely derivable without capturing anything.** `Content-Length` is just the byte length of the body you already captured — compute it, don't guess it. `Host` is already synthesized correctly by Requestal from the target URL; keep that, it's the right approach for this specific header.
- **B2 — must be captured via a different API, or explicitly marked unknown.** `Cache-Control`, `Connection`, `Authorization` (when not duplicated elsewhere), `If-Modified-Since`, `If-None-Match`, `Pragma`, `Transfer-Encoding`. These genuinely vary per-request and per-browser-state; **never synthesize these** — a guessed `Connection: keep-alive` on an HTTP/2 request would be actively wrong, since HTTP/2 forbids connection-specific header fields entirely (RFC 7540 §8.1.2.2). Either capture them properly (§2) or leave them out and say so.

### 1.3 Category C — Body parameter order

Look closely at the two bodies:

```
Requestal: lcsrf_token, ptinstalledlang, ptlangcd, ptmode, pwd, timezoneOffset, userid
Caido:     lcsrf_token, timezoneOffset, ptmode, ptlangcd, ptinstalledlang, userid, pwd
```

Requestal's order is alphabetical. Caido's is the real submission order. This is a strong signal that the body reconstruction path is going through `requestBody.formData` — the pre-parsed `{key: [values]}` dictionary Chrome hands you for `application/x-www-form-urlencoded` and `multipart/form-data` bodies — rather than `requestBody.raw`, the actual `ArrayBuffer` of bytes that hit the wire. Chrome's parsed `formData` object has never made an ordering guarantee, and in practice it frequently normalizes to something other than submission order.

Your own architecture doc already says the harAdapter "decodes raw post bytes... if `requestBody.raw` is present," which suggests the raw path exists but the form-urlencoded case is likely falling through to the `formData` branch (Chrome populates `formData` automatically for that content type, so it's the "available" one). The fix is a priority inversion, not new code:

```ts
// src/core/format/harAdapter.ts
function extractBody(requestBody: chrome.webRequest.WebRequestBody): string {
  // ALWAYS prefer raw bytes — they are byte-identical to the wire.
  if (requestBody.raw?.length) {
    return decodeRawBytes(requestBody.raw); // TextDecoder, as already implemented
  }
  // formData is a *fallback of last resort* — only reachable when Chrome
  // genuinely didn't give us raw bytes (rare; some multipart edge cases).
  if (requestBody.formData) {
    return reconstructFromFormDataFallback(requestBody.formData); // clearly labeled lower-fidelity
  }
  return "";
}
```

Flag any body reconstructed via the `formData` fallback with a small "reconstructed, order not guaranteed" badge in the UI rather than presenting it as identical to what was sent — this is the same fidelity-transparency principle that should run through the rest of V2 (see §3.6).

### 1.4 The hard ceiling

Even with every fix in this document applied, a browser extension — any browser extension, using any combination of `webRequest`, `chrome.devtools.network`, or CDP via `chrome.debugger` — is consuming an abstraction Chrome's network stack chooses to expose. Caido, Burp, and mitmproxy sit on the actual TCP/TLS socket as a real intercepting proxy; they see literally every byte, because they *are* the wire. No extension API gives that guarantee, including CDP.

That's not a reason to stop closing the gap — CDP closes nearly all of it, as shown below — but it's worth stating plainly rather than promising "100% parity" and quietly falling short later. §8.5 proposes a concrete way to get guaranteed byte-perfect fidelity when you actually need it, by bridging to the mitmproxy pipeline you've already built, rather than pretending an in-browser tool can fully replace a wire-level proxy.

---

## 2. V2 Capture Architecture — Dual Engine

### 2.1 Engine comparison

| | `chrome.webRequest` (+extraHeaders) | `chrome.devtools.network` | CDP via `chrome.debugger` |
|---|---|---|---|
| Requires new permission | No | No (needs DevTools panel open) | Yes — `"debugger"` |
| User-visible cost | None | None | Chrome shows an "is debugging this browser" infobar |
| Sees Cookie/Referer/Origin/Accept-* | Yes, with `extraHeaders` | Yes (DevTools has elevated access) | Yes — via `Network.requestWillBeSentExtraInfo`, described by Chrome as "raw request headers as they will be sent over the wire" |
| Sees Connection/Cache-Control/Content-Length | **No, never** | Partial, inconsistent | Best available — CDP is the only extension-facing API designed to expose wire-level headers |
| Works with side panel only (DevTools closed) | Yes | **No** — requires an open DevTools instance for that tab | Yes |
| Original response bodies | No (webRequest cannot read bodies) | Yes, via `getContent()` | Yes, via `Network.getResponseBody` |
| WebSocket frame contents | No (only sees the upgrade handshake) | Limited | Yes — `Network.webSocketFrameSent` / `Received` |
| True request interception (pause, edit, forward) | No (MV3 removed blocking `webRequest` for Web-Store extensions) | No | **Yes** — CDP `Fetch` domain (`Fetch.enable` + `Fetch.requestPaused` + `Fetch.continueRequest`/`fulfillRequest`) |
| Initiator call stack | Basic origin string only | Partial | Full — `Network.requestWillBeSent.initiator` with stack trace |

The takeaway: `chrome.devtools.network` isn't actually a great primary engine for a side-panel-first tool, since it only fires while DevTools is attached to the tab — it's a nice *supplementary* source when the DevTools panel happens to be open (cheap response-body access via `getContent()`), but it can't be the backbone. The real fidelity jump comes from CDP.

### 2.2 Proposed architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CAPTURE ORCHESTRATOR (background SW)             │
│                                                                          │
│  Standard Engine (always on)          Pro Engine (opt-in)                │
│  chrome.webRequest + extraHeaders     chrome.debugger + CDP Network/Fetch│
│  - onBeforeRequest (raw body)         - Network.enable                   │
│  - onBeforeSendHeaders                - Network.requestWillBeSent        │
│  - onSendHeaders                      - Network.requestWillBeSentExtraInfo│
│  - onResponseStarted / onCompleted    - Network.responseReceivedExtraInfo│
│                                        - Network.getResponseBody         │
│                                        - Network.webSocketFrame*         │
│                                        - Fetch.requestPaused (intercept) │
│                                                                          │
│        └──────────────┬─────────────────────────┬──────────────────────┘│
│                        ▼                         ▼                       │
│              Reconciliation Layer (see §2.4) — merges both streams       │
│                        ▼                                                 │
│              IndexedDB (Dexie) — single source of truth (see §4)         │
└──────────────────────────────────────────────────────────────────────────┘
```

Both engines run concurrently. Standard Engine guarantees *something* is always captured, with zero extra permission friction, and is what ships to users who decline the debugger prompt. Pro Engine, when attached, supplies the fields Standard Engine structurally cannot get, and its data wins on merge for any field it provides.

### 2.3 Capture Fidelity Modes

Make this a first-class, user-visible toggle rather than a hidden implementation detail — professional tools should never let a user silently work off incomplete data without knowing it:

- **Standard Mode** (default): `webRequest` + `extraHeaders`. No debugger banner. Misses Category B headers (Connection, Cache-Control, Content-Length-as-observed, Authorization-adjacent caching headers). Good for day-to-day passive recon.
- **Pro Mode** (opt-in per session or pinned on): attaches `chrome.debugger` to the active tab, layers in CDP. Full header fidelity, response bodies for organic traffic, WebSocket capture, optional live interception via `Fetch`. Costs the visible "being debugged" infobar Chrome always shows for `chrome.debugger` — there is no way around this banner; it's a Chrome platform decision, not something Requestal can suppress, and users should understand that going in.

Surface the mode clearly in the side panel header (a small badge: "Standard" / "Pro · debugging active"), and let it be toggled per-tab, since a researcher won't always want the banner on every tab they have open.

### 2.4 Reconciliation: correlating two different ID spaces

`chrome.webRequest`'s `requestId` and CDP's `Network.requestId` are **different ID spaces** — there's no shared identifier to join on directly. The reconciliation layer needs a correlation key built from data both engines expose:

```ts
type CorrelationKey = string; // `${tabId}|${method}|${url}|${bucketedTimestamp}`

function correlate(webRequestEvent, cdpEvent): CorrelationKey {
  // bucket timestamps to a small epsilon (e.g. 50ms) since the two engines
  // observe the same physical request at slightly different points in its
  // lifecycle (webRequest fires earlier than CDP's requestWillBeSentExtraInfo
  // in some cases, and the ordering between them is not guaranteed — the CDP
  // docs say so explicitly for requestWillBeSentExtraInfo).
}
```

Use a short-lived pending buffer (a few hundred ms) keyed by this correlation key; when both engines' records for the same physical request arrive, merge with CDP fields taking precedence, and flush to IndexedDB as one canonical `CapturedRequest`. If only one engine reports a given request (e.g., Pro Mode is off, or CDP occasionally misses one), flush on a timeout with whatever you have and mark the fidelity level accordingly.

### 2.5 MV3 service-worker lifecycle risk

This is a real reliability trap, not a nice-to-have: MV3 background service workers are terminated after a period of inactivity, and a naive implementation that keeps `requestBodies`, pending correlation buffers, or the `chrome.debugger` attachment state purely in SW memory will silently lose data on a SW restart mid-capture.

Mitigations to build in from day one:

1. **IndexedDB, not memory, is the source of truth.** Flush aggressively; treat in-memory maps as a cache, never as the only copy.
2. **Re-attach on wake.** On SW startup, check whether the tab the user was capturing still exists and re-attach `chrome.debugger` / re-register `webRequest` listeners; don't assume state survived.
3. **Use `chrome.alarms` as a heartbeat**, not `setInterval` (which dies with the SW) — a periodic alarm both keeps housekeeping running (the existing 60s `requestBodies` cleanup, for example) and gives you a reliable place to detect "did I just get restarted?"
4. **Treat `chrome.debugger.onEvent` traffic as an implicit keep-alive** — an active debugger session with incoming events is one of the conditions Chrome uses to judge a service worker as still busy, but don't rely on this being bulletproof; the alarm-based re-attach is the real safety net.

---

## 3. Capture Fidelity — Concrete Engineering Tasks

### 3.1 Immediate fix (ship this first, this week)

- Add `'extraHeaders'` to `onBeforeSendHeaders` and `onSendHeaders` listeners.
- Add `'extraHeaders'` to `onHeadersReceived` so `Set-Cookie` and (from Chrome 89) `X-Frame-Options` are captured on the response side too.
- No manifest changes, no new permissions, no UX changes. This alone closes 5 of the 8 missing/incorrect fields in your diff (`Cookie`, `Referer`, `Origin`, `Accept-Language`, `Accept-Encoding`).

### 3.2 Raw-bytes-first body reconstruction

As in §1.3 — invert the priority so `requestBody.raw` is always preferred, `formData` is a clearly-labeled fallback. Add a unit test fixture using exactly this MMU login request as a regression case (see §12.1) so this class of bug can't silently come back.

### 3.3 CDP integration (Pro Mode)

```ts
// src/extension/background/cdp/attach.ts
async function attachProEngine(tabId: number) {
  await chrome.debugger.attach({ tabId }, "1.3");
  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
    maxTotalBufferSize: 100_000_000,
    maxResourceBufferSize: 50_000_000,
  });

  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId !== tabId) return;
    switch (method) {
      case "Network.requestWillBeSent":
        handleBasicRequest(params); // initiator, timing, resourceType
        break;
      case "Network.requestWillBeSentExtraInfo":
        handleRawHeaders(params);   // <-- Cookie, Connection, Cache-Control, etc.
        break;
      case "Network.responseReceivedExtraInfo":
        handleRawResponseHeaders(params); // Set-Cookie, real response wire headers
        break;
      case "Network.loadingFinished":
        fetchResponseBody(params.requestId); // Network.getResponseBody
        break;
      case "Network.webSocketFrameSent":
      case "Network.webSocketFrameReceived":
        handleWsFrame(method, params);
        break;
    }
  });
}
```

Important caveat to design around, not paper over: `Network.requestWillBeSentExtraInfo` is not guaranteed to fire for every request, and Chrome's own docs state there's no guaranteed ordering between it and `requestWillBeSent`. Build the reconciliation buffer (§2.4) to tolerate out-of-order and occasionally-missing extra-info events gracefully, and fall back to Standard Engine data for that specific request rather than dropping it.

**Empirically verify, don't assume:** before marking Category B headers as "fully solved," build the golden-fixture test in §12.2 — capture the same live request through Requestal Pro Mode and through your mitmproxy pipeline, and diff the two raw outputs. CDP is documented to expose "raw headers as sent over the wire," but the only way to be sure `Connection` and `Cache-Control` really come through cleanly on your target stack (and aren't themselves subject to some Chromium-internal normalization) is to check.

### 3.4 True interception via CDP `Fetch` domain

This is worth calling out specifically because it changes what's *possible*, not just what's *captured*. MV3 removed blocking `webRequest` for regular Web Store extensions, which is usually read as "browser extensions can't do Burp-style intercept-and-edit anymore." That's true for `webRequest`, but the CDP `Fetch` domain — reachable the same way as `Network`, via `chrome.debugger` — provides exactly that:

```ts
await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
  patterns: [{ requestStage: "Request" }],
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === "Fetch.requestPaused") {
    // Apply Match & Replace rules here, or hand off to the UI for manual edit
    chrome.debugger.sendCommand({ tabId: source.tabId }, "Fetch.continueRequest", {
      requestId: params.requestId,
      headers: modifiedHeaders,
      postData: modifiedBody,
    });
  }
});
```

This is a genuine Pro Mode feature, not a Standard Mode one — it requires the debugger attachment and pauses the page's requests while a rule evaluates, so use it deliberately (scoped rules, not "intercept everything"). It's the mechanism that makes real Match & Replace (§7.2) possible, versus the more limited declarative rewriting `declarativeNetRequest` offers without the debugger permission.

### 3.5 Response body capture for *organic* traffic

Right now, based on the architecture doc, response diffing appears to compare *replayed* responses against a baseline — meaning the response the user actually got while browsing (before Requestal ever touched it) likely isn't captured at all, since `webRequest` cannot read response bodies. `Network.getResponseBody` (CDP) fixes this directly: every organic response gets logged, not just ones you manually replay, which is a meaningful workflow upgrade — you get automatic "did this response change between two page loads" diffing without lifting a finger.

### 3.6 Fidelity badges

Every captured entry should carry a small, honest fidelity indicator rather than presenting all captures as equally complete:

- 🟢 **Full** — CDP-sourced, raw wire headers + cookies present
- 🟡 **Partial** — Standard Engine only; Category B headers unavailable, badge tooltip explains exactly which
- 🟠 **Reconstructed** — body came from the `formData` fallback path, order not guaranteed

This single UI element does a lot of work: it prevents a researcher from unknowingly building a report or a replay on an incomplete capture, which is exactly the kind of gap that erodes trust in a tool once someone's PoC doesn't reproduce because a header silently didn't make it through.

---

## 4. Storage Layer Redesign

### 4.1 Why `chrome.storage.local` is the wrong long-term fit

Chrome's default quota for `chrome.storage.local` is ~10 MB (5 MB before Chrome 114), expandable only by requesting the `"unlimitedStorage"` permission. Even with that permission, `chrome.storage` is a flat key-value store with no querying, indexing, or range-scan capability — fine for settings, wrong for a growing capture log that needs to support "show me every request to this host in the last hour" or full-text search across thousands of entries.

### 4.2 IndexedDB via Dexie.js

Dexie gives you IndexedDB's actual capabilities (compound indexes, range queries, cursors) without hand-rolling the notoriously awkward raw IndexedDB API — and it plays well with `unlimitedStorage`, since that permission raises IndexedDB's quota too, not just `chrome.storage.local`'s.

```ts
// src/core/storage/db.ts
import Dexie, { type Table } from "dexie";

interface CapturedRequest {
  id?: number;
  requestId: string;          // correlation key from §2.4
  tabId: number;
  host: string;
  method: string;
  url: string;
  timestamp: number;
  fidelity: "full" | "partial" | "reconstructed";
  rawRequest: string;         // reconstructed HTTP/1.1 text
  rawResponse?: string;
  tags: string[];             // e.g. "pinned-baseline", "has-secret"
  scopeMatched: boolean;
}

class RequestalDB extends Dexie {
  requests!: Table<CapturedRequest, number>;

  constructor() {
    super("requestal");
    this.version(1).stores({
      // compound + multi-entry indexes for the queries the UI actually needs
      requests: "++id, requestId, host, timestamp, [host+timestamp], *tags",
    });
  }
}

export const db = new RequestalDB();
```

### 4.3 Manifest change

```json
{
  "permissions": ["storage", "unlimitedStorage", "webRequest", "debugger", "sidePanel"]
}
```

`unlimitedStorage` is considered low-risk by Chrome Web Store review (no additional scrutiny), so this doesn't complicate publishing.

### 4.4 Retention & export

- Default retention: rolling window (e.g., last 10,000 requests or 30 days, whichever comes first), configurable.
- "Archive session" action: exports the current IndexedDB slice to a HAR file and clears it from live storage, keeping the working set fast.
- Explicit "pin" flag exempts an entry from pruning (baselines, anything tagged for a report).

---

## 5. Performance & UX Efficiency

### 5.1 Virtualized list rendering

At professional-engagement scale (thousands of captured requests per target), rendering every row in the DOM will visibly jank the side panel. Swap the request list to `@tanstack/react-virtual` — renders only the visible window plus overscan, keeps scroll performance flat regardless of log size.

### 5.2 Web Workers + Comlink

Body format conversion (`formToJson`/`jsonToForm`), the Smart Diff masking pass, and JSON structural diffing are all synchronous CPU work today, per the architecture doc — on a large body (multi-MB JSON API responses are common in real targets) that blocks the side panel's main thread and the UI stutters. Move this into a dedicated worker:

```ts
// src/panel/workers/format.worker.ts
import { expose } from "comlink";

const api = {
  formToJson: (raw: string) => { /* existing logic, unchanged */ },
  jsonToForm: (raw: string) => { /* ... */ },
  smartDiff: (a: string, b: string, maskRules: MaskRule[]) => { /* ... */ },
};
expose(api);

// consumer, e.g. useEditorState.ts
import { wrap } from "comlink";
const worker = wrap<typeof api>(new Worker(new URL("./format.worker.ts", import.meta.url)));
const json = await worker.formToJson(rawBody);
```

Comlink (from the Chrome DevRel team, so it's a natural fit for a Chrome-extension codebase) removes the boilerplate of manual `postMessage`/`onmessage` RPC and gives you a typed, promise-based interface to the worker.

### 5.3 State management: Zustand

`useRequestManager` and `useEditorState` as plain hooks work, but as V2 adds scope rules, Match & Replace rules, fidelity mode, and multi-account profiles, prop-drilling and hook-composition complexity will grow fast. Zustand is a good fit specifically *for an extension side panel*: no provider tree needed (important across multiple entry points — sidepanel.html, panel.html, devtools.html all need to read overlapping state), tiny bundle size, and stores can be split per concern (`useCaptureStore`, `useScopeStore`, `useReplayStore`) without the ceremony Redux would add.

### 5.4 Fast search across the capture log

Once you're storing thousands of requests, linear substring search over raw text (however it's currently implemented) won't stay fast. `minisearch` (small, zero-dependency, good fuzzy/prefix matching) indexes URL, headers, and body text incrementally as requests are captured, giving sub-request-log-size search latency instead of scanning everything on every keystroke.

### 5.5 Monaco performance

- Reuse editor **models** rather than remounting `<Editor>` per selected request — creating a fresh Monaco model on every click is the most common cause of a laggy request list + editor combo.
- Compute the diff (both raw-text and the new structural JSON diff, §6.1) in a worker, then hand Monaco's `DiffEditor` pre-computed, already-masked text — don't run `smartDiff`'s regex passes synchronously on the main thread on every keystroke while editing a baseline.
- Lazy-load language workers (`json`, `html`, etc.) only when a body of that type is actually opened, rather than eagerly bundling all of them into the side panel's initial load.

### 5.6 `chrome.offscreen` for heavy work outside the service worker

For anything CPU-heavy that needs to run in the background context (bulk re-parsing an imported HAR file, batch-computing diffs across a whole pinned set), spin up an offscreen document rather than doing it in the service worker — this keeps the SW responsive to new capture events and sidesteps the MV3 SW timeout risk discussed in §2.5 for genuinely long-running tasks.

---

## 6. Diff Engine Upgrade

### 6.1 Structural JSON diff, layered on top of Monaco

Today's diff is text/line-based via Monaco's `DiffEditor`. For JSON API bodies — the overwhelming majority of what a bug bounty target actually returns — a structural diff is more useful: it ignores key reordering and formatting noise and tells you *which fields changed value*, which is exactly the signal you want when comparing a baseline response to a fuzzed one. `jsondiffpatch` is a solid fit: computes a structural delta and ships a visual HTML formatter you can adapt to Requestal's theme, and can run inside the format worker from §5.2 so it never blocks the UI.

Recommended UX: auto-detect JSON content-type and offer a toggle between "Text Diff" (current Monaco behavior, good for anything non-JSON) and "Structural Diff" (jsondiffpatch, better signal-to-noise for APIs).

### 6.2 Smarter Smart Diff masking

Current masking (per the architecture doc) handles ISO/Unix timestamps and `ETag`/`If-None-Match`. Extend this with:

- **User-defined regex mask rules**, scoped per-target or global, so a researcher can mask a target-specific dynamic field (e.g., a custom nonce parameter) without it being hardcoded.
- **JWT-aware masking** — detect the three-segment base64url JWT shape, decode the payload for display, and mask just the signature (and `iat`/`exp` claims specifically, since those are the fields that make two otherwise-identical JWTs look different in a diff) rather than either showing the raw token or blindly masking the whole thing.
- **Entropy-based dynamic-token detection** — flag high-Shannon-entropy string values (session tokens, CSRF tokens, API keys) as *candidate* dynamic fields even without a name match, and let the user confirm/mask with one click rather than writing a regex from scratch. This is a heuristic, not a guarantee — surface it as a suggestion, not an automatic mask, since false positives on a real data field would be actively misleading in a diff.

### 6.3 Multi-baseline history

Right now baseline pinning appears to support one active baseline. For a real fuzzing session it's common to want several reference points (e.g., "unauthenticated baseline" vs. "low-priv-user baseline" vs. "admin baseline") — extend the baseline store to a small named set, with the diff view letting you pick which one to compare against per-request rather than a single global pin.

---

## 7. Professional-Grade Features

### 7.1 Scope management

A `scope` config (include/exclude host patterns, mirroring how Burp/Caido define project scope) gates both what's persisted to IndexedDB and what shows in the request list by default — critical once Cookie capture is on, since you don't want session cookies for the user's unrelated browsing quietly accumulating in storage alongside the actual target traffic. Store as a simple pattern list (`*.target.com`, `-*.target.com/health`) evaluated against `host` + `url` at capture time, before persistence — not as a display-only filter.

### 7.2 Match & Replace

Two tiers, matching the two capture engines:

- **Standard Mode:** rewrite rules applied at the point Requestal dispatches a request via `fetch()` (§3.5 of the original architecture, `dispatchRequest`) — this already works today for anything sent through Requestal's own Send button, no new permission needed.
- **Pro Mode:** true live interception of the browser's *own* organic traffic via the CDP `Fetch` domain (§3.4) — e.g., auto-stripping a header on every request the page itself makes while you browse, not just ones you manually resend. This is the feature that most closely mirrors Burp's Proxy tab behavior, and it's only possible through the debugger-attached engine.

### 7.3 Multi-account / auth-profile management

Given the session-cookie capture from §1.1/7.1, it's a natural extension to let Requestal hold named credential/cookie profiles ("Account A", "Account B") for IDOR-style multi-account testing — capture a request under one profile, one click to re-dispatch the identical request substituting another profile's session cookie, and diff the two responses. This is a common enough bug-class workflow (broken object-level authorization across accounts) that baking it in as a first-class action, rather than manual cookie-jar juggling, is a meaningful time saver.

### 7.4 Initiator / call-stack tracing

CDP's `Network.requestWillBeSent` includes a full initiator object with JS call stack when the request came from `fetch`/`XHR`, not just the origin string `webRequest` gives you. Surfacing "this request was triggered by `app.bundle.js:4521` via this call chain" is genuinely useful when reverse-engineering an unfamiliar SPA's request logic — show it as an expandable detail on the request row in Pro Mode.

### 7.5 Timing waterfall

CDP timing data (`Network.requestWillBeSent.timestamp` combined with `Network.responseReceivedExtraInfo` and the connection-timing block on `requestWillBeSentExtraInfo`) can drive a DNS/TCP/TLS/TTFB waterfall per request — useful for spotting things like unusually slow auth checks (a light-touch timing-oracle signal) without needing a separate tool.

### 7.6 Secrets detection

Run a lightweight entropy + pattern scan (AWS-key-shaped strings, JWTs, common private-key PEM headers, generic `[a-z_]*(token|secret|key)[a-z_]*` field-name matches) over captured bodies and headers as they're stored, and tag matching entries (`has-secret`). Pair this with redact-by-default in any exported/shared artifact (§9.1) — this is squarely in the same spirit as the "no AI-generated content, verified data only" discipline you've applied elsewhere; here the equivalent principle is "never let a secret leave the tool by accident."

---

## 8. Export & Interoperability

| Format | Purpose |
|---|---|
| **HAR 1.2** | Already partially implemented internally — expose as a full-session export, importable by Burp, Caido, ZAP, and browser DevTools itself |
| **Raw HTTP / cURL** | One-click copy from any request row, already implied by the raw-text editor — extend the existing ffuf `CommandPreview` component pattern to also emit cURL |
| **Postman / OpenAPI 3** | Useful handoff artifact when documenting findings for a client or team, distinct audience from the raw-HTTP/ffuf export |
| **ffuf / nuclei / sqlmap command generation** | Extend `CommandPreview.tsx` beyond ffuf — same FUZZ-marker convention already in place, just different command templates per tool |

### 8.5 Bridge to your mitmproxy pipeline — guaranteed-fidelity relay

Given the mitmproxy-based capture addon you've already built for engagement-level work, the highest-leverage integration isn't duplicating that pipeline inside the extension — it's letting the two hand off cleanly:

- **Import:** Requestal reads HAR/flow exports from the mitmproxy addon directly into its request log, so a proxy-captured session and a browser-captured session live in the same diff/replay workspace.
- **Relay-on-demand ("send to proxy"):** for any single request where byte-perfect fidelity actually matters — final PoC verification before writing up a report, for instance — Requestal's dispatcher can route that one `fetch()` through a local mitmproxy upstream (`http://127.0.0.1:<port>`) instead of sending it directly, so the confirmed-working replay is simultaneously logged with full wire fidelity on the proxy side.

This avoids over-engineering the extension into trying to be a full proxy (which, per §1.4, it structurally can't fully be) while giving you a clean escape hatch to guaranteed fidelity exactly when it matters, using tooling you've already built rather than new tooling that duplicates it.

---

## 9. Security & Extension Hygiene

Given this now captures live session cookies and Authorization-adjacent data, hygiene isn't optional polish — it's the difference between "professional tool" and "liability":

- **Redact-by-default in any export/share path.** Cookie and Authorization values shown truncated/masked in exports unless explicitly revealed; this mirrors the same instinct behind Clean Mode's telemetry stripping, just extended to secrets rather than fingerprinting noise.
- **No data leaves the machine.** No telemetry, no remote logging, no third-party analytics SDKs — worth stating explicitly in the README given the sensitivity of what's now being captured.
- **Storage is not encrypted by the browser** (`chrome.storage`/IndexedDB are plaintext on disk, same caveat Chrome's own docs give for `storage.local`) — document this plainly rather than implying a security guarantee that doesn't exist; if this matters for your threat model, an optional passphrase-derived encryption layer over the IndexedDB payloads (e.g., via the Web Crypto API, `AES-GCM` with a key derived from a session passphrase, never persisted) is a reasonable V2.x addition, not a V2.0 blocker.
- **Minimal, justified permissions.** If this ever goes to the Chrome Web Store, `debugger` and `<all_urls>` are both permissions reviewers scrutinize — have a one-paragraph justification ready for each (this document effectively is that justification), and keep Standard Mode fully functional without `debugger` at all, so the high-friction permission is opt-in, not load-bearing.
- **Strict CSP, no remote code.** Keep Monaco and all workers bundled locally (already the stated approach) — no CDN script loading in the shipped extension, consistent with the "no AI-generated content, verified sources only" discipline already applied to your other tools; here the equivalent is "no code Google Chrome Web Store review didn't see."

---

## 10. Updated Tech Stack

Additions to the table in the original architecture doc:

| Category | Library | Why |
|---|---|---|
| Local database | `dexie` | IndexedDB with real querying, replaces `chrome.storage.local` as primary store (§4) |
| State management | `zustand` | No provider tree, small footprint, natural fit across multiple extension entry points |
| List virtualization | `@tanstack/react-virtual` | Flat scroll performance at thousands of captured requests |
| Worker RPC | `comlink` | Typed, promise-based Web Worker interface for offloading diff/format-conversion work |
| Structural diff | `jsondiffpatch` | Field-level JSON diffing, ignores key-order/formatting noise that a text diff can't |
| Full-text search | `minisearch` | Fast indexed search over the growing capture log |
| Schema validation | `zod` | Runtime validation for the internal message payloads between background/side panel/CDP layer — cheap insurance against a malformed CDP event silently corrupting stored data |
| Testing (unit) | `vitest` | Matches the existing Vite toolchain, faster than Jest for this stack |
| Testing (e2e) | `playwright` | Drives a real Chrome instance with the unpacked extension loaded, for golden-fixture fidelity tests (§12) |

Everything already in the V1 stack (React 19, TypeScript, Vite, Monaco, Tailwind v4, lucide-react) stays as-is — these are additive, not replacements.

---

## 11. Updated Directory Structure

```
Requestal/
├── src/
│   ├── core/
│   │   ├── capture/
│   │   │   ├── standardEngine.ts        # webRequest + extraHeaders
│   │   │   ├── proEngine.ts             # chrome.debugger + CDP Network/Fetch
│   │   │   └── reconcile.ts             # correlation + merge (§2.4)
│   │   ├── diff/
│   │   │   ├── textDiff.ts              # existing Monaco-based engine
│   │   │   └── structuralDiff.ts        # jsondiffpatch integration (§6.1)
│   │   ├── dispatcher/
│   │   │   ├── client.ts                # existing fetch dispatcher
│   │   │   └── proxyRelay.ts            # mitmproxy hand-off (§8.5)
│   │   ├── format/                      # unchanged
│   │   ├── scope/
│   │   │   └── matcher.ts               # scope include/exclude (§7.1)
│   │   ├── rules/
│   │   │   └── matchReplace.ts          # §7.2
│   │   ├── secrets/
│   │   │   └── detect.ts                # entropy + pattern scan (§7.6)
│   │   └── storage/
│   │       ├── db.ts                    # Dexie schema (§4.2)
│   │       └── retention.ts
│   ├── extension/
│   │   ├── background/
│   │   │   └── index.ts                 # orchestrates both engines
│   │   └── devtools/                    # unchanged
│   ├── panel/
│   │   ├── workers/
│   │   │   └── format.worker.ts         # §5.2
│   │   ├── stores/                      # zustand stores, split by concern
│   │   ├── components/                  # existing + FidelityBadge, ScopeEditor,
│   │   │                                 #   MatchReplaceRules, ProfileSwitcher
│   │   └── hooks/                       # existing, trimmed as logic moves to stores
│   └── shared/                          # unchanged
├── tests/
│   ├── fixtures/                        # golden capture pairs (Requestal vs. proxy)
│   ├── unit/
│   └── e2e/
```

---

## 12. Testing & QA Plan

### 12.1 Unit tests — regression-lock the exact bug class you found

Build the MMU login request from this conversation into a permanent fixture. Assert, byte-for-byte:

- Body reconstruction preserves original parameter order (locks §1.3/§3.2)
- All Category A headers present when `extraHeaders` is enabled (locks §1.1/§3.1)
- Category B headers are either present (Pro Mode fixture) or explicitly absent-and-flagged (Standard Mode fixture) — never silently missing without a fidelity indicator

### 12.2 Golden-fixture fidelity tests

The only real way to validate the CDP fidelity claims in §2/§3 rather than assume them: stand up a small local test server, drive an identical request through (a) Requestal Standard Mode, (b) Requestal Pro Mode, and (c) your existing mitmproxy pipeline, and diff all three raw outputs against each other. Run this against a small matrix of request shapes (simple GET, urlencoded POST, multipart POST with a file, JSON POST, a request over HTTP/2) since header behavior can vary by protocol version, as noted in §1.2's `Connection` caveat. Automate this as a Playwright-driven e2e suite so it re-runs on Chrome version bumps, not just once by hand.

### 12.3 Performance regression tests

Simple benchmark harness (can live alongside the Playwright suite) that seeds IndexedDB with, say, 5,000 synthetic captured requests and asserts the request list stays interactive (scroll, search, select) under a latency budget — this is the concrete, measurable version of the "efficiency" goal, rather than a vague aspiration.

---

## 13. Manifest V3 Changes Required

```jsonc
{
  "permissions": [
    "webRequest",
    "storage",
    "unlimitedStorage",   // new — §4.3
    "sidePanel",
    "debugger"             // new, gated behind opt-in Pro Mode — §2.3
  ],
  "host_permissions": ["<all_urls>"],
  "optional_permissions": ["debugger"] // consider requesting debugger as OPTIONAL,
                                        // requested only when the user turns on Pro
                                        // Mode for the first time, rather than at
                                        // install — smaller install-time prompt,
                                        // clearer consent moment
}
```

Requesting `debugger` as an [optional permission](https://developer.chrome.com/docs/extensions/reference/permissions-list), granted just-in-time when Pro Mode is first toggled on, is worth the small extra implementation complexity (`chrome.permissions.request()` at that moment) — it keeps the base install low-friction and makes the fidelity/banner trade-off from §2.3 an explicit, informed choice rather than something buried in an install-time permissions list nobody reads closely.

---

## 14. Phased Roadmap

| Phase | Scope | Effort | New permissions |
|---|---|---|---|
| **1 — Fidelity fixes** | `extraHeaders` on all three listeners; raw-bytes-first body reconstruction; fidelity badges (Standard-only version); Content-Length computed from actual body | Days | None |
| **2 — Storage & performance** | Dexie/IndexedDB migration; list virtualization; worker offload for diff/format; Zustand refactor | 1–2 weeks | `unlimitedStorage` |
| **3 — Pro Engine (CDP)** | `chrome.debugger` integration; Network domain full-fidelity capture; response-body capture for organic traffic; WebSocket capture; golden-fixture fidelity test suite | 2–3 weeks | `debugger` (optional) |
| **4 — Pro features** | `Fetch` domain interception + Match & Replace; scope management; multi-account profiles; structural JSON diff; entropy-based secret detection; export formats; mitmproxy relay bridge | 3–4 weeks | none beyond Phase 3 |

Ship Phase 1 immediately and independently — it's a pure bug fix with no architectural risk, and it closes most of the visible gap in your diff on its own. Phases 2–4 can then proceed without time pressure to "fix the cookie bug," since that'll already be done.

**§16 and §17 are cross-cutting, not a Phase 5.** Fold them into the phases above as each lands, not tack them on at the end:

- **Into Phase 1:** debounced editor validation (§16.3), dispatch timeout + `AbortController` (§16.4), defensive `chrome.*` error handling (§17.1) — all cheap, all high-value, all independent of the storage/CDP work in later phases.
- **Into Phase 2:** IPC batching + pre-filtering (§16.1), list-view lazy hydration (§16.2), Dexie versioned schema from the first migration (§17.4) — these belong with the storage rework since they touch the same code.
- **Into Phase 3:** race-condition handling around the reconciliation buffer and SW restarts (§17.2), schema validation on CDP event payloads (§17.3) — same reasoning, same code.
- **Into Phase 4:** response streaming/size guards (§16.5), diff memoization (§16.6), the full error-path test matrix (§17.8) — these mature alongside the pro features they support.

Treating reliability as "something you do once everything else works" is exactly how a tool ends up fast most of the time and subtly wrong some of the time — for a security tool, "subtly wrong some of the time" is the worse failure mode of the two.

---

## 15. Appendix — Your Diff, Mapped to Root Causes

| Header/field | In Caido | In Requestal | Root cause | Fix |
|---|---|---|---|---|
| `Cookie` | ✅ | ❌ | Category A (extraHeaders) | §3.1 |
| `Referer` | ✅ | ❌ | Category A (extraHeaders) | §3.1 |
| `Origin` | ✅ | ❌ | Category A (extraHeaders) | §3.1 |
| `Accept-Language` | ✅ | ❌ | Category A (extraHeaders) | §3.1 |
| `Accept-Encoding` | ✅ | ❌ | Category A (extraHeaders) | §3.1 |
| `Connection` | ✅ | ❌ | Category B — never exposed to webRequest | §3.3 (CDP) |
| `Content-Length` | ✅ | ❌ | Category B1 — derivable, don't need to capture | §1.2 (compute from body) |
| `Cache-Control` | ✅ | ❌ | Category B2 — never exposed to webRequest | §3.3 (CDP) |
| Body parameter order | correct | scrambled (alphabetical) | `formData` dict path instead of raw bytes | §3.2 |

Everything in this table is addressed above; nothing here requires new invention, just correct use of the platform (Phase 1) plus one additional capture engine (Phase 3) for the two fields Chrome fundamentally won't hand to `webRequest`.

---

## 16. End-to-End Pipeline Efficiency Audit

§§1–15 fix *what* gets captured. This section is about *how fast and how cleanly* everything downstream of capture runs — sending, editing, rendering responses, comparing — because a byte-accurate capture that then stutters on a large session or freezes on a slow target isn't actually the professional-grade experience the rest of this plan is aiming for. Mapped directly against what you asked about:

| Stage you asked about | Current risk if left as-is | Where it's fixed below |
|---|---|---|
| **Capturing** | Every single request triggers an immediate IPC message + full HAR build, even out-of-scope noise (trackers, polling, analytics beacons) | §16.1 |
| **Request (editing)** | Format detection/RFC validation likely runs synchronously on every keystroke on the raw HTTP text | §16.3 |
| **Sending** | No timeout, no cancel, no concurrency control for multi-request operations (multi-account replay, repeater-style resend) | §16.4 |
| **Response** | Full body buffered into memory and into Monaco regardless of size; no cap on huge responses | §16.5 |
| **Comparing** | Diff (text or structural) likely recomputes on every keystroke, with no size gate | §16.6 |
| *(supporting)* Rendering | List/detail views likely re-render more than necessary and hydrate full bodies into state just to show a summary row | §16.2, §16.7 |
| *(supporting)* Startup | Monaco + diff/search libraries probably load eagerly on side panel open | §16.8 |
| *(supporting)* Memory | Long sessions accumulate unreleased Monaco models, caches, buffers | §16.9 |

### 16.1 Capture → IPC: batch and pre-filter, don't stream one message per request

Today's flow (per the architecture doc) is: capture → build HAR object → `chrome.runtime.sendMessage` — once per request, immediately. On a real target this is wasteful in two independent ways: (a) a chatty page (polling, analytics, websocket-adjacent XHR) can fire dozens of requests a second, each one paying full HAR-serialization + IPC + React-update cost; (b) if the side panel isn't open when a request fires, that `sendMessage` call has no listener and the event's fate depends entirely on whether something else already persisted it — which is itself a correctness gap, not just a performance one (see §17.2).

Fix: decouple **persistence** from **notification**, and batch both.

```ts
// src/extension/background/capture/orchestrator.ts
const pending: CapturedRequest[] = [];
let flushScheduled = false;

function onCaptured(entry: CapturedRequest) {
  if (!scopeMatcher.isInScope(entry.host, entry.url)) return; // filter BEFORE any work
  if (!resourceTypeFilter.shouldCapture(entry.resourceType)) return; // skip images/fonts/media by default

  pending.push(entry);
  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(flush, 150); // coalesce a burst into one batch
  }
}

async function flush() {
  const batch = pending.splice(0);
  flushScheduled = false;
  await db.requests.bulkAdd(batch);                  // ALWAYS persist, panel open or not
  chrome.runtime.sendMessage({ type: "NEW_REQUESTS", payload: batch }).catch(() => {
    // no listener open — fine, IndexedDB already has it; the panel will
    // pick it up from storage on next open (see §16.2's query pattern)
  });
}
```

This turns "N messages + N React updates per second" into "one batch every 150ms," and means the side panel being closed no longer risks losing captures — persistence no longer depends on a listener being present.

### 16.2 List-view lazy hydration: don't carry full bodies in render state

If the request list's React/Zustand state holds each entry's full `rawRequest`/`rawResponse` text just to render a one-line summary row, every capture batch does far more serialization/diffing work in React's reconciler than the UI actually needs, and virtualization (§5.1) only helps with DOM node count, not with the size of the state driving it.

Split the schema so the list only ever touches small rows, and bodies are fetched on demand:

```ts
// src/core/storage/db.ts
class RequestalDB extends Dexie {
  requests!: Table<RequestSummary, number>;   // small: method, url, status, timestamp, fidelity, tags, sizeBytes
  bodies!: Table<RequestBody, number>;        // large: rawRequest, rawResponse — keyed by the same id

  constructor() {
    super("requestal");
    this.version(1).stores({
      requests: "++id, requestId, host, timestamp, [host+timestamp], *tags",
      bodies: "id",
    });
  }
}
```

The list subscribes to `requests` only. Selecting a row triggers a single `db.bodies.get(id)` — the editor/diff panes populate a moment later, which is the right tradeoff (nobody's reading 500 raw bodies at once; they're reading the one they clicked).

### 16.3 Editor & validation: debounce, and move off the main thread

The Smart Format Engine's format detection and RFC validation should never run synchronously against every `onDidChangeModelContent` event on a body that could be tens of KB of JSON. Debounce (150–250ms idle) before validating, and run the actual detection/conversion in the format worker from §5.2 so even the debounced pass doesn't block typing:

```ts
// src/panel/hooks/useEditorState.ts
const debouncedValidate = useMemo(
  () => debounce((text: string) => worker.validate(text).then(setValidationState), 200),
  []
);
editor.onDidChangeModelContent(() => debouncedValidate(editor.getValue()));
```

(A hand-rolled 10-line debounce is enough here — no need to pull in a general-purpose utility library just for this.)

### 16.4 Sending: timeouts, cancellation, and a concurrency-limited queue

`dispatchRequest` today has no timeout and no way to cancel an in-flight send — a slow or hanging target leaves the UI stuck with no recourse. And once V2 adds multi-account replay (§7.3) or a repeater-style "send again," firing everything at once with bare `fetch()` calls risks tripping Chrome's per-origin connection limit and, more importantly for a bug bounty context, risks hammering the target harder than intended — an efficiency feature should never accidentally become a self-inflicted rate-limit trigger or, worse, look like a DoS attempt.

```ts
// src/core/dispatcher/client.ts
async function dispatchRequest(req: ParsedRequest, { timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(req.url, { ...req.fetchInit, signal: controller.signal });
    return { ...(await toResult(res)), timeMs: performance.now() - start, cancel: controller };
  } catch (err) {
    if (controller.signal.aborted) return { error: "timeout-or-cancelled", timeMs: performance.now() - start };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// a tiny concurrency gate for batch/multi-account sends — no need for a full
// task-queue library, this is ~15 lines:
function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await fn(); }
    finally { active--; queue.shift()?.(); }
  };
}
```

Expose `controller` back to the UI so a visible "Cancel" button actually does something, and keep batch operations off by default without an explicit "send to N profiles" or "repeat ×N" action — no silent background hammering.

Deliberately **do not** add automatic retry-with-backoff for failed sends. In a normal web app that's a reasonable resilience pattern; here, a request that fails or gets rate-limited is *signal* — auto-retrying could mask real target behavior (e.g., hide that you just tripped a WAF or rate limiter) or multiply unintended load on someone else's infrastructure. If retry is ever added, it should be an explicit, visible, opt-in action per request, never silent.

### 16.5 Response handling: don't buffer-and-render blindly on large bodies

`response.text()` buffers the entire body before anything renders, and handing a multi-MB (or larger — some API dumps and misconfigured endpoints return huge payloads) body straight into a Monaco model will visibly freeze the panel. Guard this explicitly:

- Check `Content-Length` (or measure as you stream) against a threshold (e.g. 2–5 MB); above it, show a "large response (N MB) — showing first 256 KB, click to load full" affordance instead of rendering everything immediately.
- Prefer `response.body.getReader()` streaming into a bounded preview buffer over `response.text()` when you only need the head of a large body for the default view.
- Apply the same size gate to what gets fed into the Smart Diff / structural diff engines (§6) — diffing two 10 MB JSON blobs on every selection change is a self-inflicted stall, not a real requirement.

### 16.6 Diff computation: debounce and memoize, don't recompute on every render

Both the text diff and the new structural diff (§6.1) should be treated as expensive and cached, not run inline on every render:

- Debounce recomputation while a baseline or comparison body is actively being edited, same pattern as §16.3.
- Memoize by a content hash of `(bodyA, bodyB, activeMaskRules)` — reselecting the same pair of requests (a very common action when triaging a batch of fuzz results) should hit a cache, not recompute.
- Apply the §16.5 size gate here too — this is the same underlying discipline (don't do expensive work on data the user hasn't asked to see in full) showing up at a different stage of the pipeline.

### 16.7 Rendering: selective subscriptions and stable identity

With Zustand (§5.3) in place, make sure components subscribe to the narrowest slice they need (`useStore(s => s.requests[id])`, not `useStore(s => s.requests)` inside a component that only cares about one row) — the whole point of moving off prop-drilled hooks is lost if every store update still re-renders the entire tree. Memoize row components keyed by a stable id, and keep list-row props to primitives/stable references so `React.memo` actually short-circuits re-renders during a capture burst.

### 16.8 Startup: don't pay for Monaco before anyone's looked at a request

Bundle Monaco, `jsondiffpatch`, and `minisearch` behind dynamic `import()` rather than eager top-level imports in the side panel entry — the initial paint (request list + controls) shouldn't wait on Monaco's worker bootstrapping. Load the editor bundle the first time a request is actually selected, and the diff/search bundles the first time those views are opened. This is a bigger win than it sounds like for a side panel that gets opened and closed frequently during a session.

### 16.9 Memory: make cleanup a checklist, not an afterthought

The existing 60-second fallback cleanup for `requestBodies` is the right instinct — apply the same discipline everywhere state can accumulate across a long session:

- Dispose Monaco models on row deselection/unmount, don't just let them pile up.
- Cap any in-memory "recently viewed body" cache at a fixed size (simple LRU), evict rather than grow unbounded.
- Give the §2.4 reconciliation buffer and any in-memory search index the same bounded-with-cleanup treatment as `requestBodies` already gets.
- Revoke any object URLs created for binary body previews once the preview closes.

---

## 17. Reliability & Correctness Hardening (Zero-Regression Discipline)

Efficiency work that introduces new failure modes is a net loss for a tool whose entire purpose is producing trustworthy evidence. This section is the "make sure nothing here can quietly produce wrong data, drop data, or crash" pass — treat every item here as a requirement, not a nice-to-have, precisely because the cost of a silent bug in a security tool is a wrong finding or a missed one.

### 17.1 Defensive `chrome.*` API usage

Every `chrome.*` call can fail in ways that are easy to forget about mid-session: the user closes the tab being captured, revokes a permission, reloads the extension, or — specific to Pro Mode — Chrome force-detaches the debugger (the user can dismiss the "is debugging this browser" banner directly, which detaches it out from under you). None of these should crash the extension or silently stop capturing without telling the user.

```ts
chrome.debugger.onDetach.addListener((source, reason) => {
  // reason: "target_closed" | "canceled_by_user" | "replaced_with_devtools" | ...
  proEngineStore.getState().markDetached(source.tabId, reason);
  fallbackToStandardEngine(source.tabId); // never silently lose capture — degrade visibly
});
```

Wrap every `chrome.debugger.sendCommand`, `chrome.tabs.*`, and callback-style API call in try/catch (or check `chrome.runtime.lastError` for the callback style), and treat "the call failed" as an expected, handled branch — not an exceptional one that's allowed to bubble up and silently kill the background script.

### 17.2 Race conditions: idempotency and bounded waits

Two places in this plan can race, and both need an explicit answer, not an assumption:

- **Service worker restart mid-capture (§2.5).** If a batch was persisted (§16.1) but the "mark as flushed" step hadn't completed when the SW died, a restart could reprocess and duplicate it. Key writes by a stable `requestId` and use `bulkPut` (upsert) rather than `bulkAdd` (insert-only, throws on duplicate key) so a reprocessed event overwrites cleanly instead of erroring or duplicating.
- **The correlation buffer (§2.4).** Give it a hard max-wait (e.g. 500ms) before flushing with whatever data it has — CDP's own docs are explicit that `requestWillBeSentExtraInfo` isn't guaranteed to fire for every request, so a buffer waiting indefinitely for an event that will never arrive is a slow, silent data-loss bug, not just a performance quirk.

### 17.3 Schema validation at every boundary

TypeScript types are compile-time only — they don't protect you from a CDP event shape drifting across a Chrome version, a corrupted/hand-edited imported HAR file, or a malformed IPC payload. Validate at runtime with `zod` (already in §10's stack) at every boundary where data crosses a trust line:

```ts
const CdpRequestExtraInfoSchema = z.object({
  requestId: z.string(),
  headers: z.record(z.string()),
  associatedCookies: z.array(z.object({ cookie: z.any(), blockedReasons: z.array(z.string()) })).optional(),
});

function handleRawHeaders(raw: unknown) {
  const parsed = CdpRequestExtraInfoSchema.safeParse(raw);
  if (!parsed.success) {
    logSchemaDrift("Network.requestWillBeSentExtraInfo", parsed.error); // surface, don't swallow
    return;
  }
  // proceed with parsed.data, fully typed AND runtime-verified
}
```

Apply the same pattern to: incoming `webRequest` event details, IPC messages between background and panel, and — critically — imported HAR/flow files (§8.5's mitmproxy import path). Never `JSON.parse` an imported file and hand it straight to the render layer; validate structure first so a malformed import produces a clear error, not a broken UI state or a crash.

### 17.4 Versioned storage schema, from the first migration

Set up Dexie's version/upgrade pattern correctly from day one, even though V2.0 only needs `version(1)` — retrofitting migrations onto a schema that was never versioned is far more painful than starting with the discipline in place:

```ts
db.version(1).stores({ requests: "++id, requestId, host, timestamp", bodies: "id" });
db.version(2).stores({ requests: "++id, requestId, host, timestamp, [host+timestamp], *tags" })
  .upgrade(async (tx) => {
    await tx.table("requests").toCollection().modify((r) => { r.tags = r.tags ?? []; });
  });
```

Write a small test that seeds a v1-shaped database and asserts the v2 upgrade produces the expected shape — this is cheap insurance against a future schema change silently corrupting or discarding a user's entire capture history.

### 17.5 Timeouts on every async boundary, not just `fetch`

§16.4 covers dispatch timeouts; apply the same principle to `chrome.debugger.sendCommand` calls (a CDP command can hang if the target tab becomes unresponsive — wrap with `Promise.race` against a timeout) and to any storage operation that isn't guaranteed to resolve quickly under load. An extension where one stuck async call can freeze the whole side panel is a reliability regression no amount of capture fidelity makes up for.

### 17.6 React error boundaries around risky render paths

A single malformed body (unexpected encoding, a JSON-looking string that isn't quite valid, a binary blob mistakenly rendered as text) shouldn't be able to crash the entire side panel. Wrap the body preview, the diff view, and any user-content-driven formatter in a React Error Boundary with a graceful "couldn't render this — view raw bytes instead" fallback, so one bad response never takes down the whole tool mid-session.

### 17.7 Log unknown CDP events instead of silently ignoring them

The `switch` statement in §3.3 should have a `default` branch that logs (locally, not remotely — see §9) any CDP method it doesn't recognize, rather than letting an unhandled case fall through silently. This turns "Chrome shipped a protocol change and we're now quietly missing data" into something that surfaces during your own testing on a new Chrome version, instead of something a user discovers months later when a capture doesn't match reality.

### 17.8 Expanded error-path test matrix

Extend §12's testing plan with explicit failure-mode tests, not just happy-path fixtures:

- Service worker forcibly restarted mid-batch — assert no duplicate and no dropped entries (§17.2)
- `chrome.debugger` force-detached mid-session (simulate the `onDetach` event) — assert clean fallback to Standard Mode and a visible fidelity-badge change, not a stuck UI
- Malformed/truncated CDP event payload — assert it's logged and skipped, not thrown
- Oversized response body (§16.5) — assert the preview truncates and the "load full" action works
- Concurrent dispatch through the §16.4 limiter — assert it never exceeds the configured concurrency
- Each Dexie schema version upgraded from the previous one (§17.4) — assert data integrity after migration

---

## Sources

- [chrome.webRequest — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/webRequest) (headers hidden with/without `extraHeaders`, Category A/B lists, form-data/raw body types)
- [Chrome DevTools Protocol — Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/) (`requestWillBeSentExtraInfo`, `Fetch` domain)
- [chrome.debugger — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [chrome.storage — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage) (quota figures, `unlimitedStorage`)
