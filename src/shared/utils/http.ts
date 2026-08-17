export type FidelityType = 'full' | 'partial' | 'reconstructed';

export interface HttpRequest {
    method: string;
    url: string;
    httpVersion: string;
    headers: { name: string; value: string }[];
    body: string;
}

export interface HarRequestObject {
    id?: number;
    requestId?: string;
    fidelity?: FidelityType;
    fidelityNotes?: string[];
    request: {
        method: string;
        url: string;
        httpVersion: string;
        headers: { name: string; value: string }[];
        postData?: {
            text?: string;
            mimeType?: string;
        };
        response?: {
            status: number;
            statusText?: string;
            httpVersion?: string;
            headers?: { name: string; value: string }[];
            body?: string;
        };
    };
    initiator?: any;
    timing?: any;
    timestamp?: number;
    tags?: string[];
}

export const TELEMETRY_HEADERS = [
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-ch-ua-arch',
    'sec-ch-ua-bitness',
    'sec-ch-ua-model',
    'sec-ch-ua-full-version-list',
    'x-client-data',
    'upgrade-insecure-requests',
    'priority'
];

export function parseUrl(urlStr: string) {
    try {
        const url = new URL(urlStr);
        return {
            path: url.pathname + url.search,
            host: url.host,
            cleanUrl: url.origin + url.pathname
        };
    } catch {
        return { path: urlStr, host: '', cleanUrl: urlStr };
    }
}

export function harToRaw(harRequest: any, cleanMode: boolean = false): string {
    if (!harRequest || !harRequest.request) return '';

    const method = harRequest.request.method || 'GET';
    const urlStr = harRequest.request.url || '';
    const { path, host } = parseUrl(urlStr);

    // Normalize version to HTTP/1.1
    const httpVersion = harRequest.request.httpVersion || 'HTTP/1.1';

    let headers: { name: string; value: string }[] = [...(harRequest.request.headers || [])];

    // 1. Strip pseudo-headers (:method, :authority, :path, :scheme)
    headers = headers.filter((h: any) => !h.name.startsWith(':'));

    // 2. Reconstruct Host header if missing
    const hasHost = headers.some((h: any) => h.name.toLowerCase() === 'host');
    if (!hasHost && host) {
        headers = [{ name: 'Host', value: host }, ...headers];
    }

    // 3. Compute Content-Length if body exists and header is missing
    const bodyText = harRequest.request.postData?.text;
    const hasContentLength = headers.some((h: any) => h.name.toLowerCase() === 'content-length');
    if (bodyText !== undefined && bodyText !== null && bodyText.length > 0 && !hasContentLength) {
        const byteLen = new TextEncoder().encode(bodyText).length;
        headers.push({ name: 'Content-Length', value: String(byteLen) });
    }

    if (cleanMode) {
        headers = headers.filter((h: any) => !TELEMETRY_HEADERS.includes(h.name.toLowerCase()));
    }

    // 4. Construct Raw String with standard CRLF line endings
    let raw = `${method} ${path} ${httpVersion}\r\n`;

    headers.forEach((h: any) => {
        raw += `${h.name}: ${h.value}\r\n`;
    });

    raw += '\r\n'; // Mandatory blank line

    if (bodyText) {
        raw += bodyText;
    }

    return raw;
}

/**
 * Serializes a captured HAR response into a standard wire-format HTTP response string.
 */
export function harToResponseRaw(harResponse?: any): string {
    if (!harResponse) return '';

    const status = typeof harResponse.status === 'number' && harResponse.status > 0 ? harResponse.status : 200;
    const statusText = harResponse.statusText || (status === 200 ? 'OK' : status === 404 ? 'Not Found' : status === 500 ? 'Internal Server Error' : 'Response');
    const httpVersion = harResponse.httpVersion || 'HTTP/1.1';

    let raw = `${httpVersion} ${status} ${statusText}\r\n`;

    if (Array.isArray(harResponse.headers)) {
        harResponse.headers.forEach((h: any) => {
            if (h && h.name) {
                raw += `${h.name}: ${h.value || ''}\r\n`;
            }
        });
    } else if (harResponse.headers && typeof harResponse.headers === 'object') {
        Object.entries(harResponse.headers).forEach(([k, v]) => {
            raw += `${k}: ${v}\r\n`;
        });
    }

    raw += '\r\n';

    if (harResponse.body) {
        raw += harResponse.body;
    }

    return raw;
}

export function rawToFfuf(_raw: string, url: string): string {
    return `ffuf -request request.req -mode clusterbomb -w wordlist.txt:FUZZ -u "${url || 'https://target/FUZZ'}"`;
}

export function rawToCurl(raw: string, targetUrl?: string): string {
    if (!raw) return '';
    const lines = raw.split('\n');
    const [methodLine, ...rest] = lines;
    const [method, path] = methodLine.trim().split(' ');

    let body = '';
    const headers: Record<string, string> = {};
    let isBody = false;

    for (const line of rest) {
        if (isBody) {
            body += (body ? '\n' : '') + line;
            continue;
        }
        if (line.trim() === '') {
            isBody = true;
            continue;
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx > -1) {
            const k = line.slice(0, colonIdx).trim();
            const v = line.slice(colonIdx + 1).trim();
            headers[k] = v;
        }
    }

    const host = Object.entries(headers).find(([k]) => k.toLowerCase() === 'host')?.[1];
    const fullUrl = targetUrl || (host ? `https://${host}${path}` : path);

    let curl = `curl -X ${method || 'GET'} '${fullUrl}'`;
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'host') continue;
        curl += ` \\\n  -H '${k}: ${v.replace(/'/g, "'\\''")}'`;
    }
    if (body && !['GET', 'HEAD'].includes((method || '').toUpperCase())) {
        curl += ` \\\n  --data-raw '${body.replace(/'/g, "'\\''")}'`;
    }

    return curl;
}
