import { webRequestToHar } from '../format/harAdapter';
import type { HarRequestObject } from '../../shared/utils/http';

export type OnRequestCapturedCallback = (harRequest: HarRequestObject, tabId?: number) => void;

export class StandardCaptureEngine {
    private requestBodies = new Map<string, any>();
    private pendingRequests = new Map<string, { har: HarRequestObject; tabId?: number }>();
    private callback: OnRequestCapturedCallback | null = null;
    private isRunning = false;
    private cleanupIntervalId: any = null;

    constructor() {}

    public start(callback: OnRequestCapturedCallback) {
        if (this.isRunning) return;
        this.callback = callback;
        this.isRunning = true;

        chrome.webRequest.onBeforeRequest.addListener(
            this.handleBeforeRequest,
            { urls: ['<all_urls>'] },
            ['requestBody']
        );

        chrome.webRequest.onBeforeSendHeaders.addListener(
            this.handleBeforeSendHeaders,
            { urls: ['<all_urls>'] },
            ['requestHeaders', 'extraHeaders']
        );

        chrome.webRequest.onHeadersReceived.addListener(
            this.handleHeadersReceived,
            { urls: ['<all_urls>'] },
            ['responseHeaders', 'extraHeaders']
        );

        chrome.webRequest.onBeforeRedirect.addListener(
            this.handleBeforeRedirect,
            { urls: ['<all_urls>'] },
            ['responseHeaders', 'extraHeaders']
        );

        chrome.webRequest.onCompleted.addListener(
            this.handleCompleted,
            { urls: ['<all_urls>'] }
        );

        chrome.webRequest.onErrorOccurred.addListener(
            this.handleErrorOccurred,
            { urls: ['<all_urls>'] }
        );

        // 60-second periodic garbage collection
        this.cleanupIntervalId = setInterval(() => {
            this.requestBodies.clear();
            this.pendingRequests.clear();
        }, 60_000);
    }

    public stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        chrome.webRequest.onBeforeRequest.removeListener(this.handleBeforeRequest);
        chrome.webRequest.onBeforeSendHeaders.removeListener(this.handleBeforeSendHeaders);
        chrome.webRequest.onHeadersReceived.removeListener(this.handleHeadersReceived);
        chrome.webRequest.onBeforeRedirect.removeListener(this.handleBeforeRedirect);
        chrome.webRequest.onCompleted.removeListener(this.handleCompleted);
        chrome.webRequest.onErrorOccurred.removeListener(this.handleErrorOccurred);

        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }

        this.requestBodies.clear();
        this.pendingRequests.clear();
        this.callback = null;
    }

    private handleBeforeRequest = (details: any) => {
        if (details.requestBody) {
            this.requestBodies.set(details.requestId, details);
        }
        return undefined;
    };

    private handleBeforeSendHeaders = (details: any) => {
        const bodyDetails = this.requestBodies.get(details.requestId);
        const harRequest = webRequestToHar(details, bodyDetails);

        this.pendingRequests.set(details.requestId, {
            har: harRequest,
            tabId: details.tabId
        });

        this.requestBodies.delete(details.requestId);
        return undefined;
    };

    private handleHeadersReceived = (details: any) => {
        const pending = this.pendingRequests.get(details.requestId);
        if (pending && pending.har.request.response) {
            const headers = details.responseHeaders
                ? details.responseHeaders.map((h: { name: string; value?: string }) => ({ name: h.name, value: h.value || '' }))
                : [];

            pending.har.request.response.status = details.statusCode || 200;
            pending.har.request.response.statusText = details.statusLine
                ? details.statusLine.split(' ').slice(2).join(' ') || 'OK'
                : 'OK';
            pending.har.request.response.headers = headers;
        }
        return undefined;
    };

    /**
     * Captures requests that result in HTTP redirects (e.g. 302 login redirects)
     * before Chrome reuses the requestId for the next hop.
     */
    private handleBeforeRedirect = (details: any) => {
        const pending = this.pendingRequests.get(details.requestId);
        if (pending && this.callback) {
            const headers = details.responseHeaders
                ? details.responseHeaders.map((h: { name: string; value?: string }) => ({ name: h.name, value: h.value || '' }))
                : [];

            if (pending.har.request.response) {
                pending.har.request.response.status = details.statusCode || 302;
                pending.har.request.response.statusText = details.statusLine
                    ? details.statusLine.split(' ').slice(2).join(' ') || 'Found'
                    : 'Found';
                pending.har.request.response.headers = headers;
            }

            // Emit the redirected request (e.g. POST login)
            this.callback(pending.har, pending.tabId);
        }

        this.requestBodies.delete(details.requestId);
        this.pendingRequests.delete(details.requestId);
        return undefined;
    };

    private handleCompleted = (details: any) => {
        const pending = this.pendingRequests.get(details.requestId);
        if (pending && this.callback) {
            if (details.statusCode && pending.har.request.response) {
                pending.har.request.response.status = details.statusCode;
            }
            this.callback(pending.har, pending.tabId);
        } else if (!pending) {
            // Fallback if beforeSendHeaders was missed
            const har = webRequestToHar(details, null);
            if (har.request.response) {
                har.request.response.status = details.statusCode || 200;
            }
            if (this.callback) this.callback(har, details.tabId);
        }

        this.requestBodies.delete(details.requestId);
        this.pendingRequests.delete(details.requestId);
        return undefined;
    };

    private handleErrorOccurred = (details: any) => {
        const pending = this.pendingRequests.get(details.requestId);
        if (pending && this.callback) {
            if (pending.har.request.response) {
                pending.har.request.response.status = 0;
                pending.har.request.response.statusText = details.error || 'Failed';
            }
            this.callback(pending.har, pending.tabId);
        }

        this.requestBodies.delete(details.requestId);
        this.pendingRequests.delete(details.requestId);
        return undefined;
    };
}

export const standardEngine = new StandardCaptureEngine();
