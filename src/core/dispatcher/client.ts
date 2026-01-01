
/**
 * Request Dispatcher
 * Handles parsing raw HTTP strings and executing them via the Fetch API.
 */

interface ParsedRequest {
    method: string;
    url: string;
    headers: HeadersInit;
    body: string | null;
}

export interface DispatchResponse {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    timeMs: number;
}

/**
 * Parses a raw HTTP request string into components suitable for fetch().
 * Handles Request Line, Headers, and Body separation.
 */
export function parseRawRequest(raw: string): ParsedRequest {
    const lines = raw.split('\n');
    const [method, url] = lines[0].trim().split(' ');

    if (!method || !url) {
        throw new Error("Invalid Request Line: Missing method or URL");
    }

    const headers: Record<string, string> = {};
    let bodyStartPosition = -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
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
 * Executes a raw HTTP request.
 * Enforces HTTPS for relative URLs if Host header is present.
 */
export async function dispatchRequest(rawRequest: string): Promise<DispatchResponse> {
    const start = performance.now();

    try {
        const { method, url, headers, body } = parseRawRequest(rawRequest);
        const headersRecord = headers as Record<string, string>;

        let finalUrl = url;

        // Protocol enforcement & absolute URL construction
        if (!finalUrl.startsWith('http')) {
            const hostKey = Object.keys(headersRecord).find(k => k.toLowerCase() === 'host');
            if (hostKey) {
                finalUrl = `https://${headersRecord[hostKey]}${url}`;
                delete headersRecord[hostKey]; // Prevent "Unsafe Header" error
            } else {
                throw new Error("Missing Host header for relative URL dispatch");
            }
        }

        const response = await fetch(finalUrl, {
            method,
            headers: headersRecord,
            body,
            credentials: 'include',
            mode: 'cors',
        });

        const end = performance.now();
        const responseText = await response.text();
        const responseHeaders: Record<string, string> = {};

        response.headers.forEach((val, key) => {
            responseHeaders[key] = val;
        });

        return {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: responseText,
            timeMs: Math.round(end - start)
        };

    } catch (error: any) {
        const end = performance.now();
        return {
            status: 0,
            statusText: 'Client Error',
            headers: {},
            body: `Request Failed: ${error.message}\n\nCheck console for details.`,
            timeMs: Math.round(end - start)
        };
    }
}
