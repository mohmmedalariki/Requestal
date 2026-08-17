/**
 * Secrets & Entropy Detection Engine
 * Scans HTTP payloads for credentials, high-entropy tokens, AWS keys, and private keys.
 */

export interface DetectedSecret {
    type: 'aws_key' | 'jwt' | 'private_key' | 'bearer_token' | 'high_entropy_token';
    preview: string;
    line?: number;
}

const REGEX_AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const REGEX_JWT = /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g;
const REGEX_PRIVATE_KEY = /-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----/g;
const REGEX_BEARER = /Bearer\s+([A-Za-z0-9-._~+/]+=*)/gi;

/**
 * Calculates Shannon entropy of a string (in bits per character).
 */
export function calculateShannonEntropy(str: string): number {
    if (!str || str.length === 0) return 0;

    const charMap = new Map<string, number>();
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        charMap.set(c, (charMap.get(c) || 0) + 1);
    }

    let entropy = 0;
    const len = str.length;
    for (const count of charMap.values()) {
        const p = count / len;
        entropy -= p * Math.log2(p);
    }

    return entropy;
}

export function detectSecrets(text: string): DetectedSecret[] {
    if (!text) return [];
    const results: DetectedSecret[] = [];

    // 1. AWS Access Keys
    let match;
    while ((match = REGEX_AWS_KEY.exec(text)) !== null) {
        results.push({
            type: 'aws_key',
            preview: match[0].slice(0, 8) + '...'
        });
    }

    // 2. JWTs
    while ((match = REGEX_JWT.exec(text)) !== null) {
        results.push({
            type: 'jwt',
            preview: match[0].slice(0, 16) + '...'
        });
    }

    // 3. Private Keys
    while ((match = REGEX_PRIVATE_KEY.exec(text)) !== null) {
        results.push({
            type: 'private_key',
            preview: match[0]
        });
    }

    // 4. Bearer Tokens
    while ((match = REGEX_BEARER.exec(text)) !== null) {
        results.push({
            type: 'bearer_token',
            preview: 'Bearer ' + match[1].slice(0, 8) + '...'
        });
    }

    // 5. High-Entropy Tokens (tokens > 24 chars with entropy > 4.2)
    const words = text.match(/[A-Za-z0-9-_]{24,}/g) || [];
    for (const word of words) {
        if (!word.startsWith('eyJ') && !word.startsWith('AKIA')) {
            const entropy = calculateShannonEntropy(word);
            if (entropy >= 4.2) {
                results.push({
                    type: 'high_entropy_token',
                    preview: word.slice(0, 8) + '... (Entropy: ' + entropy.toFixed(2) + ')'
                });
            }
        }
    }

    return results;
}
