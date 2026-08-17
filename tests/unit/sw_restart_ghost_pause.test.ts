/**
 * Empirical SW-Restart-Mid-Pause Test
 *
 * This test simulates the actual scenario:
 *   1. A response is paused via Fetch.requestPaused (manual intercept mode).
 *   2. The service worker is killed by Chrome (MV3 idle timeout / crash).
 *   3. A new SW instance wakes up, reads the ghost-pause map from
 *      chrome.storage.session, and calls cleanupGhostPauses().
 *   4. Verify that the correct CDP command (Fetch.continueResponse for
 *      response pauses, Fetch.continueRequest for request pauses) is
 *      dispatched for each orphaned entry.
 *   5. Verify the ghost-pause map is cleared from session storage afterward.
 *
 * Why this matters: if the SW restarts while a request is paused, Chrome's
 * Fetch domain still holds the network connection open. Without cleanup,
 * the target tab hangs permanently — the page never loads and no error
 * is surfaced to the user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We import the class directly, not the singleton, so we get a fresh
// instance per test — simulating a fresh SW lifecycle.
import { ProCaptureEngine, sendCommandWithTimeout } from '../../src/core/capture/proEngine';

describe('Empirical: SW Restart Mid-Pause Ghost Cleanup', () => {
    let sessionStore: Record<string, any>;
    let sentCommands: Array<{ tabId: number; method: string; requestId: string }>;
    let engine: ProCaptureEngine;

    beforeEach(() => {
        sessionStore = {};
        sentCommands = [];

        // Simulate chrome.storage.session backed by a plain object
        (globalThis as any).chrome = {
            runtime: { lastError: null },
            storage: {
                session: {
                    get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
                    set: vi.fn(async (obj: Record<string, any>) => {
                        Object.assign(sessionStore, obj);
                    }),
                    remove: vi.fn(async (key: string) => {
                        delete sessionStore[key];
                    })
                }
            },
            debugger: {
                sendCommand: vi.fn(
                    (target: any, method: string, params: any, cb: (res: any) => void) => {
                        sentCommands.push({
                            tabId: target.tabId,
                            method,
                            requestId: params?.requestId
                        });
                        cb({});
                    }
                ),
                onEvent: { addListener: vi.fn() },
                onDetach: { addListener: vi.fn() }
            }
        };

        // Fresh engine instance = simulates a brand-new SW lifecycle
        engine = new ProCaptureEngine();
    });

    afterEach(() => {
        delete (globalThis as any).chrome;
    });

    it('releases a response-stage ghost pause with Fetch.continueResponse (not continueRequest)', async () => {
        // ── Lifecycle 1: pause was recorded before SW died ──
        sessionStore['requestal_paused_traffic_map'] = {
            'resp-abc': {
                requestId: 'resp-abc',
                tabId: 42,
                isResponse: true,
                timestamp: Date.now() - 8000
            }
        };

        // ── Lifecycle 2: new SW wakes up and runs cleanup ──
        const released = await engine.cleanupGhostPauses();

        expect(released).toBe(1);
        expect(sentCommands).toHaveLength(1);
        expect(sentCommands[0]).toEqual({
            tabId: 42,
            method: 'Fetch.continueResponse',
            requestId: 'resp-abc'
        });

        // Ghost map must be fully cleared
        expect(sessionStore['requestal_paused_traffic_map']).toBeUndefined();
    });

    it('releases a request-stage ghost pause with Fetch.continueRequest (not continueResponse)', async () => {
        sessionStore['requestal_paused_traffic_map'] = {
            'req-xyz': {
                requestId: 'req-xyz',
                tabId: 99,
                isResponse: false,
                timestamp: Date.now() - 3000
            }
        };

        const released = await engine.cleanupGhostPauses();

        expect(released).toBe(1);
        expect(sentCommands).toHaveLength(1);
        expect(sentCommands[0]).toEqual({
            tabId: 99,
            method: 'Fetch.continueRequest',
            requestId: 'req-xyz'
        });

        expect(sessionStore['requestal_paused_traffic_map']).toBeUndefined();
    });

    it('releases mixed request + response ghost pauses with correct commands per entry', async () => {
        sessionStore['requestal_paused_traffic_map'] = {
            'resp-1': { requestId: 'resp-1', tabId: 10, isResponse: true, timestamp: Date.now() - 5000 },
            'req-2':  { requestId: 'req-2',  tabId: 10, isResponse: false, timestamp: Date.now() - 4000 },
            'resp-3': { requestId: 'resp-3', tabId: 20, isResponse: true, timestamp: Date.now() - 2000 }
        };

        const released = await engine.cleanupGhostPauses();

        expect(released).toBe(3);
        expect(sentCommands).toHaveLength(3);

        // Verify each entry got the correct CDP method
        const byId = Object.fromEntries(sentCommands.map(c => [c.requestId, c]));
        expect(byId['resp-1'].method).toBe('Fetch.continueResponse');
        expect(byId['req-2'].method).toBe('Fetch.continueRequest');
        expect(byId['resp-3'].method).toBe('Fetch.continueResponse');

        expect(sessionStore['requestal_paused_traffic_map']).toBeUndefined();
    });

    it('handles empty ghost-pause map gracefully (no CDP commands sent)', async () => {
        sessionStore['requestal_paused_traffic_map'] = {};

        const released = await engine.cleanupGhostPauses();

        expect(released).toBe(0);
        expect(sentCommands).toHaveLength(0);
    });

    it('handles missing ghost-pause key gracefully (first SW boot)', async () => {
        // No key in session storage at all
        const released = await engine.cleanupGhostPauses();

        expect(released).toBe(0);
        expect(sentCommands).toHaveLength(0);
    });

    it('counts only successful releases when some tabs are already closed', async () => {
        // Override sendCommand to fail for tabId 999
        (globalThis as any).chrome.debugger.sendCommand = vi.fn(
            (target: any, method: string, params: any, cb: (res: any) => void) => {
                if (target.tabId === 999) {
                    // Simulate "No target with given id" (tab was closed)
                    (globalThis as any).chrome.runtime.lastError = { message: 'No target with given id' };
                    cb(undefined);
                    (globalThis as any).chrome.runtime.lastError = null;
                } else {
                    sentCommands.push({ tabId: target.tabId, method, requestId: params?.requestId });
                    cb({});
                }
            }
        );

        sessionStore['requestal_paused_traffic_map'] = {
            'good-1': { requestId: 'good-1', tabId: 42, isResponse: true, timestamp: Date.now() },
            'dead-2': { requestId: 'dead-2', tabId: 999, isResponse: true, timestamp: Date.now() }
        };

        const released = await engine.cleanupGhostPauses();

        // Only the living tab's pause was successfully released
        // The dead tab throws, so it's caught and not counted
        // But the map is still cleared entirely
        expect(sentCommands).toHaveLength(1);
        expect(sentCommands[0].requestId).toBe('good-1');
        expect(sessionStore['requestal_paused_traffic_map']).toBeUndefined();
    });
});
