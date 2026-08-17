import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stringToBase64, base64ToString, uint8ArrayToBase64 } from '../../src/shared/utils/encoding';
import { proEngine } from '../../src/core/capture/proEngine';

describe('Interception Lifecycle & Memory-Safe Encoding', () => {
    describe('Base64 Encoding & Large Payloads', () => {
        it('encodes and decodes standard ASCII strings accurately', () => {
            const original = '{"status":"success","role":"admin"}';
            const encoded = stringToBase64(original);
            const decoded = base64ToString(encoded);
            expect(decoded).toBe(original);
        });

        it('handles multibyte Unicode strings and emojis without corruption', () => {
            const unicodeText = '{"message":"مرحبا بالعالم 🚀 Security Audit 🛡️ - 日本語"}';
            const encoded = stringToBase64(unicodeText);
            const decoded = base64ToString(encoded);
            expect(decoded).toBe(unicodeText);
        });

        it('handles large payloads (>128KB) safely via chunked encoding without stack overflow', () => {
            // Create a 256KB payload
            const largeJson = JSON.stringify({
                data: 'A'.repeat(256 * 1024)
            });
            const encoded = stringToBase64(largeJson);
            const decoded = base64ToString(encoded);
            expect(decoded).toBe(largeJson);
            expect(encoded.length).toBeGreaterThan(0);
        });

        it('uses Uint8Array.prototype.toBase64 when available or falls back gracefully', () => {
            const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
            const b64 = uint8ArrayToBase64(bytes);
            expect(b64).toBe('SGVsbG8=');
        });
    });

    describe('Service Worker Restart & Ghost-Pause Cleanup', () => {
        let mockSessionStorage: Record<string, any> = {};
        let sentCommands: any[] = [];

        beforeEach(() => {
            mockSessionStorage = {};
            sentCommands = [];

            // Mock chrome APIs
            (globalThis as any).chrome = {
                runtime: {
                    lastError: null
                },
                storage: {
                    session: {
                        get: vi.fn((key: string) => {
                            return Promise.resolve({ [key]: mockSessionStorage[key] });
                        }),
                        set: vi.fn((obj: Record<string, any>) => {
                            Object.assign(mockSessionStorage, obj);
                            return Promise.resolve();
                        }),
                        remove: vi.fn((key: string) => {
                            delete mockSessionStorage[key];
                            return Promise.resolve();
                        })
                    }
                },
                debugger: {
                    sendCommand: vi.fn((target: any, method: string, params: any, cb: (res: any) => void) => {
                        sentCommands.push({ target, method, params });
                        cb({ success: true });
                    }),
                    onEvent: { addListener: vi.fn() },
                    onDetach: { addListener: vi.fn() }
                }
            };
        });

        it('releases dangling ghost pauses on SW restart', async () => {
            // Seed session storage with ghost pauses from prior crashed SW lifecycle
            mockSessionStorage['requestal_paused_traffic_map'] = {
                'req-1': { requestId: 'req-1', tabId: 101, isResponse: true, timestamp: Date.now() - 5000 },
                'req-2': { requestId: 'req-2', tabId: 102, isResponse: false, timestamp: Date.now() - 3000 }
            };

            const released = await proEngine.cleanupGhostPauses();

            expect(released).toBe(2);
            expect(sentCommands).toHaveLength(2);

            // Verify response pause was released with continueResponse
            expect(sentCommands[0]).toEqual({
                target: { tabId: 101 },
                method: 'Fetch.continueResponse',
                params: { requestId: 'req-1' }
            });

            // Verify request pause was released with continueRequest
            expect(sentCommands[1]).toEqual({
                target: { tabId: 102 },
                method: 'Fetch.continueRequest',
                params: { requestId: 'req-2' }
            });

            // Verify ghost map is cleared
            expect(mockSessionStorage['requestal_paused_traffic_map']).toBeUndefined();
        });
    });
});
