import { expose } from 'comlink';
import { formToJson, jsonToForm, detectFormat } from '../../core/format/converter';
import { smartDiff, type MaskRule } from '../../core/diff/engine';

export interface ValidationResult {
    error: string | null;
    warning: string | null;
}

export const formatWorkerApi = {
    formToJson(formString: string): string {
        return formToJson(formString);
    },

    jsonToForm(jsonInput: string): string {
        return jsonToForm(jsonInput);
    },

    detectFormat(content: string): 'json' | 'form' | 'unknown' {
        return detectFormat(content);
    },

    validateRequest(content: string): ValidationResult {
        if (!content) return { error: null, warning: null };

        const lines = content.split('\n');
        const headerEndIndex = lines.findIndex(l => l.replace(/\r$/, '').trim() === '');
        const body = headerEndIndex !== -1 ? lines.slice(headerEndIndex + 1).join('\n') : '';

        const match = content.match(/^content-type:\s*(.*)$/im);
        const currentContentType = match ? match[1].trim().toLowerCase() : null;

        let error: string | null = null;
        let warning: string | null = null;
        const bodyFormat = detectFormat(body);

        if (currentContentType) {
            if (currentContentType.includes('application/json')) {
                try {
                    if (body.trim()) JSON.parse(body);
                } catch {
                    error = 'Invalid JSON Body';
                }
            } else if (currentContentType.includes('application/x-www-form-urlencoded')) {
                if (bodyFormat === 'json') {
                    error = 'RFC Violation: Form Header with JSON Body';
                }
            }
        } else if (bodyFormat === 'json' && body.trim().length > 0) {
            warning = 'Detected JSON body. Missing Content-Type?';
        }

        return { error, warning };
    },

    smartDiff(text: string, customRules: MaskRule[] = []): string {
        return smartDiff(text, customRules);
    }
};

expose(formatWorkerApi);

export type FormatWorkerApi = typeof formatWorkerApi;
