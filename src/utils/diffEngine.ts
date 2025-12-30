
export function smartDiff(text: string): string {
    // Split into lines to process each line individually
    const lines = text.split('\n');

    return lines.map(line => {
        let processed = line;

        // 1. Mask Timestamps (e.g., 2024-01-01T12:00:00, or unix timestamps)
        // Simple regex for ISO-like dates
        processed = processed.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TIMESTAMP>');

        // Mask potential unix timestamps (10-13 digits) if they look like values
        // Be careful not to mask basic numbers. 
        // Heuristic: usually assigned to a key like "time": 170... or timestamp=170...
        processed = processed.replace(/(["']?time(stamp)?["']?\s*[:=]\s*)(\d{10,13})/gi, '$1<TIMESTAMP>');

        // 2. Mask Non-Functional/noisy headers
        // E.g., if-none-match, etag can change frequently
        if (processed.toLowerCase().startsWith('if-none-match:') || processed.toLowerCase().startsWith('etag:')) {
            return `${processed.split(':')[0]}: <IGNORED>`;
        }

        // 3. Mask cookies that look like session IDs or tracking IDs if they change excessively?
        // For now, let's stick to timestamps as requested specifically.

        return processed;
    }).join('\n');
}
