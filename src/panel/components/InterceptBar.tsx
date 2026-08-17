import React, { useState } from 'react';
import { Play, SkipForward, XCircle, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import type { PausedTrafficItem } from '../../core/capture/proEngine';

interface Props {
    pausedItem: PausedTrafficItem | null;
    onFulfill: (editedStatusCode: number, editedHeaders: { name: string; value: string }[], editedBody: string) => void;
    onContinue: () => void;
    onDrop: () => void;
    editorContent: string;
}

export const InterceptBar: React.FC<Props> = ({
    pausedItem,
    onFulfill,
    onContinue,
    onDrop,
    editorContent
}) => {
    const [statusCodeInput, setStatusCodeInput] = useState<string>(
        pausedItem?.statusCode ? String(pausedItem.statusCode) : '200'
    );

    if (!pausedItem) return null;

    const isResponse = pausedItem.stage === 'response';

    const handleForwardClick = () => {
        if (isResponse) {
            // Parse status code, headers and body from editorContent
            const lines = editorContent.split('\n');
            let statusCode = parseInt(statusCodeInput, 10) || (pausedItem.statusCode || 200);

            let bodyStart = -1;
            const headers: { name: string; value: string }[] = [];

            // Check if first line is a status line like "HTTP/1.1 200 OK"
            let startIdx = 0;
            if (lines[0] && lines[0].startsWith('HTTP/')) {
                const parts = lines[0].split(' ');
                if (parts[1]) {
                    const parsedCode = parseInt(parts[1], 10);
                    if (!isNaN(parsedCode)) statusCode = parsedCode;
                }
                startIdx = 1;
            }

            for (let i = startIdx; i < lines.length; i++) {
                const line = lines[i].replace(/\r$/, '');
                if (line === '') {
                    bodyStart = i + 1;
                    break;
                }
                const colon = line.indexOf(':');
                if (colon > -1) {
                    headers.push({
                        name: line.slice(0, colon).trim(),
                        value: line.slice(colon + 1).trim()
                    });
                }
            }

            const body = bodyStart > -1 ? lines.slice(bodyStart).join('\n') : (startIdx > 0 ? '' : editorContent);

            // Fallback to pausedItem headers if none parsed from editor
            const finalHeaders = headers.length > 0 ? headers : pausedItem.headers;

            onFulfill(statusCode, finalHeaders, body);
        } else {
            onContinue();
        }
    };

    return (
        <div className="bg-amber-950/70 border-b border-amber-500/40 p-2.5 flex items-center justify-between z-30 shadow-md backdrop-blur-sm">
            <div className="flex items-center space-x-2.5 overflow-hidden">
                <div className="flex items-center space-x-1.5 px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-xs font-bold font-mono uppercase animate-pulse">
                    {isResponse ? <ArrowDownCircle size={13} /> : <ArrowUpCircle size={13} />}
                    <span>PAUSED {pausedItem.stage}</span>
                </div>

                <div className="flex items-center space-x-2 text-xs truncate font-mono">
                    <span className="text-amber-200 font-bold">{pausedItem.method}</span>
                    <span className="text-slate-300 truncate max-w-sm" title={pausedItem.url}>{pausedItem.url}</span>
                    {isResponse && (
                        <div className="flex items-center space-x-1 ml-2">
                            <span className="text-slate-400 text-[10px]">Status:</span>
                            <input
                                type="text"
                                value={statusCodeInput}
                                onChange={(e) => setStatusCodeInput(e.target.value)}
                                className="w-12 bg-slate-900 border border-amber-500/40 rounded px-1.5 py-0.5 text-xs text-amber-300 text-center font-bold"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center space-x-2">
                <button
                    onClick={handleForwardClick}
                    className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold shadow-sm transition-colors border border-emerald-400/40"
                    title="Forward edited content to the browser / server"
                >
                    <Play size={12} className="fill-current" />
                    <span>Forward</span>
                </button>

                <button
                    onClick={onContinue}
                    className="flex items-center space-x-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors border border-slate-700"
                    title="Forward original unmodified content"
                >
                    <SkipForward size={12} />
                    <span>Pass</span>
                </button>

                <button
                    onClick={onDrop}
                    className="flex items-center space-x-1.5 px-2.5 py-1 bg-red-950/60 hover:bg-red-900/80 text-red-300 rounded text-xs font-medium transition-colors border border-red-500/30"
                    title="Drop/fail this request or response"
                >
                    <XCircle size={12} />
                    <span>Drop</span>
                </button>
            </div>
        </div>
    );
};
