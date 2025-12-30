
/**
 * Converts a JSON object/string into application/x-www-form-urlencoded format.
 * Handles arrays by repeating keys (e.g., {a: [1, 2]} -> a=1&a=2).
 */
export function jsonToForm(jsonInput: string | object): string {
    let obj: any;
    if (typeof jsonInput === 'string') {
        try {
            obj = JSON.parse(jsonInput);
        } catch (e) {
            return jsonInput; // Return original if parsing fails
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
            // Flatten nested objects? For standard form-urlencoded, often just stringified or dot notation
            // But for fuzzing, usually flat or bracket notation is expected. 
            // Let's stick to simple value -> string for now, or JSON stringify if complex
            params.append(key, JSON.stringify(value));
        } else {
            params.append(key, String(value));
        }
    };

    Object.keys(obj).forEach(key => {
        append(key, obj[key]);
    });

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
 * Detects the format of the body content
 */
export function detectFormat(content: string): 'json' | 'form' | 'unknown' {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            JSON.parse(trimmed);
            return 'json';
        } catch {
            // Starts with JSON-like char but invalid invalid, still likely intended as JSON
            return 'json';
        }
    }
    // Simple heuristic for form: contains = and doesn't look like JSON
    if (trimmed.includes('=') && !trimmed.includes('{')) {
        return 'form';
    }
    return 'unknown';
}

/**
 * Strict serializer that respects Content-Type.
 * - Form: Flattens to key=value (no JSON chars allowed).
 * - JSON: Pretty prints.
 */
export function serializeBody(body: any, contentType: string = ''): string {
    const isForm = contentType.toLowerCase().includes('application/x-www-form-urlencoded');
    const isJson = contentType.toLowerCase().includes('application/json');

    if (isForm) {
        // Strict Form Serialization
        // If body is already a string, just returned it (assuming it's formatted)
        // If it's an object, we use jsonToForm
        if (typeof body === 'string') return body; // fallback
        return jsonToForm(body);
    }

    if (isJson) {
        // Pretty Print JSON
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

    // Default/Unknown
    if (typeof body === 'object') return JSON.stringify(body);
    return String(body);
}
