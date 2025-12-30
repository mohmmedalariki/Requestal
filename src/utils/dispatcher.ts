
/**
 * Parses a raw HTTP request string into components for fetch().
 */
export function parseRawRequest(raw: string): { method: string, url: string, headers: HeadersInit, body: string | null } {
    const lines = raw.split('\n');
    const firstLine = lines[0].trim();
    const parts = firstLine.split(' ');

    if (parts.length < 2) {
        throw new Error("Invalid Request Line");
    }

    const method = parts[0].toUpperCase();
    let url = parts[1];

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

    // Handle body
    let body: string | null = null;
    if (bodyStartPosition > -1 && bodyStartPosition < lines.length) {
        body = lines.slice(bodyStartPosition).join('\n');
    }

    if (['GET', 'HEAD'].includes(method)) {
        body = null;
    }

    return { method, url, headers, body };
}

export interface DispatchResponse {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    timeMs: number;
}

/**
 * Executes a raw HTTP request using the browser's fetch API.
 */
export async function dispatchRequest(rawRequest: string): Promise<DispatchResponse> {
    const start = performance.now();

    try {
        const { method, url, headers, body } = parseRawRequest(rawRequest);
        const headersRecord = headers as Record<string, string>;

        // Ensure URL is absolute
        let finalUrl = url;
        if (!finalUrl.startsWith('http')) {
            // Try to find Host header
            // Case-insensitive lookup
            const hostKey = Object.keys(headersRecord).find(k => k.toLowerCase() === 'host');

            if (hostKey) {
                // **PROTOCOL ENFORCEMENT**: Always default to HTTPS
                // The user explicitly requested to prepend https://
                finalUrl = `https://${headersRecord[hostKey]}${url}`;

                // **HEADER CLEANING**: Remove Host header to avoid browser blocking
                // "Refused to set unsafe header "Host""
                delete headersRecord[hostKey];
            } else {
                // Fallback if no host header (rare in raw reqs)
                throw new Error("Missing Host header for relative URL dispatch");
            }
        }

        const response = await fetch(finalUrl, {
            method,
            headers: headersRecord,
            body,
            credentials: 'include', // **SESSION PERSISTENCE**
            mode: 'cors',
        });

        const end = performance.now();
        const timeMs = Math.round(end - start);

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
            timeMs
        };

    } catch (error: any) {
        const end = performance.now();

        // **ERROR HANDLING**: Capture protocol errors (e.g., TypeError for CORS or Network)
        // Return them as a valid response object so they show up in the UI
        return {
            status: 0,
            statusText: 'Client Error',
            headers: {},
            body: `Request Failed: ${error.message}\n\nCheck console for CORS details or ensure the target supports HTTPS.`,
            timeMs: Math.round(end - start)
        };
    }
}
