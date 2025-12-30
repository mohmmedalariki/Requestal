
import { webRequestToHar } from './utils/adapter';

// Store body temporarily
const requestBodies = new Map<string, any>();

// 1. Capture Body
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

// 2. Capture Headers & Broadcast
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const bodyDetails = requestBodies.get(details.requestId);

        const harRequest = webRequestToHar(details, bodyDetails);

        // Broadcast to Side Panel
        chrome.runtime.sendMessage({
            type: "NEW_REQUEST",
            payload: harRequest
        }).catch(() => {
            // Side panel might be closed, ignore error
        });

        // Cleanup
        requestBodies.delete(details.requestId);
        return undefined;
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
);

// Cleanup stale entries periodically
setInterval(() => {
    requestBodies.clear();
}, 60000);

// Open Side Panel on action click (if enabled) or command
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
