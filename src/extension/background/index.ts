
import { webRequestToHar } from '../../core/format/harAdapter';

// Temporary storage for request bodies
const requestBodies = new Map<string, any>();

// Constants
const CLEANUP_INTERVAL_MS = 60_000;

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (details.requestBody) {
            requestBodies.set(details.requestId, details);
        }
        return undefined;
    },
    { urls: ["<all_urls>"] },
    ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const bodyDetails = requestBodies.get(details.requestId);

        // Transform to HAR format
        const harRequest = webRequestToHar(details, bodyDetails);

        chrome.runtime.sendMessage({
            type: "NEW_REQUEST",
            payload: harRequest
        }).catch(() => {
            // Panel closed or inactive; suppress error
        });

        // Cleanup immediately after processing
        requestBodies.delete(details.requestId);
        return undefined;
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
);

// Periodic cleanup for stale entries
setInterval(() => {
    requestBodies.clear();
}, CLEANUP_INTERVAL_MS);

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
