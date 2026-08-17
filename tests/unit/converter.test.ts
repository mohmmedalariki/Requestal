import { describe, it, expect } from 'vitest';
import { jsonToForm, formToJson, detectFormat } from '../../src/core/format/converter';

describe('Format Converter (JSON <-> Form-UrlEncoded)', () => {
    it('converts JSON to application/x-www-form-urlencoded', () => {
        const json = JSON.stringify({
            username: 'admin',
            role: 'superuser',
            active: true
        });

        const form = jsonToForm(json);
        expect(form).toContain('username=admin');
        expect(form).toContain('role=superuser');
        expect(form).toContain('active=true');
    });

    it('converts URL-encoded form data to pretty-printed JSON', () => {
        const form = 'id=101&name=test_user&scope=read';
        const jsonStr = formToJson(form);
        const parsed = JSON.parse(jsonStr);

        expect(parsed.id).toBe('101');
        expect(parsed.name).toBe('test_user');
        expect(parsed.scope).toBe('read');
    });

    it('correctly detects JSON vs Form syntax', () => {
        expect(detectFormat('{"test": 123}')).toBe('json');
        expect(detectFormat('[1, 2, 3]')).toBe('json');
        expect(detectFormat('user=admin&pass=123')).toBe('form');
        expect(detectFormat('hello plain text')).toBe('unknown');
    });
});
