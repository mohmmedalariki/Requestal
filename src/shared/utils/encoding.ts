/**
 * High-performance, memory-safe Base64 and UTF-8 encoding utility.
 * Supports modern Uint8Array.prototype.toBase64() when available,
 * with a safe chunked (32KB) fallback to prevent call stack overflows on large payloads.
 */

export function uint8ArrayToBase64(bytes: Uint8Array): string {
    // 1. Modern V8 / Chromium Uint8Array.prototype.toBase64() if available
    if (typeof (bytes as any).toBase64 === 'function') {
        return (bytes as any).toBase64();
    }

    // 2. Memory-safe chunked conversion (32KB blocks)
    let binary = '';
    const len = bytes.byteLength;
    const CHUNK_SIZE = 0x8000; // 32,768 bytes

    for (let i = 0; i < len; i += CHUNK_SIZE) {
        const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
        binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }

    return btoa(binary);
}

export function stringToBase64(str: string): string {
    const bytes = new TextEncoder().encode(str);
    return uint8ArrayToBase64(bytes);
}

export function base64ToString(b64: string): string {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}
