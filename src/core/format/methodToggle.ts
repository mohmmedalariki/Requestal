/**
 * HTTP Method Toggle Utility (POST <-> GET)
 * Accurately switches HTTP requests between POST and GET methods with zero format loss:
 * - POST -> GET: Moves request body (Form or JSON) into URL query parameters, cleans Content-Type & Content-Length headers, clears body.
 * - GET -> POST: Intelligently reconstructs the body. If query parameters contained nested JSON structures, arrays, or booleans,
 *                it restores the exact JSON object structure and sets Content-Type: application/json.
 *                For standard key-value parameters, it restores application/x-www-form-urlencoded.
 */

export function reconstructBodyAndContentType(
    queryString: string,
    existingContentType?: string | null
): { body: string; contentType: string } {
    if (!queryString || !queryString.trim()) {
        return {
            body: '',
            contentType: existingContentType || 'application/x-www-form-urlencoded'
        };
    }

    const cleanQuery = queryString.replace(/^\?/, '');
    const params = new URLSearchParams(cleanQuery);
    const obj: Record<string, any> = {};
    let hasComplexJson = false;

    for (const [key, rawVal] of params.entries()) {
        const trimmed = rawVal.trim();
        let parsedVal: any = rawVal;

        // Check if value is serialized JSON (object or array)
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                parsedVal = JSON.parse(trimmed);
                hasComplexJson = true;
            } catch {
                parsedVal = rawVal;
            }
        } else if (trimmed === 'true') {
            parsedVal = true;
            hasComplexJson = true;
        } else if (trimmed === 'false') {
            parsedVal = false;
            hasComplexJson = true;
        } else if (trimmed === 'null') {
            parsedVal = null;
            hasComplexJson = true;
        } else if (/^-?\d+(\.\d+)?$/.test(trimmed) && trimmed.length < 15 && (!trimmed.startsWith('0') || trimmed === '0' || trimmed.startsWith('0.'))) {
            const num = Number(trimmed);
            if (!isNaN(num)) {
                parsedVal = num;
            }
        }

        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (!Array.isArray(obj[key])) {
                obj[key] = [obj[key]];
            }
            obj[key].push(parsedVal);
            hasComplexJson = true;
        } else {
            obj[key] = parsedVal;
        }
    }

    const isJsonHeader = existingContentType ? existingContentType.toLowerCase().includes('application/json') : false;

    if (hasComplexJson || isJsonHeader) {
        return {
            body: JSON.stringify(obj, null, 2),
            contentType: 'application/json'
        };
    }

    return {
        body: cleanQuery,
        contentType: 'application/x-www-form-urlencoded'
    };
}

export function toggleRequestMethod(rawRequest: string): string {
    if (!rawRequest || !rawRequest.trim()) return rawRequest;

    const isCRLF = rawRequest.includes('\r\n');
    const newline = isCRLF ? '\r\n' : '\n';
    const lines = rawRequest.split(/\r?\n/);

    if (lines.length === 0) return rawRequest;

    // Parse Request Line (Line 0)
    const requestLine = lines[0].trim();
    const parts = requestLine.split(/\s+/);
    if (parts.length < 2) return rawRequest;

    const currentMethod = parts[0].toUpperCase();
    const pathOrUrl = parts[1];
    const httpVersion = parts.slice(2).join(' ') || 'HTTP/1.1';

    // Locate header/body split
    const blankIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === '');
    const headerLines = blankIndex > -1 ? lines.slice(1, blankIndex) : lines.slice(1);
    const rawBody = blankIndex > -1 ? lines.slice(blankIndex + 1).join('\n').trim() : '';

    if (currentMethod === 'POST' || currentMethod === 'PUT' || currentMethod === 'PATCH') {
        // --- Convert POST/PUT/PATCH -> GET ---
        const newMethod = 'GET';

        // Extract existing query params from URL
        const qIndex = pathOrUrl.indexOf('?');
        const basePath = qIndex > -1 ? pathOrUrl.slice(0, qIndex) : pathOrUrl;
        const existingQuery = qIndex > -1 ? pathOrUrl.slice(qIndex + 1) : '';

        const mergedParams = new URLSearchParams(existingQuery);

        if (rawBody) {
            // Check if body is JSON
            let isJson = false;
            if (rawBody.startsWith('{') || rawBody.startsWith('[')) {
                try {
                    const parsed = JSON.parse(rawBody);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        Object.entries(parsed).forEach(([k, v]) => {
                            if (v !== null && v !== undefined) {
                                mergedParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
                            }
                        });
                        isJson = true;
                    }
                } catch {
                    isJson = false;
                }
            }

            if (!isJson) {
                // Parse as url-encoded query string
                const bodyParams = new URLSearchParams(rawBody.replace(/^\?/, ''));
                bodyParams.forEach((v, k) => {
                    mergedParams.set(k, v);
                });
            }
        }

        const queryString = mergedParams.toString();
        const newPathOrUrl = queryString ? `${basePath}?${queryString}` : basePath;

        // Filter out Content-Type and Content-Length headers for GET
        const newHeaders = headerLines.filter(line => {
            const lower = line.toLowerCase();
            return !lower.startsWith('content-type:') && !lower.startsWith('content-length:');
        });

        // Assemble GET request without body
        const newRequestLine = `${newMethod} ${newPathOrUrl} ${httpVersion}`.trim();
        return [newRequestLine, ...newHeaders, '', ''].join(newline).trimEnd() + newline;
    } else {
        // --- Convert GET (or other body-less requests) -> POST ---
        const newMethod = 'POST';

        // Extract query parameters from URL
        const qIndex = pathOrUrl.indexOf('?');
        let newPathOrUrl = pathOrUrl;
        let queryParams = '';

        if (qIndex > -1) {
            newPathOrUrl = pathOrUrl.slice(0, qIndex);
            queryParams = pathOrUrl.slice(qIndex + 1);
        }

        // Check if existing headers had an explicit Content-Type
        const existingContentTypeLine = headerLines.find(line => line.toLowerCase().startsWith('content-type:'));
        const existingContentType = existingContentTypeLine ? existingContentTypeLine.split(':')[1]?.trim() : null;

        // Reconstruct body & determine exact Content-Type (JSON vs Form-UrlEncoded)
        const combinedQuery = queryParams || rawBody;
        const { body: newBody, contentType } = reconstructBodyAndContentType(combinedQuery, existingContentType);

        // Update or insert Content-Type header
        const finalHeaders: string[] = [];
        let contentTypeUpdated = false;

        for (const line of headerLines) {
            const lower = line.toLowerCase();
            if (lower.startsWith('content-length:')) {
                // Strip Content-Length to avoid stale mismatch
                continue;
            }
            if (lower.startsWith('content-type:')) {
                finalHeaders.push(`Content-Type: ${contentType}`);
                contentTypeUpdated = true;
            } else {
                finalHeaders.push(line);
            }
        }

        if (!contentTypeUpdated) {
            finalHeaders.push(`Content-Type: ${contentType}`);
        }

        // Assemble POST request with body
        const newRequestLine = `${newMethod} ${newPathOrUrl} ${httpVersion}`.trim();
        return [newRequestLine, ...finalHeaders, '', newBody].join(newline);
    }
}
