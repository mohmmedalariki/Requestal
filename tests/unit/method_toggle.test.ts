import { describe, it, expect } from 'vitest';
import { toggleRequestMethod } from '../../src/core/format/methodToggle';

describe('toggleRequestMethod (POST <-> GET)', () => {
    it('accurately converts POST with form body to GET with query params and strips Content-Type/Length', () => {
        const postReq = [
            'POST /api/v1/users HTTP/1.1',
            'Host: api.target.com',
            'User-Agent: Mozilla/5.0',
            'Content-Type: application/x-www-form-urlencoded',
            'Content-Length: 21',
            '',
            'name=admin&role=editor'
        ].join('\n');

        const getReq = toggleRequestMethod(postReq);

        expect(getReq).toContain('GET /api/v1/users?name=admin&role=editor HTTP/1.1');
        expect(getReq).toContain('Host: api.target.com');
        expect(getReq).toContain('User-Agent: Mozilla/5.0');
        expect(getReq).not.toContain('Content-Type');
        expect(getReq).not.toContain('Content-Length');
    });

    it('accurately converts POST with JSON body to GET with query params', () => {
        const postReq = [
            'POST /api/v1/search HTTP/1.1',
            'Host: api.target.com',
            'Content-Type: application/json',
            '',
            '{"query": "antigravity", "limit": 25}'
        ].join('\n');

        const getReq = toggleRequestMethod(postReq);

        expect(getReq).toContain('GET /api/v1/search?query=antigravity&limit=25 HTTP/1.1');
        expect(getReq).not.toContain('Content-Type');
    });

    it('merges existing URL query parameters when converting POST to GET', () => {
        const postReq = [
            'POST /items?category=books HTTP/1.1',
            'Host: store.com',
            'Content-Type: application/x-www-form-urlencoded',
            '',
            'sort=desc&page=2'
        ].join('\n');

        const getReq = toggleRequestMethod(postReq);

        expect(getReq).toContain('GET /items?category=books&sort=desc&page=2 HTTP/1.1');
    });

    it('accurately converts GET with query params to POST with body and adds Content-Type', () => {
        const getReq = [
            'GET /api/v1/users?name=admin&role=editor HTTP/1.1',
            'Host: api.target.com',
            'Authorization: Bearer secret_token',
            '',
            ''
        ].join('\n');

        const postReq = toggleRequestMethod(getReq);

        expect(postReq).toContain('POST /api/v1/users HTTP/1.1');
        expect(postReq).toContain('Host: api.target.com');
        expect(postReq).toContain('Authorization: Bearer secret_token');
        expect(postReq).toContain('Content-Type: application/x-www-form-urlencoded');
        expect(postReq).toMatch(/\n\nname=admin&role=editor$/);
    });

    it('handles GET without query parameters cleanly', () => {
        const getReq = [
            'GET /healthcheck HTTP/1.1',
            'Host: api.target.com',
            '',
            ''
        ].join('\n');

        const postReq = toggleRequestMethod(getReq);

        expect(postReq).toContain('POST /healthcheck HTTP/1.1');
        expect(postReq).toContain('Content-Type: application/x-www-form-urlencoded');
    });

    it('preserves nested JSON structure and Content-Type: application/json across POST -> GET -> POST round-trip', () => {
        const originalJsonPost = [
            'POST /api/v1/users HTTP/1.1',
            'Host: api.target.com',
            'Content-Type: application/json',
            '',
            JSON.stringify({
                user: {
                    name: 'admin',
                    roles: ['super', 'staff']
                },
                active: true,
                count: 42
            }, null, 2)
        ].join('\n');

        // Step 1: POST -> GET
        const toGet = toggleRequestMethod(originalJsonPost);
        expect(toGet).toContain('GET /api/v1/users?');
        expect(toGet).not.toContain('Content-Type');

        // Step 2: GET -> POST (Must restore JSON structure & Content-Type)
        const backToPost = toggleRequestMethod(toGet);

        expect(backToPost).toContain('POST /api/v1/users HTTP/1.1');
        expect(backToPost).toContain('Content-Type: application/json');
        
        // Extract body
        const lines = backToPost.split('\n');
        const blankIdx = lines.findIndex((l, idx) => idx > 0 && l.trim() === '');
        const reconstructedBody = lines.slice(blankIdx + 1).join('\n');
        const parsed = JSON.parse(reconstructedBody);

        expect(parsed).toEqual({
            user: {
                name: 'admin',
                roles: ['super', 'staff']
            },
            active: true,
            count: 42
        });
    });

    it('preserves Form-UrlEncoded format across POST -> GET -> POST round-trip', () => {
        const originalFormPost = [
            'POST /login HTTP/1.1',
            'Host: target.com',
            'Content-Type: application/x-www-form-urlencoded',
            '',
            'username=admin&password=secret'
        ].join('\n');

        const toGet = toggleRequestMethod(originalFormPost);
        const backToPost = toggleRequestMethod(toGet);

        expect(backToPost).toContain('POST /login HTTP/1.1');
        expect(backToPost).toContain('Content-Type: application/x-www-form-urlencoded');
        expect(backToPost).toContain('username=admin&password=secret');
    });
});
