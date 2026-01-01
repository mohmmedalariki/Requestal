
import { useState, useRef, useEffect } from 'react';
import { detectFormat, formToJson, jsonToForm } from '../../core/format/converter';

interface UseEditorStateProps {
    smartFormatMode: boolean;
}

export function useEditorState({ smartFormatMode }: UseEditorStateProps) {
    const [content, setContent] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [formatWarning, setFormatWarning] = useState<string | null>(null);
    const prevContentTypeRef = useRef<string | null>(null);

    // Sync body format when Content-Type header changes
    useEffect(() => {
        if (!content) return;

        const lines = content.split('\n');
        const headerEndIndex = lines.findIndex(l => l.trim() === '');
        const body = headerEndIndex !== -1 ? lines.slice(headerEndIndex + 1).join('\n') : '';

        const match = content.match(/^content-type:\s*(.*)$/im);
        const currentContentType = match ? match[1].trim().toLowerCase() : null;

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
                } catch { /* Ignore conversion failure */ }
            } else if (isForm && prevIsJson) {
                try {
                    newBody = jsonToForm(body);
                    converted = true;
                } catch { /* Ignore conversion failure */ }
            }

            if (converted) {
                const newContent = lines.slice(0, headerEndIndex + 1).join('\n') + '\n' + newBody;
                if (newContent !== content) setContent(newContent);
            }
        }
        prevContentTypeRef.current = currentContentType || null;
    }, [content, smartFormatMode]);

    // Validation Logic
    useEffect(() => {
        const lines = content.split('\n');
        const headerEndIndex = lines.findIndex(l => l.trim() === '');
        const body = headerEndIndex !== -1 ? lines.slice(headerEndIndex + 1).join('\n') : '';

        const match = content.match(/^content-type:\s*(.*)$/im);
        const currentContentType = match ? match[1].trim().toLowerCase() : null;

        let error = null;
        let warning = null;
        const bodyFormat = detectFormat(body);

        if (currentContentType) {
            if (currentContentType.includes('application/json')) {
                try {
                    if (body.trim()) JSON.parse(body);
                } catch {
                    error = "Invalid JSON Body";
                }
            } else if (currentContentType.includes('application/x-www-form-urlencoded')) {
                if (bodyFormat === 'json') {
                    error = "RFC Violation: Form Header with JSON Body";
                }
            }
        } else if (bodyFormat === 'json') {
            warning = "Detected JSON body. Missing Content-Type?";
        }

        setValidationError(error);
        setFormatWarning(warning);
    }, [content]);

    return {
        content,
        setContent,
        validationError,
        formatWarning
    };
}
