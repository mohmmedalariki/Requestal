/**
 * Request Dispatcher (V2)
 * Handles parsing raw HTTP strings, executing them via Fetch with timeouts/cancellation,
 * and concurrency limiting.
 */

export interface ParsedRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
}

export interface DispatchResponse {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    timeMs: number;
    sizeBytes?: number;
    isTruncated?: boolean;
}

export interface DispatchOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    proxyRelayUrl?: string;
    maxBodySizeBytes?: number;
}

/**
 * Parses a raw HTTP request string into components suitable for fetch().
 */
export function parseRawRequest(raw: string): ParsedRequest {
    const lines = raw.split('\n');
    const firstLine = lines[0].trim();
    const parts = firstLine.split(' ');
    const method = parts[0];
    const url = parts[1];

    if (!method || !url) {
        throw new Error("Invalid Request Line: Missing method or URL");
    }

    const headers: Record<string, string> = {};
    let bodyStartPosition = -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (line === '') {
            bodyStartPosition = i + 1;
            break;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > -1) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            headers[key] = value;
        }
    }

    let body: string | null = null;
    if (bodyStartPosition > -1 && bodyStartPosition < lines.length) {
        body = lines.slice(bodyStartPosition).join('\n');
    }

    if (['GET', 'HEAD'].includes(method.toUpperCase())) {
        body = null;
    }

    return { method: method.toUpperCase(), url, headers, body };
}

/**
 * Executes a raw HTTP request with AbortController timeout & cancellation guards.
 */
export async function dispatchRequest(
    rawRequest: string,
    options: DispatchOptions = {}
): Promise<DispatchResponse> {
    const { timeoutMs = 30_000, signal: externalSignal, maxBodySizeBytes = 5 * 1024 * 1024 } = options;
    const start = performance.now();

    const controller = new AbortController();
    let timeoutId: any = null;

    if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
            controller.abort("Request Timeout");
        }, timeoutMs);
    }

    if (externalSignal) {
        externalSignal.addEventListener("abort", () => {
            controller.abort(externalSignal.reason || "User Cancelled");
        });
    }

    try {
        const { method, url, headers, body } = parseRawRequest(rawRequest);
        const headersRecord = { ...headers };

        let finalUrl = url;

        // Protocol enforcement & absolute URL construction
        if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
            const hostKey = Object.keys(headersRecord).find(k => k.toLowerCase() === 'host');
            if (hostKey) {
                finalUrl = `https://${headersRecord[hostKey]}${url.startsWith('/') ? '' : '/'}${url}`;
                delete headersRecord[hostKey]; // Prevent browser "Unsafe Header" error
            } else {
                throw new Error("Missing Host header for relative URL dispatch");
            }
        } else {
            // If absolute URL is provided, strip Host header to prevent fetch exception
            const hostKey = Object.keys(headersRecord).find(k => k.toLowerCase() === 'host');
            if (hostKey) {
                delete headersRecord[hostKey];
            }
        }

        const response = await fetch(finalUrl, {
            method,
            headers: headersRecord,
            body: ['GET', 'HEAD'].includes(method) ? null : body,
            credentials: 'include',
            mode: 'cors',
            signal: controller.signal
        });

        const end = performance.now();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((val, key) => {
            responseHeaders[key] = val;
        });

        let responseText = '';
        let isTruncated = false;

        // Bounded response handling (§16.5)
        if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let totalBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalBytes += value.length;

                if (totalBytes > maxBodySizeBytes) {
                    isTruncated = true;
                    reader.cancel("Max size exceeded");
                    responseText += `\n\n[... Truncated: Response exceeded ${(maxBodySizeBytes / (1024 * 1024)).toFixed(1)} MB limit ...]`;
                    break;
                }
                responseText += decoder.decode(value, { stream: true });
            }
            responseText += decoder.decode();
        } else {
            responseText = await response.text();
        }

        return {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: responseText,
            timeMs: Math.round(end - start),
            sizeBytes: new TextEncoder().encode(responseText).length,
            isTruncated
        };

    } catch (error: any) {
        const end = performance.now();
        const isAbort = error.name === 'AbortError' || controller.signal.aborted;
        return {
            status: 0,
            statusText: isAbort ? 'Aborted / Timeout' : 'Client Error',
            headers: {},
            body: isAbort
                ? `Request Cancelled / Timed Out (${timeoutMs}ms limit)`
                : `Request Failed: ${error.message}\n\nCheck browser network & CORS settings.`,
            timeMs: Math.round(end - start)
        };
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

/**
 * Concurrency Limiter for multi-request batches (Multi-Account / Repeater) (§16.4)
 */
export function createLimiter(maxConcurrent: number = 5) {
    let active = 0;
    const queue: (() => void)[] = [];

    return async function limit<T>(fn: () => Promise<T>): Promise<T> {
        if (active >= maxConcurrent) {
            await new Promise<void>((resolve) => queue.push(resolve));
        }
        active++;
        try {
            return await fn();
        } finally {
            active--;
            const next = queue.shift();
            if (next) next();
        }
    };
}
