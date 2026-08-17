import { db, type RequestBodyRecord } from './db';

export interface RetentionPolicy {
    maxRecords: number;
    maxAgeDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
    maxRecords: 10_000,
    maxAgeDays: 30
};

/**
 * Enforces retention limits by pruning the oldest unpinned requests.
 */
export async function enforceRetention(policy: RetentionPolicy = DEFAULT_RETENTION_POLICY): Promise<number> {
    return await db.transaction('rw', db.requests, db.bodies, async () => {
        const totalCount = await db.requests.count();
        if (totalCount <= policy.maxRecords) {
            return 0;
        }

        const cutoffTime = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
        const excessCount = totalCount - policy.maxRecords;

        // Query oldest unpinned requests
        const candidates = await db.requests
            .filter(r => !r.isPinned && (r.timestamp < cutoffTime || totalCount > policy.maxRecords))
            .limit(excessCount)
            .toArray();

        const idsToDelete = candidates.map(c => c.id!).filter(Boolean);
        if (idsToDelete.length > 0) {
            await db.requests.bulkDelete(idsToDelete);
            await db.bodies.bulkDelete(idsToDelete);
        }

        return idsToDelete.length;
    });
}

/**
 * Exports current session items to a valid HAR 1.2 JSON object.
 */
export async function exportSessionToHar(redactSecrets: boolean = true): Promise<string> {
    const summaries = await db.requests.toArray();
    const bodies = await db.bodies.toArray();
    const bodyMap = new Map<number, RequestBodyRecord>();
    bodies.forEach(b => bodyMap.set(b.id, b));

    const entries = summaries.map(s => {
        const bodyRecord = s.id ? bodyMap.get(s.id) : undefined;
        let rawReq = bodyRecord?.rawRequest || '';
        let rawRes = bodyRecord?.rawResponse || '';

        if (redactSecrets) {
            rawReq = redactSensitiveHeaders(rawReq);
            rawRes = redactSensitiveHeaders(rawRes);
        }

        return {
            startedDateTime: new Date(s.timestamp).toISOString(),
            time: s.durationMs || 50,
            request: {
                method: s.method,
                url: s.url,
                httpVersion: 'HTTP/1.1',
                headers: extractHeadersFromRaw(rawReq),
                queryString: [],
                cookies: [],
                headersSize: -1,
                bodySize: rawReq.length,
                postData: {
                    mimeType: 'text/plain',
                    text: extractBodyFromRaw(rawReq)
                }
            },
            response: {
                status: s.status,
                statusText: s.statusText || 'OK',
                httpVersion: 'HTTP/1.1',
                headers: extractHeadersFromRaw(rawRes),
                cookies: [],
                content: {
                    size: rawRes.length,
                    mimeType: 'text/plain',
                    text: extractBodyFromRaw(rawRes)
                },
                redirectURL: '',
                headersSize: -1,
                bodySize: rawRes.length
            },
            cache: {},
            timings: {
                send: 0,
                wait: s.durationMs || 50,
                receive: 0
            }
        };
    });

    const harArchive = {
        log: {
            version: '1.2',
            creator: {
                name: 'Requestal V2',
                version: '0.2.0'
            },
            entries
        }
    };

    return JSON.stringify(harArchive, null, 2);
}

function extractHeadersFromRaw(raw: string): { name: string; value: string }[] {
    const headers: { name: string; value: string }[] = [];
    const lines = raw.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (line === '') break;
        const colonIdx = line.indexOf(':');
        if (colonIdx > -1) {
            headers.push({
                name: line.slice(0, colonIdx).trim(),
                value: line.slice(colonIdx + 1).trim()
            });
        }
    }
    return headers;
}

function extractBodyFromRaw(raw: string): string {
    const lines = raw.split('\n');
    const blankIdx = lines.findIndex(l => l.replace(/\r$/, '') === '');
    if (blankIdx > -1 && blankIdx < lines.length - 1) {
        return lines.slice(blankIdx + 1).join('\n');
    }
    return '';
}

function redactSensitiveHeaders(raw: string): string {
    return raw.replace(/^(cookie|authorization|x-api-key|x-auth-token):\s*(.*)$/gim, '$1: [REDACTED]');
}
