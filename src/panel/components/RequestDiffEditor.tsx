import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { computeStructuralDiff } from '../../core/diff/structuralDiff';
import { ErrorBoundary } from './ErrorBoundary';
import { FileCode, Braces } from 'lucide-react';
import clsx from 'clsx';

interface Props {
    original: string; // Baseline
    modified: string; // Current Comparison
    theme?: string;
    language?: string;
}

export const RequestDiffEditor: React.FC<Props> = ({
    original,
    modified,
    theme = 'vs-dark',
    language = 'http'
}) => {
    const [mode, setMode] = useState<'text' | 'structural'>('text');
    const diffEditorRef = useRef<any>(null);

    const handleMount = useCallback((editor: any) => {
        diffEditorRef.current = editor;
    }, []);

    // Monaco DiffEditor lifecycle safety:
    // Reset the diff editor model before unmounting to prevent
    // "TextModel got disposed before DiffEditorWidget model got reset" errors.
    useEffect(() => {
        return () => {
            if (diffEditorRef.current) {
                try {
                    const models = diffEditorRef.current.getModel();
                    diffEditorRef.current.setModel(null);
                    if (models) {
                        if (models.original && !models.original.isDisposed()) {
                            models.original.dispose();
                        }
                        if (models.modified && !models.modified.isDisposed()) {
                            models.modified.dispose();
                        }
                    }
                } catch {
                    // Safe cleanup fallback
                }
                diffEditorRef.current = null;
            }
        };
    }, []);

    // Normalize line endings to LF to prevent line-count / range calculation mismatches in Monaco
    const normalizedOriginal = useMemo(() => (original || '').replace(/\r\n/g, '\n'), [original]);
    const normalizedModified = useMemo(() => (modified || '').replace(/\r\n/g, '\n'), [modified]);

    // Extract JSON body parts if present
    const isLikelyJson = useMemo(() => {
        const checkJson = (str: string) => {
            const trimmed = str.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    JSON.parse(trimmed);
                    return true;
                } catch {
                    return false;
                }
            }
            const lines = str.split('\n');
            const blankIdx = lines.findIndex(l => l.replace(/\r$/, '') === '');
            if (blankIdx > -1 && blankIdx < lines.length - 1) {
                const body = lines.slice(blankIdx + 1).join('\n').trim();
                if (body.startsWith('{') || body.startsWith('[')) {
                    try {
                        JSON.parse(body);
                        return true;
                    } catch {
                        return false;
                    }
                }
            }
            return false;
        };
        return checkJson(normalizedOriginal) || checkJson(normalizedModified);
    }, [normalizedOriginal, normalizedModified]);

    const structuralResult = useMemo(() => {
        if (mode !== 'structural') return null;

        const extractBodyOnly = (str: string) => {
            const lines = str.split('\n');
            const blankIdx = lines.findIndex(l => l.replace(/\r$/, '') === '');
            if (blankIdx > -1 && blankIdx < lines.length - 1) {
                return lines.slice(blankIdx + 1).join('\n').trim();
            }
            return str.trim();
        };

        return computeStructuralDiff(extractBodyOnly(normalizedOriginal), extractBodyOnly(normalizedModified));
    }, [normalizedOriginal, normalizedModified, mode]);

    return (
        <ErrorBoundary fallbackTitle="Diff Editor Error">
            <div className="h-full w-full flex flex-col relative bg-slate-950">
                {/* Diff Mode Toggle Toolbar */}
                {isLikelyJson && (
                    <div className="h-8 border-b border-slate-800 bg-slate-900/90 px-3 flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-1">
                            <button
                                onClick={() => setMode('text')}
                                className={clsx(
                                    'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all',
                                    mode === 'text'
                                        ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                                        : 'text-slate-500 hover:text-slate-300'
                                )}
                            >
                                <FileCode size={11} />
                                <span>Text Diff</span>
                            </button>
                            <button
                                onClick={() => setMode('structural')}
                                className={clsx(
                                    'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all',
                                    mode === 'structural'
                                        ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                                        : 'text-slate-500 hover:text-slate-300'
                                )}
                            >
                                <Braces size={11} />
                                <span>Structural JSON</span>
                            </button>
                        </div>

                        {mode === 'structural' && structuralResult?.summary && (
                            <div className="flex items-center space-x-3 text-[11px] font-mono">
                                <span className="text-emerald-400">+{structuralResult.summary.added} added</span>
                                <span className="text-amber-400">~{structuralResult.summary.modified} changed</span>
                                <span className="text-red-400">-{structuralResult.summary.removed} removed</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Diff Display */}
                <div className="flex-1 min-h-0 relative">
                    {mode === 'text' || !structuralResult?.isJson ? (
                        <DiffEditor
                            height="100%"
                            original={normalizedOriginal}
                            modified={normalizedModified}
                            language={language}
                            theme={theme}
                            onMount={handleMount}
                            options={{
                                originalEditable: false,
                                readOnly: true,
                                renderSideBySide: true,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                diffAlgorithm: 'legacy', // CRITICAL: Use robust legacy diff algorithm to prevent startLineNumber > endLineNumberExclusive crash
                                ignoreTrimWhitespace: false,
                                automaticLayout: true,
                                fontFamily: "'Fira Code', 'Menlo', 'Monaco', 'Courier New', monospace",
                                fontSize: 13,
                            }}
                        />
                    ) : (
                        <div className="h-full w-full overflow-auto p-4 bg-slate-950 font-mono text-xs">
                            <pre className="text-slate-300 whitespace-pre-wrap">
                                {structuralResult.formattedText}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </ErrorBoundary>
    );
};
