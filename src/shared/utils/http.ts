
export interface HttpRequest {
    method: string;
    url: string;
    httpVersion: string;
    headers: { name: string; value: string }[];
    body: string;
}

export const TELEMETRY_HEADERS = [
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
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
    } catch (e) {
        return { path: urlStr, host: '', cleanUrl: urlStr };
    }
}

export function harToRaw(harRequest: any, cleanMode: boolean = false): string {
    const method = harRequest.request.method;
    const urlStr = harRequest.request.url;
    const { path, host } = parseUrl(urlStr);

    // Normalize version to HTTP/1.1
    const httpVersion = 'HTTP/1.1';

    let headers = harRequest.request.headers || [];

    // 1. Strip pseudo-headers
    headers = headers.filter((h: any) => !h.name.startsWith(':'));

    // 2. Reconstruct Host header if missing (common in HTTP/2 -> 1.1 conversion)
    const hasHost = headers.some((h: any) => h.name.toLowerCase() === 'host');
    if (!hasHost && host) {
        // Javascript arrays are immutable in this context if coming from prop/state, safest to spread
        headers = [{ name: 'Host', value: host }, ...headers];
    }

    if (cleanMode) {
        headers = headers.filter((h: any) => !TELEMETRY_HEADERS.includes(h.name.toLowerCase()));
    }

    // 3. Construct Raw String with standard CRLF line endings
    let raw = `${method} ${path} ${httpVersion}\r\n`;

    headers.forEach((h: any) => {
        raw += `${h.name}: ${h.value}\r\n`;
    });

    raw += '\r\n'; // Mandatory blank line

    if (harRequest.request.postData && harRequest.request.postData.text) {
        raw += harRequest.request.postData.text;
    }

    return raw;
}


export function rawToFfuf(_raw: string, _url: string): string {
    return `ffuf -request request.req -mode clusterbomb -w wordliist.txt:FUZZ`;
}
