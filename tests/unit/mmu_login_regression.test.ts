import { describe, it, expect } from 'vitest';
import { extractBody, webRequestToHar } from '../../src/core/format/harAdapter';
import { harToRaw } from '../../src/shared/utils/http';

describe('MMU Login Regression Fixture (Wire Parameter Order & Category A Headers)', () => {
    it('preserves exact wire parameter order from raw bytes (does not sort alphabetically)', () => {
        // Original wire order from MMU login:
        // lcsrf_token, timezoneOffset, ptmode, ptlangcd, ptinstalledlang, userid, pwd
        const rawFormString = 'lcsrf_token=abc123token&timezoneOffset=0&ptmode=fuzz&ptlangcd=ENG&ptinstalledlang=ENG&userid=admin&pwd=secretpassword';
        const encoder = new TextEncoder();
        const rawBytes = encoder.encode(rawFormString);

        const mockRequestBody = {
            raw: [{ bytes: rawBytes.buffer }],
            // formData is alphabetically sorted or arbitrary dictionary
            formData: {
                lcsrf_token: ['abc123token'],
                ptinstalledlang: ['ENG'],
                ptlangcd: ['ENG'],
                ptmode: ['fuzz'],
                pwd: ['secretpassword'],
                timezoneOffset: ['0'],
                userid: ['admin']
            }
        };

        const result = extractBody(mockRequestBody);

        expect(result.text).toBe(rawFormString);
        expect(result.fidelity).toBe('partial');
        expect(result.reconstructed).toBe(false);

        // Verify order of keys in extracted string
        const paramKeys = (result.text || '').split('&').map(pair => pair.split('=')[0]);
        expect(paramKeys).toEqual([
            'lcsrf_token',
            'timezoneOffset',
            'ptmode',
            'ptlangcd',
            'ptinstalledlang',
            'userid',
            'pwd'
        ]);
    });

    it('extracts Category A headers (Cookie, Referer, Origin, Accept-*) and computes Content-Length', () => {
        const rawBody = 'userid=admin&pwd=secret';
        const rawBytes = new TextEncoder().encode(rawBody);

        const mockDetails: any = {
            requestId: '12345',
            method: 'POST',
            url: 'https://mmu.target.com/login',
            requestHeaders: [
                { name: 'Host', value: 'mmu.target.com' },
                { name: 'Origin', value: 'https://mmu.target.com' },
                { name: 'Referer', value: 'https://mmu.target.com/login.html' },
                { name: 'Cookie', value: 'session_id=s3cr3t_c00k13; auth=true' },
                { name: 'Accept-Language', value: 'en-US,en;q=0.9' },
                { name: 'Accept-Encoding', value: 'gzip, deflate, br' },
                { name: 'Content-Type', value: 'application/x-www-form-urlencoded' }
            ]
        };

        const mockBodyData = {
            requestBody: {
                raw: [{ bytes: rawBytes.buffer }]
            }
        };

        const har = webRequestToHar(mockDetails, mockBodyData);

        expect(har.request.headers.some(h => h.name === 'Cookie' && h.value.includes('session_id'))).toBe(true);
        expect(har.request.headers.some(h => h.name === 'Origin' && h.value === 'https://mmu.target.com')).toBe(true);
        expect(har.request.headers.some(h => h.name === 'Referer')).toBe(true);
        expect(har.request.headers.some(h => h.name === 'Accept-Language')).toBe(true);

        // Content-Length computed from raw body byte length
        const clHeader = har.request.headers.find(h => h.name === 'Content-Length');
        expect(clHeader).toBeDefined();
        expect(clHeader?.value).toBe(String(rawBytes.length));

        // Format to Raw HTTP string
        const rawHttp = harToRaw(har);
        expect(rawHttp).toContain('POST /login HTTP/1.1');
        expect(rawHttp).toContain('Cookie: session_id=s3cr3t_c00k13; auth=true');
        expect(rawHttp).toContain('Content-Length: ' + rawBytes.length);
        expect(rawHttp.endsWith('userid=admin&pwd=secret')).toBe(true);
    });

    it('flags reconstructed fidelity when only formData fallback is available', () => {
        const mockRequestBody = {
            formData: {
                id: ['100'],
                action: ['test']
            }
        };

        const result = extractBody(mockRequestBody);
        expect(result.fidelity).toBe('reconstructed');
        expect(result.reconstructed).toBe(true);
    });

    it('captures both the initial POST login and the redirect GET without overwriting', () => {
        const captured: any[] = [];
        const callback = (har: any) => captured.push(har);

        // Simulate 302 login redirect flow
        const postDetails: any = {
            requestId: 'login-req-1',
            method: 'POST',
            url: 'https://clic.mmu.edu.my/psp/csprd/?&cmd=login&languageCd=ENG',
            requestHeaders: [
                { name: 'Host', value: 'clic.mmu.edu.my' },
                { name: 'Content-Type', value: 'application/x-www-form-urlencoded' }
            ]
        };

        const postBodyData = {
            requestBody: {
                raw: [{ bytes: new TextEncoder().encode('userid=testuser&pwd=testpass&lcsrf_token=123').buffer }]
            }
        };

        const postHar = webRequestToHar(postDetails, postBodyData);
        postHar.request.response = {
            status: 302,
            statusText: 'Found',
            httpVersion: 'HTTP/1.1',
            headers: [{ name: 'Location', value: '/psp/csprd/?&cmd=login&errorCode=105&languageCd=ENG' }]
        };
        callback(postHar);

        const getDetails: any = {
            requestId: 'login-req-1', // Same requestId reused by browser for redirect hop
            method: 'GET',
            url: 'https://clic.mmu.edu.my/psp/csprd/?&cmd=login&errorCode=105&languageCd=ENG',
            requestHeaders: [
                { name: 'Host', value: 'clic.mmu.edu.my' }
            ]
        };
        const getHar = webRequestToHar(getDetails, null);
        getHar.request.response = {
            status: 200,
            statusText: 'OK',
            httpVersion: 'HTTP/1.1',
            headers: [{ name: 'Content-Type', value: 'text/html' }]
        };
        callback(getHar);

        expect(captured).toHaveLength(2);
        expect(captured[0].request.method).toBe('POST');
        expect(captured[0].request.postData.text).toContain('userid=testuser');
        expect(captured[0].request.response.status).toBe(302);

        expect(captured[1].request.method).toBe('GET');
        expect(captured[1].request.url).toContain('errorCode=105');
        expect(captured[1].request.response.status).toBe(200);
    });
});

