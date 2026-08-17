import { persistCapturedRequest, type RequestSummary } from '../storage/db';
import { harToRaw, harToResponseRaw, type HarRequestObject } from '../../shared/utils/http';

export interface PendingCorrelationRecord {
    key: string;
    harObject: HarRequestObject;
    tabId?: number;
    source: 'standard' | 'cdp';
    receivedAt: number;
}

export class ReconciliationOrchestrator {
    private correlationBuffer = new Map<string, PendingCorrelationRecord>();
    private pendingFlushQueue: { summary: RequestSummary; rawRequest: string; rawResponse?: string }[] = [];
    private flushTimerId: any = null;
    private bufferSweepTimerId: any = null;

    constructor() {
        // Periodic check to flush orphan correlation entries older than 500ms
        this.bufferSweepTimerId = setInterval(() => {
            this.sweepOrphanBuffer();
        }, 500);
    }

    public handleStandardEvent(harRequest: HarRequestObject, tabId?: number) {
        this.processEvent(harRequest, 'standard', tabId);
    }

    public handleCdpEvent(harRequest: HarRequestObject, tabId?: number) {
        this.processEvent(harRequest, 'cdp', tabId);
    }

    private getCorrelationKey(har: HarRequestObject, tabId?: number): string {
        const method = har.request.method || 'GET';
        const url = har.request.url || '';
        const timeBucket = Math.floor((har.timestamp || Date.now()) / 400); // 400ms bucket
        return `${tabId || 0}|${method.toUpperCase()}|${url}|${timeBucket}`;
    }

    private processEvent(harRequest: HarRequestObject, source: 'standard' | 'cdp', tabId?: number) {
        const key = this.getCorrelationKey(harRequest, tabId);
        const existing = this.correlationBuffer.get(key);

        if (!existing) {
            // Store in buffer waiting for counterpart
            this.correlationBuffer.set(key, {
                key,
                harObject: harRequest,
                tabId,
                source,
                receivedAt: Date.now()
            });

            // Set short timer to flush if no counterpart arrives
            setTimeout(() => {
                const item = this.correlationBuffer.get(key);
                if (item) {
                    this.correlationBuffer.delete(key);
                    this.queueForFlush(item.harObject, item.tabId);
                }
            }, 300);
            return;
        }

        // Counterpart arrived! Merge with CDP taking priority
        this.correlationBuffer.delete(key);
        const merged = this.mergeHarObjects(existing.harObject, harRequest, existing.source, source);
        this.queueForFlush(merged, tabId || existing.tabId);
    }

    private mergeHarObjects(
        objA: HarRequestObject,
        objB: HarRequestObject,
        sourceA: 'standard' | 'cdp',
        sourceB: 'standard' | 'cdp'
    ): HarRequestObject {
        const cdpObj = sourceA === 'cdp' ? objA : (sourceB === 'cdp' ? objB : null);
        const stdObj = sourceA === 'standard' ? objA : objB;

        if (!cdpObj) {
            return stdObj;
        }

        // Merge request headers: CDP raw headers win, fallback to standard headers
        const headerMap = new Map<string, string>();
        (stdObj.request.headers || []).forEach(h => headerMap.set(h.name.toLowerCase(), h.value));
        (cdpObj.request.headers || []).forEach(h => headerMap.set(h.name.toLowerCase(), h.value));

        const mergedHeaders = Array.from(headerMap.entries()).map(([name, value]) => ({ name, value }));

        // Merge response: CDP response body and headers win, fallback to standard
        const mergedResponse = {
            status: cdpObj.request.response?.status || stdObj.request.response?.status || 200,
            statusText: cdpObj.request.response?.statusText || stdObj.request.response?.statusText || 'OK',
            httpVersion: cdpObj.request.response?.httpVersion || stdObj.request.response?.httpVersion || 'HTTP/1.1',
            headers: (cdpObj.request.response?.headers && cdpObj.request.response.headers.length > 0)
                ? cdpObj.request.response.headers
                : (stdObj.request.response?.headers || []),
            body: cdpObj.request.response?.body || stdObj.request.response?.body || undefined
        };

        return {
            requestId: cdpObj.requestId || stdObj.requestId,
            fidelity: 'full',
            fidelityNotes: ['Merged wire capture: CDP wire headers + organic response body.'],
            timestamp: cdpObj.timestamp || stdObj.timestamp,
            initiator: cdpObj.initiator || stdObj.initiator,
            request: {
                method: cdpObj.request.method,
                url: cdpObj.request.url,
                httpVersion: cdpObj.request.httpVersion || 'HTTP/1.1',
                headers: mergedHeaders,
                postData: stdObj.request.postData || cdpObj.request.postData,
                response: mergedResponse
            }
        };
    }

    private sweepOrphanBuffer() {
        const now = Date.now();
        for (const [key, item] of this.correlationBuffer.entries()) {
            if (now - item.receivedAt > 500) {
                this.correlationBuffer.delete(key);
                this.queueForFlush(item.harObject, item.tabId);
            }
        }
    }

    private queueForFlush(har: HarRequestObject, tabId?: number) {
        const rawReq = harToRaw(har, false);
        const rawRes = harToResponseRaw(har.request.response);

        const summary: RequestSummary = {
            requestId: har.requestId ? `${har.requestId}-${har.request.method}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}` : `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            tabId,
            host: this.extractHost(har.request.url),
            method: har.request.method || 'GET',
            url: har.request.url || '',
            status: har.request.response?.status || 0,
            statusText: har.request.response?.statusText || (har.request.response?.status ? String(har.request.response.status) : undefined),
            timestamp: har.timestamp || Date.now(),
            fidelity: har.fidelity || 'partial',
            fidelityNotes: har.fidelityNotes || [],
            tags: [],
            sizeBytes: rawReq.length,
            initiator: har.initiator
        };

        this.pendingFlushQueue.push({
            summary,
            rawRequest: rawReq,
            rawResponse: rawRes
        });

        if (!this.flushTimerId) {
            this.flushTimerId = setTimeout(() => this.flushBatch(), 150); // Coalesce burst into 150ms batch
        }
    }

    private async flushBatch() {
        this.flushTimerId = null;
        if (this.pendingFlushQueue.length === 0) return;

        const batch = this.pendingFlushQueue.splice(0);
        const persistedSummaries: RequestSummary[] = [];

        for (const item of batch) {
            try {
                const insertedId = await persistCapturedRequest(item.summary, item.rawRequest, item.rawResponse);
                persistedSummaries.push({
                    ...item.summary,
                    id: insertedId
                });
            } catch (err) {
                console.error('[Reconciler] Failed to persist request:', err);
            }
        }

        // Broadcast batch to active sidepanel / UI views
        if (persistedSummaries.length > 0) {
            chrome.runtime.sendMessage({
                type: 'NEW_REQUESTS',
                payload: persistedSummaries
            }).catch(() => {
                // UI closed or inactive; harmless since IndexedDB already persisted
            });
        }
    }

    private extractHost(urlStr: string): string {
        try {
            return new URL(urlStr).hostname;
        } catch {
            return urlStr;
        }
    }

    public destroy() {
        if (this.bufferSweepTimerId) {
            clearInterval(this.bufferSweepTimerId);
        }
        if (this.flushTimerId) {
            clearTimeout(this.flushTimerId);
        }
        this.correlationBuffer.clear();
        this.pendingFlushQueue = [];
    }
}

export const reconciler = new ReconciliationOrchestrator();
