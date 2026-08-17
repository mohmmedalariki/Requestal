import React, { useState, useMemo, useCallback } from 'react';
import { Copy, Check, Terminal, Download, FileDown } from 'lucide-react';
import { rawToCurl } from '../../shared/utils/http';
import clsx from 'clsx';

interface Props {
    rawRequest: string;
    url: string;
}

type CommandTool = 'ffuf' | 'curl' | 'sqlmap' | 'nuclei';

/**
 * Derives a short, filesystem-safe filename from the request URL + method.
 * Example: "POST_api_v1_auth_login.req"
 */
function deriveFilename(rawRequest: string, url: string): string {
    const firstLine = rawRequest.split('\n')[0] || '';
    const method = (firstLine.split(' ')[0] || 'REQ').toUpperCase();

    let pathPart = '';
    try {
        const u = new URL(url);
        // Take the last 2 meaningful path segments
        const segments = u.pathname.split('/').filter(Boolean);
        pathPart = segments.slice(-2).join('_') || u.hostname.replace(/\./g, '_');
    } catch {
        pathPart = 'request';
    }

    // Sanitize for filesystem
    const safe = pathPart.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    return `${method}_${safe}.req`;
}

export const CommandPreview: React.FC<Props> = ({ rawRequest, url }) => {
    const [activeTool, setActiveTool] = useState<CommandTool>('curl');
    const [copied, setCopied] = useState(false);
    const [reqSaved, setReqSaved] = useState(false);

    const reqFilename = useMemo(() => deriveFilename(rawRequest, url), [rawRequest, url]);

    /**
     * Downloads the raw HTTP request as a .req file so tools like
     * sqlmap -r, ffuf -request, etc. can consume it directly.
     */
    const saveReqFile = useCallback(() => {
        const blob = new Blob([rawRequest], { type: 'text/plain' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = reqFilename;
        a.click();
        URL.revokeObjectURL(blobUrl);
        setReqSaved(true);
        setTimeout(() => setReqSaved(false), 3000);
    }, [rawRequest, reqFilename]);

    const getGeneratedCommand = (): string => {
        switch (activeTool) {
            case 'curl':
                return rawToCurl(rawRequest, url);
            case 'ffuf':
                return `ffuf -request ${reqFilename} -request-proto https -mode clusterbomb -w wordlist.txt:FUZZ`;
            case 'sqlmap':
                return `sqlmap -r ${reqFilename} --batch --level=3 --risk=2`;
            case 'nuclei':
                return `cat ${reqFilename} | nuclei -t http/vulnerabilities/ -target "${url || 'https://target/'}"`;
        }
    };

    const commandText = getGeneratedCommand();

    // Tools that need the .req file
    const needsReqFile = activeTool === 'sqlmap' || activeTool === 'ffuf' || activeTool === 'nuclei';

    const copyToClipboard = () => {
        navigator.clipboard.writeText(commandText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex flex-col bg-slate-900 border border-slate-800 rounded-lg overflow-hidden text-xs">
            {/* Header / Tabs */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-950 border-b border-slate-800">
                <div className="flex items-center space-x-1">
                    <Terminal size={13} className="text-blue-400 mr-1.5" />
                    {(['curl', 'ffuf', 'sqlmap', 'nuclei'] as CommandTool[]).map(tool => (
                        <button
                            key={tool}
                            onClick={() => setActiveTool(tool)}
                            className={clsx(
                                'px-2 py-0.5 rounded text-[11px] font-mono uppercase transition-all',
                                activeTool === tool
                                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                                    : 'text-slate-500 hover:text-slate-300'
                            )}
                        >
                            {tool}
                        </button>
                    ))}
                </div>

                <div className="flex items-center space-x-1.5">
                    {/* Save .req file button — shown when the active tool needs it */}
                    {needsReqFile && (
                        <button
                            onClick={saveReqFile}
                            className={clsx(
                                'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] border transition-all',
                                reqSaved
                                    ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                                    : 'bg-amber-600/10 text-amber-400 border-amber-500/30 hover:bg-amber-600/20'
                            )}
                            title={`Save raw request as ${reqFilename} for use with ${activeTool}`}
                        >
                            {reqSaved ? <Check size={11} /> : <FileDown size={11} />}
                            <span>{reqSaved ? 'Saved!' : `Save ${reqFilename}`}</span>
                        </button>
                    )}

                    <button
                        onClick={copyToClipboard}
                        className="flex items-center space-x-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 text-[11px] border border-slate-700 transition-colors"
                    >
                        {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                </div>
            </div>

            {/* Hint when .req file is needed but not saved yet */}
            {needsReqFile && !reqSaved && (
                <div className="px-3 py-1.5 bg-amber-950/30 border-b border-amber-900/30 text-[10px] text-amber-400/80 flex items-center space-x-1.5">
                    <Download size={10} />
                    <span>
                        <strong>{activeTool}</strong> reads from a file. Click <strong>"Save {reqFilename}"</strong> first, then run the command in the same directory.
                    </span>
                </div>
            )}

            {/* Code Body */}
            <div className="p-3 bg-slate-950/80 font-mono text-[11px] text-emerald-400 overflow-x-auto whitespace-pre-wrap select-all max-h-32">
                {commandText}
            </div>
        </div>
    );
};
