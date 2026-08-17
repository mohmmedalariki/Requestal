import { describe, it, expect } from 'vitest';
import { isUrlInScope } from '../../src/core/scope/matcher';

describe('Scope Matcher', () => {
    it('matches wildcard subdomains in include rules', () => {
        const includeRules = ['*.target.com'];
        const excludeRules: string[] = [];

        expect(isUrlInScope('https://api.target.com/v1/users', includeRules, excludeRules)).toBe(true);
        expect(isUrlInScope('https://admin.target.com/dashboard', includeRules, excludeRules)).toBe(true);
        expect(isUrlInScope('https://other.com/api', includeRules, excludeRules)).toBe(false);
    });

    it('rejects URLs matching exclude rules even if included', () => {
        const includeRules = ['*.target.com'];
        const excludeRules = ['*.target.com/static/*', '*.target.com/health'];

        expect(isUrlInScope('https://api.target.com/v1/users', includeRules, excludeRules)).toBe(true);
        expect(isUrlInScope('https://api.target.com/static/bundle.js', includeRules, excludeRules)).toBe(false);
        expect(isUrlInScope('https://api.target.com/health', includeRules, excludeRules)).toBe(false);
    });
});
