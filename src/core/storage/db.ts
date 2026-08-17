import Dexie, { type Table } from 'dexie';
import type { FidelityType } from '../../shared/utils/http';

export interface RequestSummary {
    id?: number;
    requestId: string;
    tabId?: number;
    host: string;
    method: string;
    url: string;
    status: number;
    statusText?: string;
    timestamp: number;
    fidelity: FidelityType;
    fidelityNotes?: string[];
    tags: string[];
    scopeMatched?: boolean;
    sizeBytes?: number;
    durationMs?: number;
    isPinned?: boolean;
    initiator?: any;
}

export interface RequestBodyRecord {
    id: number; // Matches RequestSummary.id
    rawRequest: string;
    rawResponse?: string;
}

export class RequestalDatabase extends Dexie {
    requests!: Table<RequestSummary, number>;
    bodies!: Table<RequestBodyRecord, number>;

    constructor() {
        super('requestal_v2');

        // §17.4 — Versioned schema with upgrade scaffolding from day one.
        // Version 1: Initial split summary + bodies schema
        this.version(1).stores({
            requests: '++id, requestId, host, timestamp, status, method, isPinned',
            bodies: 'id'
        });

        // Version 2: Add compound index for host+timestamp queries and multi-entry tags index
        this.version(2).stores({
            requests: '++id, requestId, host, timestamp, status, method, [host+timestamp], *tags, isPinned',
            bodies: 'id'
        }).upgrade(async (tx) => {
            // Ensure all existing records have a tags array
            await tx.table('requests').toCollection().modify((r: any) => {
                if (!r.tags) r.tags = [];
                if (r.scopeMatched === undefined) r.scopeMatched = true;
            });
        });
    }
}

export const db = new RequestalDatabase();

/**
 * Persists a captured request and its raw payload into Dexie (upsert).
 */
export async function persistCapturedRequest(
    summary: Omit<RequestSummary, 'id'>,
    rawRequest: string,
    rawResponse?: string
): Promise<number> {
    return await db.transaction('rw', db.requests, db.bodies, async () => {
        // Always insert each captured request/hop as a new distinct transaction
        const targetId = await db.requests.add(summary as RequestSummary);

        await db.bodies.put({
            id: targetId,
            rawRequest,
            rawResponse
        });

        return targetId;
    });
}

/**
 * Retrieves full raw request and response on demand for a selected row.
 */
export async function getRequestBody(id: number): Promise<RequestBodyRecord | undefined> {
    return await db.bodies.get(id);
}

/**
 * Updates pin status for a request summary.
 */
export async function togglePinRequest(id: number, isPinned: boolean): Promise<void> {
    await db.requests.update(id, { isPinned });
}

/**
 * Clears all unpinned requests.
 */
export async function clearUnpinnedRequests(): Promise<void> {
    await db.transaction('rw', db.requests, db.bodies, async () => {
        const unpinnedIds = await db.requests
            .filter(r => !r.isPinned)
            .primaryKeys();

        await db.requests.bulkDelete(unpinnedIds);
        await db.bodies.bulkDelete(unpinnedIds);
    });
}
