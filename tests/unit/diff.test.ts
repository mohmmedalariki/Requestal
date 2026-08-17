import { describe, it, expect } from 'vitest';
import { smartDiff } from '../../src/core/diff/engine';
import { computeStructuralDiff } from '../../src/core/diff/structuralDiff';

describe('Diff Engines (Smart Diff & Structural JSON)', () => {
    it('masks ISO timestamps and Unix timestamps', () => {
        const text = `Date: 2026-08-15T10:00:00.000Z\n{"timestamp": 1723716000, "message": "success"}`;
        const result = smartDiff(text);

        expect(result).toContain('<TIMESTAMP>');
        expect(result).not.toContain('2026-08-15T10:00:00.000Z');
        expect(result).not.toContain('1723716000');
    });

    it('masks volatile headers (ETag, If-None-Match, Date)', () => {
        const text = `ETag: "686897696a7c876b7e"\nContent-Type: application/json`;
        const result = smartDiff(text);

        expect(result).toContain('ETag: <IGNORED>');
        expect(result).toContain('Content-Type: application/json');
    });

    it('computes structural JSON diff ignoring key ordering differences', () => {
        const jsonA = JSON.stringify({ a: 1, b: 2, c: [1, 2] });
        // Same keys and values, different order
        const jsonB = JSON.stringify({ c: [1, 2], b: 2, a: 1 });

        const result = computeStructuralDiff(jsonA, jsonB);
        expect(result.isJson).toBe(true);
        expect(result.summary.added).toBe(0);
        expect(result.summary.modified).toBe(0);
        expect(result.summary.removed).toBe(0);
    });

    it('identifies field changes in structural JSON diff', () => {
        const jsonA = JSON.stringify({ user: 'admin', status: 'active' });
        const jsonB = JSON.stringify({ user: 'admin', status: 'suspended', role: 'guest' });

        const result = computeStructuralDiff(jsonA, jsonB);
        expect(result.isJson).toBe(true);
        expect(result.summary.modified).toBe(1); // status modified
        expect(result.summary.added).toBe(1);    // role added
    });
});
