
/**
 * Smart Diff Engine
 * Reduces noise in diffs by masking volatile fields like timestamps.
 */

const REGEX_ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g;
const REGEX_UNIX_TIMESTAMP = /(["']?time(stamp)?["']?\s*[:=]\s*)(\d{10,13})/gi;
const IGNORED_HEADERS = new Set(['if-none-match', 'etag']);

export function smartDiff(text: string): string {
    return text.split('\n').map(line => {
        let processed = line;

        // Mask timestamps
        processed = processed.replace(REGEX_ISO_DATE, '<TIMESTAMP>');
        processed = processed.replace(REGEX_UNIX_TIMESTAMP, '$1<TIMESTAMP>');

        // Mask volatile headers
        // Simple distinct logic for headers (assumed to be at start of line)
        const colonIndex = processed.indexOf(':');
        if (colonIndex > -1) {
            const key = processed.substring(0, colonIndex).trim().toLowerCase();
            if (IGNORED_HEADERS.has(key)) {
                return `${processed.substring(0, colonIndex)}: <IGNORED>`;
            }
        }

        return processed;
    }).join('\n');
}
