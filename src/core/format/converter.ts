
/**
 * Body Format Converter
 * Handles conversion between JSON and Form-UrlEncoded formats, and format detection.
 */

/**
 * Converts a JSON object/string into application/x-www-form-urlencoded format.
 */
export function jsonToForm(jsonInput: string | object): string {
    let obj: any;

    if (typeof jsonInput === 'string') {
        try {
            obj = JSON.parse(jsonInput);
        } catch (e) {
            return jsonInput;
        }
    } else {
        obj = jsonInput;
    }

    if (!obj || typeof obj !== 'object') return typeof jsonInput === 'string' ? jsonInput : '';

    const params = new URLSearchParams();

    const append = (key: string, value: any) => {
        if (Array.isArray(value)) {
            value.forEach(v => append(key, v));
        } else if (typeof value === 'object' && value !== null) {
            params.append(key, JSON.stringify(value));
        } else {
            params.append(key, String(value));
        }
    };

    Object.keys(obj).forEach(key => append(key, obj[key]));

    return params.toString();
}

/**
 * Converts an application/x-www-form-urlencoded string to a pretty-printed JSON string.
 */
export function formToJson(formString: string): string {
    const params = new URLSearchParams(formString);
    const obj: any = {};

    for (const [key, value] of params.entries()) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (!Array.isArray(obj[key])) {
                obj[key] = [obj[key]];
            }
            obj[key].push(value);
        } else {
            obj[key] = value;
        }
    }

    return JSON.stringify(obj, null, 2);
}

/**
 * Heuristically detects the format of the body content.
 */
export function detectFormat(content: string): 'json' | 'form' | 'unknown' {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            JSON.parse(trimmed);
            return 'json';
        } catch {
            // Likely intended as JSON despite parse error
            return 'json';
        }
    }

    if (trimmed.includes('=') && !trimmed.includes('{')) {
        return 'form';
    }
    return 'unknown';
}

/**
 * Serializes the body based on the Content-Type header.
 */
export function serializeBody(body: any, contentType: string = ''): string {
    const isForm = contentType.toLowerCase().includes('application/x-www-form-urlencoded');
    const isJson = contentType.toLowerCase().includes('application/json');

    if (isForm) {
        if (typeof body === 'string') return body;
        return jsonToForm(body);
    }

    if (isJson) {
        if (typeof body === 'string') {
            try {
                const parsed = JSON.parse(body);
                return JSON.stringify(parsed, null, 2);
            } catch {
                return body;
            }
        }
        return JSON.stringify(body, null, 2);
    }

    if (typeof body === 'object') return JSON.stringify(body);
    return String(body);
}
