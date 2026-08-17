/**
 * Smart Diff Engine (V2)
 * Reduces noise in diffs by masking volatile fields:
 * - ISO & Unix Timestamps
 * - Volatile / Cache Headers (ETag, If-None-Match, Date, Age, Last-Modified)
 * - JWT dynamic claims (signature, iat, exp)
 * - Custom user regex mask rules
 */

const REGEX_ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g;
const REGEX_UNIX_TIMESTAMP = /(["']?time(stamp)?["']?\s*[:=]\s*)(\d{10,13})/gi;
const REGEX_JWT = /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g;

const IGNORED_HEADERS = new Set([
    'if-none-match',
    'etag',
    'date',
    'age',
    'last-modified',
    'x-request-id',
    'cf-ray',
    'server-timing'
]);

export interface MaskRule {
    pattern: string;
    replacement: string;
}

export function maskJwtTokens(text: string): string {
    return text.replace(REGEX_JWT, (jwt) => {
        try {
            const parts = jwt.split('.');
            if (parts.length === 3) {
                const headerStr = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
                const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
                const payloadObj = JSON.parse(payloadStr);

                if (payloadObj.iat) payloadObj.iat = '<TIMESTAMP>';
                if (payloadObj.exp) payloadObj.exp = '<TIMESTAMP>';
                if (payloadObj.nbf) payloadObj.nbf = '<TIMESTAMP>';

                return `JWT(${headerStr.trim()}.${JSON.stringify(payloadObj)}.<SIG_MASKED>)`;
            }
        } catch {
            // Fallthrough to standard mask
        }
        return `JWT(<MASKED>)`;
    });
}

export function smartDiff(text: string, customRules: MaskRule[] = []): string {
    if (!text) return '';

    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    const maskedLines = lines.map(line => {
        let processed = line;

        // 1. Mask timestamps
        processed = processed.replace(REGEX_ISO_DATE, '<TIMESTAMP>');
        processed = processed.replace(REGEX_UNIX_TIMESTAMP, '$1<TIMESTAMP>');

        // 2. Mask JWT dynamic segments
        if (processed.includes('eyJ')) {
            processed = maskJwtTokens(processed);
        }

        // 3. Mask volatile HTTP headers
        const colonIndex = processed.indexOf(':');
        if (colonIndex > -1) {
            const key = processed.substring(0, colonIndex).trim().toLowerCase();
            if (IGNORED_HEADERS.has(key)) {
                return `${processed.substring(0, colonIndex)}: <IGNORED>`;
            }
        }

        // 4. Apply custom rules
        for (const rule of customRules) {
            try {
                const reg = new RegExp(rule.pattern, 'g');
                processed = processed.replace(reg, rule.replacement);
            } catch {
                // Ignore invalid regex
            }
        }

        return processed;
    });

    return maskedLines.join('\n');
}
