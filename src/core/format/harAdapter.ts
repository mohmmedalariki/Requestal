import { serializeBody } from './converter';
import type { FidelityType, HarRequestObject } from '../../shared/utils/http';

export function extractBody(requestBody: any): { text: string | undefined; fidelity: FidelityType; reconstructed: boolean } {
    if (!requestBody) {
        return { text: undefined, fidelity: 'partial', reconstructed: false };
    }

    // 1. ALWAYS prefer raw bytes - byte-identical to the wire, exact parameter ordering preserved
    if (requestBody.raw && Array.isArray(requestBody.raw) && requestBody.raw.length > 0) {
        try {
            const decoder = new TextDecoder('utf-8');
            let combinedText = '';
            for (const chunk of requestBody.raw) {
                if (chunk.bytes) {
                    combinedText += decoder.decode(chunk.bytes, { stream: true });
                } else if (chunk.file) {
                    combinedText += `[File: ${chunk.file}]`;
                }
            }
            combinedText += decoder.decode(); // flush
            return { text: combinedText, fidelity: 'partial', reconstructed: false };
        } catch {
            // Fallthrough if decoding fails
        }
    }

    // 2. formData is a fallback of last resort when Chrome does not provide raw bytes
    if (requestBody.formData) {
        const normalized: Record<string, any> = {};
        Object.keys(requestBody.formData).forEach(key => {
            const vals = requestBody.formData[key];
            normalized[key] = Array.isArray(vals) && vals.length === 1 ? vals[0] : vals;
        });

        return {
            text: serializeBody(normalized, 'application/x-www-form-urlencoded'),
            fidelity: 'reconstructed',
            reconstructed: true
        };
    }

    return { text: undefined, fidelity: 'partial', reconstructed: false };
}

export function webRequestToHar(details: any, bodyData: any): HarRequestObject {
    const headers = details.requestHeaders ? [...details.requestHeaders] : [];

    // Detect Content-Type
    let contentType = '';
    const ctHeader = headers.find((h: any) => h.name.toLowerCase() === 'content-type');
    if (ctHeader) {
        contentType = ctHeader.value;
    }

    // Extract body with raw-bytes priority
    let postData: { text?: string; mimeType?: string } | undefined = undefined;
    let fidelity: FidelityType = 'partial';
    const fidelityNotes: string[] = [];

    if (bodyData && bodyData.requestBody) {
        const extracted = extractBody(bodyData.requestBody);
        if (extracted.text !== undefined) {
            postData = {
                text: extracted.text,
                mimeType: contentType || 'application/x-www-form-urlencoded'
            };
            fidelity = extracted.fidelity;
            if (extracted.reconstructed) {
                fidelityNotes.push('Body reconstructed from formData dictionary; parameter order not guaranteed.');
            }
        }
    }

    // Compute Content-Length if missing and body exists
    if (postData?.text) {
        const hasContentLength = headers.some((h: any) => h.name.toLowerCase() === 'content-length');
        if (!hasContentLength) {
            const byteLen = new TextEncoder().encode(postData.text).length;
            headers.push({ name: 'Content-Length', value: String(byteLen) });
        }
    }

    return {
        requestId: details.requestId,
        fidelity,
        fidelityNotes,
        timestamp: details.timeStamp || Date.now(),
        request: {
            method: details.method,
            url: details.url,
            httpVersion: 'HTTP/1.1',
            headers,
            postData,
            response: { status: 0 }
        },
        initiator: details.initiator
    };
}
