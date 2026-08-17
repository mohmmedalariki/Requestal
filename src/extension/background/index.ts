import { standardEngine } from '../../core/capture/standardEngine';
import { proEngine } from '../../core/capture/proEngine';
import { reconciler } from '../../core/capture/reconcile';
import { exportSessionToHar, enforceRetention } from '../../core/storage/retention';

// ═══════════════════════════════════════════════════════
// §2.5 — MV3 Service Worker Lifecycle Safety
// ═══════════════════════════════════════════════════════
const PRO_TABS_KEY = 'requestal_pro_attached_tabs';

/**
 * Persists the set of tabs with Pro Engine attached,
 * so we can re-attach on SW restart.
 */
function persistAttachedTabs() {
    const tabs = proEngine.getAttachedTabs();
    chrome.storage.session.set({ [PRO_TABS_KEY]: tabs }).catch(() => {});
}

/**
 * On SW startup, check for previously attached tabs and re-attach.
 */
async function recoverProEngineState() {
    try {
        const result = await chrome.storage.session.get(PRO_TABS_KEY);
        const savedTabs: number[] = (result as any)[PRO_TABS_KEY] || [];
        if (savedTabs.length > 0) {
            await proEngine.reattachTabs(savedTabs);
            persistAttachedTabs(); // Update in case some tabs no longer exist
        }
    } catch {
        // First run or no saved state — normal
    }
}

// ═══════════════════════════════════════════════════════
// Capture Engine Initialization
// ═══════════════════════════════════════════════════════

// Start Standard Engine (always on, webRequest + extraHeaders)
standardEngine.start((harRequest, tabId) => {
    reconciler.handleStandardEvent(harRequest, tabId);
});

// Initialize Pro Engine (CDP) listener
proEngine.init((harRequest, tabId) => {
    reconciler.handleCdpEvent(harRequest, tabId);
});

// Attempt to recover Pro Engine state and clean up ghost-pauses from a previous SW lifecycle
recoverProEngineState().then(() => {
    proEngine.cleanupGhostPauses().catch(() => {});
});

// ═══════════════════════════════════════════════════════
// §2.5 & Point 5 — SW Keep-Alive & Alarm Heartbeat
// ═══════════════════════════════════════════════════════
const HEARTBEAT_ALARM = 'requestal_heartbeat';

chrome.alarms.create(HEARTBEAT_ALARM, {
    periodInMinutes: 1 // Fire every 60 seconds
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) {
        // 1. Run retention enforcement (garbage collection)
        enforceRetention().catch(() => {});

        // 2. Cleanup any orphaned ghost-pauses
        proEngine.cleanupGhostPauses().catch(() => {});

        // 3. Verify Pro Engine tabs still exist
        const attachedTabs = proEngine.getAttachedTabs();
        for (const tabId of attachedTabs) {
            chrome.tabs.get(tabId).catch(() => {
                // Tab no longer exists — clean up
                proEngine.detachTab(tabId);
            });
        }

        // 4. Persist current state for crash recovery
        persistAttachedTabs();
    }
});

// Port listener from Side Panel to maintain active SW during manual human inspection
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'requestal_sidepanel_heartbeat') {
        port.onDisconnect.addListener(() => {
            // Panel closed
        });
    }
});

// ═══════════════════════════════════════════════════════
// IPC Message Handler
// ═══════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    switch (message.type) {
        case 'ATTACH_PRO_ENGINE': {
            const tabId = message.tabId;
            if (typeof tabId === 'number') {
                proEngine.attachTab(tabId).then(res => {
                    if (res.success) persistAttachedTabs();
                    sendResponse({
                        success: res.success,
                        attached: proEngine.isTabAttached(tabId),
                        error: res.error
                    });
                });
                return true; // Async sendResponse
            }
            sendResponse({ success: false, error: 'Invalid tabId' });
            return false;
        }

        case 'DETACH_PRO_ENGINE': {
            const tabId = message.tabId;
            if (typeof tabId === 'number') {
                proEngine.detachTab(tabId).then(() => {
                    persistAttachedTabs();
                    sendResponse({ success: true, attached: false });
                });
                return true;
            }
            sendResponse({ success: false });
            return false;
        }

        case 'GET_PRO_STATUS': {
            const tabId = message.tabId;
            const isAttached = typeof tabId === 'number' ? proEngine.isTabAttached(tabId) : false;
            const isIntercept = typeof tabId === 'number' ? proEngine.isInterceptionEnabled(tabId) : false;
            const isManual = typeof tabId === 'number' ? proEngine.isManualIntercept(tabId) : false;
            sendResponse({ attached: isAttached, interceptionEnabled: isIntercept, manualIntercept: isManual });
            return false;
        }

        // Point 1: Enable Interception with resourceType and scope filtering
        case 'ENABLE_INTERCEPTION': {
            const { tabId, rules, stage, manualIntercept, includeRules, excludeRules, resourceTypes } = message;

            if (typeof tabId === 'number') {
                proEngine.enableInterception(tabId, {
                    stage: stage || 'Response',
                    rules: rules || [],
                    manualIntercept: manualIntercept !== false,
                    includeRules: includeRules || [],
                    excludeRules: excludeRules || [],
                    resourceTypes: resourceTypes || ['Document', 'XHR', 'Fetch']
                }).then(success => {
                    sendResponse({ success });
                });
                return true;
            }
            sendResponse({ success: false });
            return false;
        }

        case 'DISABLE_INTERCEPTION': {
            const tabId = message.tabId;
            if (typeof tabId === 'number') {
                proEngine.disableInterception(tabId).then(() => {
                    sendResponse({ success: true });
                });
                return true;
            }
            sendResponse({ success: false });
            return false;
        }

        // Fulfill paused response with user-edited content
        case 'FULFILL_PAUSED_RESPONSE': {
            const { tabId, requestId, responseCode, responseHeaders, body } = message;
            if (typeof tabId === 'number' && requestId) {
                proEngine.fulfillPausedResponse(tabId, requestId, responseCode, responseHeaders, body).then(success => {
                    sendResponse({ success });
                });
                return true;
            }
            sendResponse({ success: false });
            return false;
        }

        // Continue paused traffic item unmodified
        case 'CONTINUE_PAUSED_ITEM': {
            const { tabId, requestId, isResponse } = message;
            if (typeof tabId === 'number' && requestId) {
                proEngine.continuePausedItem(tabId, requestId, !!isResponse).then(success => {
                    sendResponse({ success });
                });
                return true;
            }
            sendResponse({ success: false });
            return false;
        }

        // Fail/drop paused traffic item
        case 'FAIL_PAUSED_ITEM': {
            const { tabId, requestId } = message;
            if (typeof tabId === 'number' && requestId) {
                proEngine.failPausedItem(tabId, requestId).then(success => {
                    sendResponse({ success });
                });
                return true;
            }
            sendResponse({ success: false });
            return false;
        }

        case 'EXPORT_HAR': {
            const redact = message.redact !== false;
            exportSessionToHar(redact).then(harJson => {
                sendResponse({ success: true, harJson });
            }).catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return true;
        }

        case 'ENFORCE_RETENTION': {
            enforceRetention().then(prunedCount => {
                sendResponse({ success: true, prunedCount });
            });
            return true;
        }
    }

    return false;
});

// ═══════════════════════════════════════════════════════
// Side Panel Configuration
// ═══════════════════════════════════════════════════════
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
