import React from 'react';
import { Copy } from 'lucide-react';

interface Props {
    command: string;
}

export const CommandPreview: React.FC<Props> = ({ command }) => {
    const copyToClipboard = () => {
        navigator.clipboard.writeText(command);
    };

    return (
        <div className="h-full flex flex-col bg-slate-900 border-t border-slate-700">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-semibold text-slate-300">Generated Command (ffuf)</span>
                <button onClick={copyToClipboard} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors">
                    <Copy size={14} />
                </button>
            </div>
            <div className="flex-1 p-4 overflow-auto font-mono text-xs text-green-400">
                {command}
            </div>
        </div>
    );
};
