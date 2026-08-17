import { describe, it, expect } from 'vitest';
import { detectSecrets, calculateShannonEntropy } from '../../src/core/secrets/detect';

describe('Secrets & Entropy Detection', () => {
    it('calculates Shannon entropy correctly', () => {
        expect(calculateShannonEntropy('aaaaaaaa')).toBe(0);
        expect(calculateShannonEntropy('abcdefgh')).toBeGreaterThan(2.5);
    });

    it('detects AWS access keys', () => {
        const payload = 'AWS_KEY=AKIAIOSFODNN7EXAMPLE; secret=123';
        const secrets = detectSecrets(payload);

        expect(secrets.some(s => s.type === 'aws_key')).toBe(true);
    });

    it('detects Bearer tokens and JWTs', () => {
        const jwtPayload = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        const payload = `Authorization: Bearer my_secret_token_12345678\nToken: ${jwtPayload}`;
        const secrets = detectSecrets(payload);

        expect(secrets.some(s => s.type === 'bearer_token')).toBe(true);
        expect(secrets.some(s => s.type === 'jwt')).toBe(true);
    });
});
