import {
    CdpRequestWillBeSentSchema,
    CdpRequestExtraInfoSchema,
    CdpResponseReceivedSchema,
    CdpResponseReceivedExtraInfoSchema
} from './schemas';
import type { HarRequestObject } from '../../shared/utils/http';
import type { MatchReplaceRule } from '../rules/matchReplace';
import { applyMatchReplaceRules, applyResponseMatchReplaceRules } from '../rules/matchReplace';
import { isUrlInScope, scopeRuleToCdpPattern } from '../scope/matcher';
import { stringToBase64 } from '../../shared/utils/encoding';

export type OnCdpCapturedCallback = (harRequest: HarRequestObject, tabId: number) => void;

export interface CdpPendingRequest {
    requestId: string;
    tabId: number;
    url: string;
    method: string;
    timestamp: number;
    initiator?: any;
    rawHeaders?: Record<string, string>;
    rawResponseHeaders?: Record<string, string>;
    statusCode?: number;
    statusText?: string;
    protocol?: string;
    postData?: string;
    responseBody?: string;
}

export interface PausedTrafficItem {
    requestId: string;
    networkId?: string;
    tabId: number;
    stage: 'request' | 'response';
    url: string;
    method: string;
    statusCode?: number;
    statusText?: string;
    headers: { name: string; value: string }[];
    body: string;
}

export interface InterceptionOptions {
    stage?: 'Request' | 'Response' | 'Both';
    rules?: MatchReplaceRule[];
    manualIntercept?: boolean;
    includeRules?: string[];
    excludeRules?: string[];
    resourceTypes?: ('Document' | 'XHR' | 'Fetch')[];
}

export interface GhostPauseEntry {
    requestId: string;
    tabId: number;
    isResponse: boolean;
    timestamp: number;
}

const REDIRECT_CODES = [301, 302, 303, 307, 308];
const GHOST_PAUSE_STORAGE_KEY = 'requestal_paused_traffic_map';

/**
 * Wraps chrome.debugger.sendCommand with a timeout (§17.5).
 */
export function sendCommandWithTimeout(
    target: chrome.debugger.Debuggee,
    method: string,
    params?: any,
    timeoutMs: number = 10_000
): Promise<any> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`CDP command "${method}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        chrome.debugger.sendCommand(target, method, params, (result) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });
}

export class ProCaptureEngine {
    private attachedTabs = new Set<number>();
    private pendingRequests = new Map<string, CdpPendingRequest>();
    private callback: OnCdpCapturedCallback | null = null;
    private isListening = false;

    // Interception state
    private interceptEnabled = new Set<number>();
    private manualInterceptTabs = new Set<number>();
    private interceptStage: 'Request' | 'Response' | 'Both' = 'Response';
    private interceptRules: MatchReplaceRule[] = [];
    private includeRules: string[] = [];
    private excludeRules: string[] = [];
    private pausedItems = new Map<string, PausedTrafficItem>();

    constructor() {}

    public init(callback: OnCdpCapturedCallback) {
        this.callback = callback;
        if (!this.isListening && chrome.debugger) {
            chrome.debugger.onEvent.addListener(this.handleDebuggerEvent);
            chrome.debugger.onDetach.addListener(this.handleDebuggerDetach);
            this.isListening = true;
        }
    }

    /**
     * Attaches chrome.debugger with explicit DevTools collision detection.
     */
    public async attachTab(tabId: number): Promise<{ success: boolean; error?: string }> {
        if (!chrome.debugger) {
            return { success: false, error: 'chrome.debugger API is not available.' };
        }
        if (this.attachedTabs.has(tabId)) {
            return { success: true };
        }

        try {
            await chrome.debugger.attach({ tabId }, '1.3');
            this.attachedTabs.add(tabId);

            // Enable Network domain for full fidelity wire headers & networkId correlation
            await sendCommandWithTimeout({ tabId }, 'Network.enable', {
                maxTotalBufferSize: 100_000_000,
                maxResourceBufferSize: 50_000_000
            });

            return { success: true };
        } catch (error: any) {
            const rawMessage = error?.message || String(error);
            let friendlyError = rawMessage;

            // Detect DevTools collision and give clear user explanation
            if (rawMessage.includes('Another debugger is already attached')) {
                friendlyError = 'Cannot attach Pro Mode: Chrome DevTools is open on this tab. Chrome allows only one debugger at a time per tab. Please close DevTools on this tab to use Pro Mode.';
            }

            console.warn(`[ProEngine] Failed to attach debugger to tab ${tabId}:`, friendlyError);
            this.attachedTabs.delete(tabId);
            return { success: false, error: friendlyError };
        }
    }

    /**
     * Enables CDP Fetch domain interception with urlPattern and resourceType scoping.
     * Default stage is 'Response' for optimal performance.
     */
    public async enableInterception(
        tabId: number,
        options: InterceptionOptions = {}
    ): Promise<boolean> {
        if (!this.attachedTabs.has(tabId)) return false;

        const stage = options.stage || 'Response';
        this.interceptStage = stage;
        this.interceptRules = options.rules || [];
        this.includeRules = options.includeRules || [];
        this.excludeRules = options.excludeRules || [];

        // Focus strictly on API/Page traffic (XHR, Fetch, Document)
        const targetResourceTypes: ('Document' | 'XHR' | 'Fetch')[] = options.resourceTypes || ['Document', 'XHR', 'Fetch'];
        
        const urlPatterns = (this.includeRules.length > 0)
            ? this.includeRules.map(r => scopeRuleToCdpPattern(r))
            : ['*'];

        const patterns: any[] = [];
        for (const urlPattern of urlPatterns) {
            for (const resourceType of targetResourceTypes) {
                if (stage === 'Both' || stage === 'Request') {
                    patterns.push({ urlPattern, resourceType, requestStage: 'Request' });
                }
                if (stage === 'Both' || stage === 'Response') {
                    patterns.push({ urlPattern, resourceType, requestStage: 'Response' });
                }
            }
        }

        try {
            await sendCommandWithTimeout({ tabId }, 'Fetch.enable', { patterns });
            this.interceptEnabled.add(tabId);

            if (options.manualIntercept) {
                this.manualInterceptTabs.add(tabId);
            } else {
                this.manualInterceptTabs.delete(tabId);
            }

            return true;
        } catch (error) {
            console.warn(`[ProEngine] Failed to enable Fetch interception on tab ${tabId}:`, error);
            return false;
        }
    }

    public async disableInterception(tabId: number): Promise<void> {
        if (!this.interceptEnabled.has(tabId)) return;
        try {
            await sendCommandWithTimeout({ tabId }, 'Fetch.disable');
        } catch {
            // Ignored if already disabled
        } finally {
            this.interceptEnabled.delete(tabId);
            this.manualInterceptTabs.delete(tabId);
        }
    }

    /**
     * Fulfills a paused response with user-edited status, headers, and body.
     */
    public async fulfillPausedResponse(
        tabId: number,
        requestId: string,
        responseCode: number,
        responseHeaders: { name: string; value: string }[],
        body: string
    ): Promise<boolean> {
        try {
            const base64Body = stringToBase64(body);
            await sendCommandWithTimeout({ tabId }, 'Fetch.fulfillRequest', {
                requestId,
                responseCode: responseCode || 200,
                responseHeaders,
                body: base64Body
            });
            this.pausedItems.delete(requestId);
            await this.removeGhostPause(requestId);
            return true;
        } catch (error) {
            console.error('[ProEngine] Failed to fulfill response:', error);
            await this.removeGhostPause(requestId);
            return false;
        }
    }

    /**
     * Continues a paused request or response unmodified.
     */
    public async continuePausedItem(tabId: number, requestId: string, isResponse: boolean): Promise<boolean> {
        try {
            if (isResponse) {
                await sendCommandWithTimeout({ tabId }, 'Fetch.continueResponse', { requestId });
            } else {
                await sendCommandWithTimeout({ tabId }, 'Fetch.continueRequest', { requestId });
            }
            this.pausedItems.delete(requestId);
            await this.removeGhostPause(requestId);
            return true;
        } catch {
            this.pausedItems.delete(requestId);
            await this.removeGhostPause(requestId);
            return false;
        }
    }

    /**
     * Fails a paused request/response.
     */
    public async failPausedItem(tabId: number, requestId: string): Promise<boolean> {
        try {
            await sendCommandWithTimeout({ tabId }, 'Fetch.failRequest', {
                requestId,
                errorReason: 'Failed'
            });
            this.pausedItems.delete(requestId);
            await this.removeGhostPause(requestId);
            return true;
        } catch {
            this.pausedItems.delete(requestId);
            await this.removeGhostPause(requestId);
            return false;
        }
    }

    public async detachTab(tabId: number): Promise<void> {
        if (!chrome.debugger || !this.attachedTabs.has(tabId)) return;
        this.interceptEnabled.delete(tabId);
        this.manualInterceptTabs.delete(tabId);
        try {
            await chrome.debugger.detach({ tabId });
        } catch {
            // Ignored if already detached
        } finally {
            this.attachedTabs.delete(tabId);
        }
    }

    public isTabAttached(tabId: number): boolean {
        return this.attachedTabs.has(tabId);
    }

    public isInterceptionEnabled(tabId: number): boolean {
        return this.interceptEnabled.has(tabId);
    }

    public isManualIntercept(tabId: number): boolean {
        return this.manualInterceptTabs.has(tabId);
    }

    public getInterceptStage(): 'Request' | 'Response' | 'Both' {
        return this.interceptStage;
    }

    public getAttachedTabs(): number[] {
        return Array.from(this.attachedTabs);
    }

    public async reattachTabs(tabIds: number[]): Promise<void> {
        for (const tabId of tabIds) {
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab) {
                    await this.attachTab(tabId);
                }
            } catch {
                // Tab no longer exists
            }
        }
    }

    /**
     * Ghost-Pause Tracking in chrome.storage.session.
     * Merges the new pause entry into session storage.
     */
    private async recordGhostPause(entry: GhostPauseEntry) {
        if (!chrome.storage?.session) return;
        try {
            const stored = await chrome.storage.session.get(GHOST_PAUSE_STORAGE_KEY);
            const map: Record<string, GhostPauseEntry> = (stored as any)[GHOST_PAUSE_STORAGE_KEY] || {};
            map[entry.requestId] = entry;
            await chrome.storage.session.set({ [GHOST_PAUSE_STORAGE_KEY]: map });
        } catch {
            // Safe fallback
        }
    }

    private async removeGhostPause(requestId: string) {
        if (!chrome.storage?.session) return;
        try {
            const stored = await chrome.storage.session.get(GHOST_PAUSE_STORAGE_KEY);
            const map: Record<string, GhostPauseEntry> = (stored as any)[GHOST_PAUSE_STORAGE_KEY] || {};
            if (map[requestId]) {
                delete map[requestId];
                await chrome.storage.session.set({ [GHOST_PAUSE_STORAGE_KEY]: map });
            }
        } catch {
            // Safe fallback
        }
    }

    /**
     * Top-Level Service Worker Ghost-Pause Cleanup.
     * Run on every SW wake-up to release dangling paused requests from prior lifecycles.
     */
    public async cleanupGhostPauses(): Promise<number> {
        if (!chrome.storage?.session) return 0;
        let releasedCount = 0;
        try {
            const stored = await chrome.storage.session.get(GHOST_PAUSE_STORAGE_KEY);
            const map: Record<string, GhostPauseEntry> = (stored as any)[GHOST_PAUSE_STORAGE_KEY] || {};
            const entries = Object.values(map);

            for (const entry of entries) {
                try {
                    await sendCommandWithTimeout(
                        { tabId: entry.tabId },
                        entry.isResponse ? 'Fetch.continueResponse' : 'Fetch.continueRequest',
                        { requestId: entry.requestId },
                        2000
                    );
                    releasedCount++;
                } catch {
                    // Tab may be closed or detached
                }
            }

            await chrome.storage.session.remove(GHOST_PAUSE_STORAGE_KEY);
        } catch {
            // Safe fallback
        }
        return releasedCount;
    }

    /**
     * Detects when Chrome detaches the debugger because DevTools was opened.
     */
    private handleDebuggerDetach = (source: chrome.debugger.Debuggee, reason: string) => {
        if (source.tabId) {
            const tabId = source.tabId;
            this.attachedTabs.delete(tabId);
            this.interceptEnabled.delete(tabId);
            this.manualInterceptTabs.delete(tabId);

            let userMsg = `Debugger detached from tab ${tabId}.`;
            if (reason === 'replaced_with_devtools') {
                userMsg = 'Pro Mode was detached because Chrome DevTools was opened on this tab. Chrome allows only one debugger at a time. Close DevTools to resume Pro Mode.';
            } else if (reason === 'target_closed') {
                userMsg = 'Target tab was closed.';
            }

            console.info(`[ProEngine] ${userMsg} (reason: ${reason})`);

            // Broadcast detachment to UI so Pro & Intercept buttons update immediately
            chrome.runtime.sendMessage({
                type: 'PRO_ENGINE_DETACHED',
                payload: { tabId, reason, message: userMsg }
            }).catch(() => {});
        }
    };

    private handleDebuggerEvent = (
        source: chrome.debugger.Debuggee,
        method: string,
        params?: any
    ) => {
        const tabId = source.tabId;
        if (!tabId || !params) return;

        switch (method) {
            case 'Network.requestWillBeSent': {
                const parsed = CdpRequestWillBeSentSchema.safeParse(params);
                if (!parsed.success) return;

                const req = parsed.data;

                // Handle redirect hop: flush previous request (e.g. POST login) before starting next hop
                if (req.redirectResponse) {
                    const previous = this.pendingRequests.get(req.requestId);
                    if (previous) {
                        previous.statusCode = req.redirectResponse.status;
                        previous.statusText = req.redirectResponse.statusText || 'Found';
                        if (req.redirectResponse.headers) {
                            previous.rawResponseHeaders = {
                                ...(previous.rawResponseHeaders || {}),
                                ...req.redirectResponse.headers
                            };
                        }
                        this.flushCdpRequest(previous);
                        this.pendingRequests.delete(req.requestId);
                    }
                }

                const existing = this.pendingRequests.get(req.requestId) || {
                    requestId: req.requestId,
                    tabId,
                    url: req.request.url,
                    method: req.request.method,
                    timestamp: req.wallTime ? Math.round(req.wallTime * 1000) : Date.now()
                };

                existing.url = req.request.url;
                existing.method = req.request.method;
                existing.initiator = req.initiator;
                if (req.request.postData) {
                    existing.postData = req.request.postData;
                }

                this.pendingRequests.set(req.requestId, existing);
                break;
            }

            case 'Network.requestWillBeSentExtraInfo': {
                const parsed = CdpRequestExtraInfoSchema.safeParse(params);
                if (!parsed.success) return;

                const extra = parsed.data;
                const existing = this.pendingRequests.get(extra.requestId) || {
                    requestId: extra.requestId,
                    tabId,
                    url: '',
                    method: 'GET',
                    timestamp: Date.now()
                };

                existing.rawHeaders = extra.headers;
                this.pendingRequests.set(extra.requestId, existing);
                break;
            }

            case 'Network.responseReceived': {
                const parsed = CdpResponseReceivedSchema.safeParse(params);
                if (!parsed.success) return;

                const respData = parsed.data;
                const existing = this.pendingRequests.get(respData.requestId);
                if (existing) {
                    existing.statusCode = respData.response.status;
                    existing.statusText = respData.response.statusText || (respData.response.status === 200 ? 'OK' : '');
                    existing.protocol = respData.response.protocol;
                    if (respData.response.headers) {
                        existing.rawResponseHeaders = {
                            ...(respData.response.headers),
                            ...(existing.rawResponseHeaders || {})
                        };
                    }
                }
                break;
            }

            case 'Network.responseReceivedExtraInfo': {
                const parsed = CdpResponseReceivedExtraInfoSchema.safeParse(params);
                if (!parsed.success) return;

                const extra = parsed.data;
                const existing = this.pendingRequests.get(extra.requestId);
                if (existing) {
                    existing.rawResponseHeaders = {
                        ...(existing.rawResponseHeaders || {}),
                        ...extra.headers
                    };
                    if (extra.statusCode) existing.statusCode = extra.statusCode;
                }
                break;
            }

            case 'Network.loadingFinished': {
                const requestId = params.requestId;
                const existing = this.pendingRequests.get(requestId);
                if (!existing) return;

                // Fetch organic response body with timeout (§17.5)
                sendCommandWithTimeout(
                    { tabId },
                    'Network.getResponseBody',
                    { requestId },
                    5_000
                ).then((res: any) => {
                    if (res && res.body) {
                        existing.responseBody = res.base64Encoded ? atob(res.body) : res.body;
                    }
                }).catch(() => {
                    // Response body unavailable
                }).finally(() => {
                    this.flushCdpRequest(existing);
                    this.pendingRequests.delete(requestId);
                });
                break;
            }

            case 'Network.webSocketFrameSent':
            case 'Network.webSocketFrameReceived': {
                console.debug(`[ProEngine] ${method}:`, params.requestId, params.response?.payloadData?.slice(0, 100));
                break;
            }

            // CDP Fetch domain interception (Request & Response stages)
            case 'Fetch.requestPaused': {
                this.handleFetchPaused(tabId, params);
                break;
            }

            default: {
                if (method.startsWith('Network.') || method.startsWith('Fetch.')) {
                    console.debug(`[ProEngine] Unhandled CDP event: ${method}`, JSON.stringify(params).slice(0, 200));
                }
                break;
            }
        }
    };

    /**
     * Handles Fetch.requestPaused events with scope checks, redirect handling, and correlation.
     */
    private async handleFetchPaused(tabId: number, params: any) {
        const { requestId, request, responseStatusCode, responseHeaders, networkId } = params;
        if (!requestId || !request) return;

        const isResponseStage = typeof responseStatusCode === 'number' || !!responseHeaders;
        const isManual = this.manualInterceptTabs.has(tabId);

        // Scope Exclude Check — immediately pass excluded URLs with zero delay
        if (!isUrlInScope(request.url, this.includeRules, this.excludeRules, true)) {
            if (isResponseStage) {
                sendCommandWithTimeout({ tabId }, 'Fetch.continueResponse', { requestId }).catch(() => {});
            } else {
                sendCommandWithTimeout({ tabId }, 'Fetch.continueRequest', { requestId }).catch(() => {});
            }
            return;
        }

        if (isResponseStage) {
            // ═════════════════════════════════════════════════════
            // RESPONSE STAGE INTERCEPTION
            // ═════════════════════════════════════════════════════

            // Redirect Guard — CDP cannot getResponseBody for 301/302/303/307/308
            const isRedirect = typeof responseStatusCode === 'number' && REDIRECT_CODES.includes(responseStatusCode);

            let originalBody = '';
            if (!isRedirect) {
                try {
                    const resBody = await sendCommandWithTimeout(
                        { tabId },
                        'Fetch.getResponseBody',
                        { requestId },
                        3000
                    );
                    if (resBody && resBody.body) {
                        originalBody = resBody.base64Encoded ? atob(resBody.body) : resBody.body;
                    }
                } catch {
                    // Body unavailable or empty
                }
            } else if (!isManual) {
                // In automated mode, pass redirects through immediately
                sendCommandWithTimeout({ tabId }, 'Fetch.continueResponse', { requestId }).catch(() => {});
                return;
            }

            const headerList: { name: string; value: string }[] = responseHeaders
                ? responseHeaders.map((h: any) => ({ name: h.name, value: h.value }))
                : [];

            if (isManual) {
                // Manual Intercept: Record ghost-pause in session storage and notify UI
                await this.recordGhostPause({
                    requestId,
                    tabId,
                    isResponse: true,
                    timestamp: Date.now()
                });

                const pausedItem: PausedTrafficItem = {
                    requestId,
                    networkId,
                    tabId,
                    stage: 'response',
                    url: request.url,
                    method: request.method,
                    statusCode: responseStatusCode || 200,
                    statusText: params.responseStatusText || (responseStatusCode === 200 ? 'OK' : 'Response'),
                    headers: headerList,
                    body: originalBody
                };

                this.pausedItems.set(requestId, pausedItem);

                chrome.runtime.sendMessage({
                    type: 'TRAFFIC_PAUSED',
                    payload: pausedItem
                }).catch(() => {
                    // Fail-safe: if UI is closed, continue response so browser doesn't hang
                    sendCommandWithTimeout({ tabId }, 'Fetch.continueResponse', { requestId }).catch(() => {});
                    this.removeGhostPause(requestId);
                });
                return;
            }

            // Automated Match & Replace for Responses
            const activeRules = this.interceptRules.filter(r => r.enabled);
            if (activeRules.length === 0) {
                sendCommandWithTimeout({ tabId }, 'Fetch.continueResponse', { requestId }).catch(() => {});
                return;
            }

            const headersRecord: Record<string, string> = {};
            headerList.forEach(h => {
                headersRecord[h.name] = h.value;
            });

            const result = applyResponseMatchReplaceRules(headersRecord, originalBody, activeRules);
            const modifiedHeaders = Object.entries(result.headers).map(([name, value]) => ({ name, value }));

            try {
                const base64Body = stringToBase64(result.body || '');
                await sendCommandWithTimeout({ tabId }, 'Fetch.fulfillRequest', {
                    requestId,
                    responseCode: responseStatusCode || 200,
                    responseHeaders: modifiedHeaders,
                    body: base64Body
                });
            } catch (error) {
                console.warn(`[ProEngine] Failed to fulfill response ${requestId}:`, error);
                sendCommandWithTimeout({ tabId }, 'Fetch.continueResponse', { requestId }).catch(() => {});
            }

        } else {
            // ═════════════════════════════════════════════════════
            // REQUEST STAGE INTERCEPTION
            // ═════════════════════════════════════════════════════
            const headerList: { name: string; value: string }[] = [];
            if (request.headers) {
                Object.entries(request.headers as Record<string, string>).forEach(([name, value]) => {
                    headerList.push({ name, value });
                });
            }

            if (isManual) {
                // Manual Intercept on Request: Record ghost-pause in session storage
                await this.recordGhostPause({
                    requestId,
                    tabId,
                    isResponse: false,
                    timestamp: Date.now()
                });

                const pausedItem: PausedTrafficItem = {
                    requestId,
                    networkId,
                    tabId,
                    stage: 'request',
                    url: request.url,
                    method: request.method,
                    headers: headerList,
                    body: request.postData || ''
                };

                this.pausedItems.set(requestId, pausedItem);

                chrome.runtime.sendMessage({
                    type: 'TRAFFIC_PAUSED',
                    payload: pausedItem
                }).catch(() => {
                    sendCommandWithTimeout({ tabId }, 'Fetch.continueRequest', { requestId }).catch(() => {});
                    this.removeGhostPause(requestId);
                });
                return;
            }

            // Automated Match & Replace for Requests
            const activeRules = this.interceptRules.filter(r => r.enabled);
            if (activeRules.length === 0) {
                sendCommandWithTimeout({ tabId }, 'Fetch.continueRequest', { requestId }).catch(() => {});
                return;
            }

            const headersRecord: Record<string, string> = {};
            headerList.forEach(h => {
                headersRecord[h.name] = h.value;
            });

            const result = applyMatchReplaceRules(
                request.url,
                headersRecord,
                request.postData || null,
                activeRules
            );

            const modifiedHeaders = Object.entries(result.headers).map(([name, value]) => ({ name, value }));

            try {
                await sendCommandWithTimeout({ tabId }, 'Fetch.continueRequest', {
                    requestId,
                    url: result.url !== request.url ? result.url : undefined,
                    headers: modifiedHeaders,
                    postData: result.body && result.body !== request.postData ? stringToBase64(result.body) : undefined
                });
            } catch (error) {
                console.warn(`[ProEngine] Failed to continue request ${requestId}:`, error);
                sendCommandWithTimeout({ tabId }, 'Fetch.continueRequest', { requestId }).catch(() => {});
            }
        }
    }

    private flushCdpRequest(cdpReq: CdpPendingRequest) {
        if (!this.callback || !cdpReq.url) return;

        const headers: { name: string; value: string }[] = [];
        if (cdpReq.rawHeaders) {
            Object.entries(cdpReq.rawHeaders).forEach(([name, value]) => {
                headers.push({ name, value });
            });
        }

        const responseHeaders: { name: string; value: string }[] = [];
        if (cdpReq.rawResponseHeaders) {
            Object.entries(cdpReq.rawResponseHeaders).forEach(([name, value]) => {
                responseHeaders.push({ name, value });
            });
        }

        const harObj: HarRequestObject = {
            requestId: `cdp-${cdpReq.requestId}`,
            fidelity: 'full',
            fidelityNotes: ['Captured via Pro Mode (CDP) with full wire headers & organic response body.'],
            timestamp: cdpReq.timestamp,
            initiator: cdpReq.initiator,
            request: {
                method: cdpReq.method,
                url: cdpReq.url,
                httpVersion: cdpReq.protocol || 'HTTP/1.1',
                headers,
                postData: cdpReq.postData ? { text: cdpReq.postData } : undefined,
                response: {
                    status: cdpReq.statusCode || 200,
                    statusText: cdpReq.statusText || (cdpReq.statusCode === 200 ? 'OK' : ''),
                    httpVersion: cdpReq.protocol || 'HTTP/1.1',
                    headers: responseHeaders,
                    body: cdpReq.responseBody
                }
            }
        };

        this.callback(harObj, cdpReq.tabId);
    }
}

export const proEngine = new ProCaptureEngine();
