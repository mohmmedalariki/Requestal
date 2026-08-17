import { describe, it, expect } from 'vitest';
import { parseRawRequest, createLimiter } from '../../src/core/dispatcher/client';

describe('Dispatcher & Concurrency Limiter', () => {
    it('parses raw HTTP requests into method, url, headers, and body', () => {
        const raw = 'POST /api/v1/auth/login HTTP/1.1\r\nHost: target.com\r\nContent-Type: application/json\r\n\r\n{"user":"admin"}';
        const parsed = parseRawRequest(raw);

        expect(parsed.method).toBe('POST');
        expect(parsed.url).toBe('/api/v1/auth/login');
        expect(parsed.headers['Host']).toBe('target.com');
        expect(parsed.headers['Content-Type']).toBe('application/json');
        expect(parsed.body).toBe('{"user":"admin"}');
    });

    it('clears body for GET and HEAD requests', () => {
        const raw = 'GET /api/v1/users HTTP/1.1\r\nHost: target.com\r\n\r\nignored_body';
        const parsed = parseRawRequest(raw);

        expect(parsed.method).toBe('GET');
        expect(parsed.body).toBeNull();
    });

    it('limits concurrent tasks with createLimiter', async () => {
        const limiter = createLimiter(2); // Max 2 concurrent
        let running = 0;
        let peak = 0;

        const task = async () => {
            return limiter(async () => {
                running++;
                peak = Math.max(peak, running);
                await new Promise(r => setTimeout(r, 20));
                running--;
            });
        };

        await Promise.all([task(), task(), task(), task(), task()]);
        expect(peak).toBeLessThanOrEqual(2);
    });
});
