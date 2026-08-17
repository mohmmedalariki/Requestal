import { useState, useRef, useCallback } from 'react';
import { formToJson, jsonToForm, detectFormat } from '../../core/format/converter';

interface UseEditorStateProps {
    smartFormatMode: boolean;
}

export function useEditorState({ smartFormatMode }: UseEditorStateProps) {
    const [content, setContentState] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [formatWarning, setFormatWarning] = useState<string | null>(null);
    const prevContentTypeRef = useRef<string | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Validation runner (debounced 150ms)
    const runValidation = useCallback((text: string) => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            if (!text) {
                setValidationError(null);
                setFormatWarning(null);
                return;
            }

            const lines = text.split('\n');
            const headerEndIndex = lines.findIndex(l => l.replace(/\r$/, '').trim() === '');
            const body = headerEndIndex !== -1 ? lines.slice(headerEndIndex + 1).join('\n') : '';

            const match = text.match(/^content-type:\s*(.*)$/im);
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

            setValidationError(error);
            setFormatWarning(warning);
        }, 150);
    }, []);

    // Set content and trigger format conversion + validation synchronously on update
    const setContent = useCallback((newText: string) => {
        if (!newText) {
            setContentState('');
            prevContentTypeRef.current = null;
            runValidation('');
            return;
        }

        const lines = newText.split('\n');
        const headerEndIndex = lines.findIndex(l => l.replace(/\r$/, '').trim() === '');
        const body = headerEndIndex !== -1 ? lines.slice(headerEndIndex + 1).join('\n') : '';

        const match = newText.match(/^content-type:\s*(.*)$/im);
        const currentContentType = match ? match[1].trim().toLowerCase() : null;

        let processedText = newText;

        if (smartFormatMode && prevContentTypeRef.current && currentContentType && prevContentTypeRef.current !== currentContentType) {
            const isJson = currentContentType.includes('application/json');
            const isForm = currentContentType.includes('application/x-www-form-urlencoded');
            const prevIsJson = prevContentTypeRef.current.includes('application/json');
            const prevIsForm = prevContentTypeRef.current.includes('application/x-www-form-urlencoded');

            let newBody = body;
            let converted = false;

            if (isJson && prevIsForm) {
                try {
                    newBody = formToJson(body);
                    converted = true;
                } catch {
                    // Ignore conversion failure
                }
            } else if (isForm && prevIsJson) {
                try {
                    newBody = jsonToForm(body);
                    converted = true;
                } catch {
                    // Ignore conversion failure
                }
            }

            if (converted) {
                processedText = lines.slice(0, headerEndIndex + 1).join('\n') + '\n' + newBody;
            }
        }

        prevContentTypeRef.current = currentContentType || null;
        setContentState(processedText);
        runValidation(processedText);
    }, [smartFormatMode, runValidation]);

    return {
        content,
        setContent,
        validationError,
        formatWarning
    };
}
