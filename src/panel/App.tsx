import { useState, useEffect, useRef } from 'react';
import { ResizableBox } from 'react-resizable';
import { RequestEditor } from '../components/RequestEditor';
import { RequestDiffEditor } from '../components/RequestDiffEditor';
import { harToRaw } from '../utils/http';
import { saveBaseline, getBaseline, clearBaseline } from '../utils/storage';
import { smartDiff } from '../utils/diffEngine';
import { jsonToForm, formToJson, detectFormat } from '../utils/bodyConverter';
import { dispatchRequest, type DispatchResponse } from '../utils/dispatcher';
import { Copy, Shield, Network, Trash2, Search, Filter, Pin, ArrowRightLeft, Spline, Activity, Check, RefreshCw, AlertTriangle, Play, Loader2, FileText, Server } from 'lucide-react';
import clsx from 'clsx';

function App() {
    const [requests, setRequests] = useState<any[]>([]);
    const [selectedIdx, setSelectedIdx] = useState<number>(-1);
    const [editorContent, setEditorContent] = useState('');

    // UI Functionality State
    const [cleanMode, setCleanMode] = useState(false);
    const [smartDiffMode, setSmartDiffMode] = useState(false);
    const [followTraffic, setFollowTraffic] = useState(false);
    const [smartFormatMode, setSmartFormatMode] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(300);
    const [filterQuery, setFilterQuery] = useState('');

    // Send & Response State
    const [activeTab, setActiveTab] = useState<'request' | 'response'>('request');
    const [isLoading, setIsLoading] = useState(false);
    const [latestResponse, setLatestResponse] = useState<DispatchResponse | null>(null);

    // Baseline State
    const [baselineRequest, setBaselineRequest] = useState<any | null>(null);
    const [baselineResponse, setBaselineResponse] = useState<DispatchResponse | null>(null);
    const [baselineRaw, setBaselineRaw] = useState<string>('');

    // Copy & Validation State
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [formatWarning, setFormatWarning] = useState<string | null>(null);

    // Refs
    const requestsRef = useRef(requests);
    requestsRef.current = requests;
    const followTrafficRef = useRef(followTraffic);
    followTrafficRef.current = followTraffic;
    const prevContentTypeRef = useRef<string | null>(null);

    // Load baseline on mount
    useEffect(() => {
        getBaseline().then(data => {
            if (data) {
                setBaselineRequest(data.request);
                setBaselineRaw(harToRaw(data.request, cleanMode));
                if (data.response) {
                    setBaselineResponse(data.response);
                }
            }
        });
    }, []);

    // Re-process baseline raw
    useEffect(() => {
        if (baselineRequest) {
            setBaselineRaw(harToRaw(baselineRequest, cleanMode));
        }
    }, [cleanMode, baselineRequest]);

    // Handle Pinning
    const handlePin = (req: any, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setBaselineRequest(req);

        // If we are pinning the currently selected request AND we have a latest response for it
        // we should pin the response too. 
        // Simplified Logic: If we Pin, we pin the *current view state* if possible. 
        // But usually Pin happens on the list item.
        // Strategy: If 'latestResponse' corresponds to the pinned request, pin it.
        // For now, let's just pin the request. If the user wants to pin response, maybe we need explicit action or auto-pin if 'latestResponse' is fresh?
        // Let's go with: If we Pin, and we have a latestResponse, assume it belongs to this interaction context (since we only have one active response state).
        // Note: This might be inaccurate if user navigates away. But typical workflow: Select -> Send -> Pin. 

        const resToPin = (selectedIdx !== -1 && requests[selectedIdx] === req) ? latestResponse : null;
        setBaselineResponse(resToPin);

        saveBaseline(req, resToPin);
    };

    const handleUnpin = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setBaselineRequest(null);
        setBaselineResponse(null);
        clearBaseline();
    };

    // Listener setup
    useEffect(() => {
        const messageListener = (message: any) => {
            if (message.type === 'NEW_REQUEST') {
                const newReq = message.payload;
                setRequests(prev => {
                    const updated = [...prev, newReq];
                    if (followTrafficRef.current) {
                        setTimeout(() => setSelectedIdx(updated.length - 1), 0);
                    }
                    return updated;
                });
            }
        };
        chrome.runtime.onMessage.addListener(messageListener);
        return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, []);

    // Update editor content when selection changes
    useEffect(() => {
        if (selectedIdx >= 0 && selectedIdx < requests.length) {
            const raw = harToRaw(requests[selectedIdx], cleanMode);
            setEditorContent(raw);
            setCopyStatus('idle');
            setValidationError(null);
            setFormatWarning(null);

            // Reset Response State on navigation (unless we want to keep it? usually navigation = new context)
            // Actually, keeping previous response might be confusing. Let's clear it to encourage sending new one.
            setLatestResponse(null);
            setActiveTab('request'); // Auto switch back to request view

            const match = raw.match(/^content-type:\s*(.*)$/im);
            prevContentTypeRef.current = match ? match[1].trim() : null;
        }
    }, [selectedIdx, cleanMode, requests]);


    // Body Sync & Validation Logic
    useEffect(() => {
        if (!editorContent) return;

        const lines = editorContent.split('\n');
        const headerEndIndex = lines.findIndex(l => l.trim() === '');
        const body = headerEndIndex !== -1 ? lines.slice(headerEndIndex + 1).join('\n') : '';

        const match = editorContent.match(/^content-type:\s*(.*)$/im);
        const currentContentType = match ? match[1].trim().toLowerCase() : null;

        /* Format Sync Logic */
        if (smartFormatMode && prevContentTypeRef.current && currentContentType && prevContentTypeRef.current !== currentContentType) {
            const isJson = currentContentType.includes('application/json');
            const isForm = currentContentType.includes('application/x-www-form-urlencoded');
            const prevIsJson = prevContentTypeRef.current.includes('application/json');
            const prevIsForm = prevContentTypeRef.current.includes('application/x-www-form-urlencoded');

            let newBody = body;
            let converted = false;

            if (isJson && prevIsForm) {
                try { newBody = formToJson(body); converted = true; } catch (e) { }
            } else if (isForm && prevIsJson) {
                try { newBody = jsonToForm(body); converted = true; } catch (e) { }
            }

            if (converted) {
                const newContent = lines.slice(0, headerEndIndex + 1).join('\n') + '\n' + newBody;
                if (newContent !== editorContent) setEditorContent(newContent);
            }
        }
        prevContentTypeRef.current = currentContentType || null;


        // Validation
        let warning = null;
        let error = null;
        const bodyFormat = detectFormat(body);

        if (currentContentType) {
            if (currentContentType.includes('application/json')) {
                try { if (body.trim()) JSON.parse(body); } catch (e) { error = "Invalid JSON Body"; }
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

    }, [editorContent, smartFormatMode]);


    const handleSmartCopy = () => {
        if (validationError) {
            setCopyStatus('error');
            setTimeout(() => setCopyStatus('idle'), 2000);
            return;
        }
        navigator.clipboard.writeText(editorContent);
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus('idle'), 1500);
    };

    const handleClear = () => {
        setRequests([]);
        setSelectedIdx(-1);
        setEditorContent('');
        setLatestResponse(null);
    };

    const handleSend = async () => {
        if (!editorContent) return;
        setIsLoading(true);

        try {
            const response = await dispatchRequest(editorContent);
            setLatestResponse(response);
            setActiveTab('response');

            // If we have a baseline active, we might want to update the comparison logic or just show it
        } catch (e) {
            console.error("Dispatch Failed", e);
        } finally {
            setIsLoading(false);
        }
    };

    // Filtering & Colors
    const filteredRequests = requests.map((r, i) => ({ r, i })).filter(({ r }) => {
        if (!filterQuery) return true;
        const q = filterQuery.toLowerCase();
        try { return (r.request.url || "").toLowerCase().includes(q) || (r.request.method || "").toLowerCase().includes(q); } catch (e) { return false; }
    });

    const getMethodColor = (method: string) => {
        if (!method) return 'text-slate-300 bg-slate-500/10 border-slate-500/20';
        switch (method.toUpperCase()) {
            case 'GET': return 'text-green-400 bg-green-400/10 border-green-400/20';
            case 'POST': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
            case 'PUT': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
            case 'DELETE': return 'text-red-400 bg-red-400/10 border-red-400/20';
            default: return 'text-slate-300 bg-slate-500/10 border-slate-500/20';
        }
    };

    const getStatusColor = (status: number) => {
        if (status >= 500) return 'text-red-500';
        if (status >= 400) return 'text-red-400';
        if (status >= 300) return 'text-blue-400';
        if (status >= 200) return 'text-green-400';
        return 'text-slate-400';
    };

    // Determine view mode
    const showRequestDiff = activeTab === 'request' && baselineRequest && selectedIdx !== -1;
    const originalReqText = showRequestDiff ? (smartDiffMode ? smartDiff(baselineRaw) : baselineRaw) : '';
    const modifiedReqText = showRequestDiff ? (smartDiffMode ? smartDiff(editorContent) : editorContent) : '';

    // Response View Logic
    // If we have a baselineResponse AND a latestResponse, show diff
    const showResponseDiff = activeTab === 'response' && baselineResponse && latestResponse;

    const getResponseText = (res: DispatchResponse | null) => {
        if (!res) return '';
        // Format response for display: Headers + Body ? Or just Body?
        // Convention: Usually just Body in editor, headers in UI.
        // But diffing works better if we can see headers too?
        // Let's stick to Body for the main editor view, headers in the bar. Or maybe reconstruct raw response?
        // Reconstructing raw response is consistent with request view.

        const headerString = Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
        return `HTTP/1.1 ${res.status} ${res.statusText}\n${headerString}\n\n${res.body}`;
    };

    const originalResText = showResponseDiff && baselineResponse ? getResponseText(baselineResponse) : '';
    const modifiedResText = activeTab === 'response' && latestResponse ? getResponseText(latestResponse) : '';


    const getCurrentOriginal = () => {
        if (selectedIdx >= 0 && selectedIdx < requests.length) {
            return harToRaw(requests[selectedIdx], cleanMode);
        }
        return '';
    };
    const isDirty = editorContent !== getCurrentOriginal();

    return (
        <div className="flex h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden font-sans">
            {/* Sidebar (Same as before) */}
            <ResizableBox
                width={sidebarWidth}
                height={Infinity}
                axis="x"
                resizeHandles={['e']}
                minConstraints={[200, Infinity]}
                maxConstraints={[600, Infinity]}
                onResizeStop={(_e, data) => setSidebarWidth(data.size.width)}
                handle={<div className="react-resizable-handle react-resizable-handle-e group hover:bg-transparent"><div className="h-full w-[1px] bg-slate-800 group-hover:bg-blue-500 transition-colors mx-auto" /></div>}
                className="flex-shrink-0 flex flex-col border-r border-slate-800 bg-slate-900/50 backdrop-blur-sm z-10"
            >
                <div className="p-3 border-b border-slate-800 space-y-3 bg-slate-900">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-slate-100 font-semibold tracking-tight">
                            <div className="bg-blue-600/20 p-1 rounded text-blue-500">
                                <Network size={16} />
                            </div>
                            <span>Requests</span>
                            <span className="text-xs font-normal text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">{requests.length}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                            {baselineRequest && (
                                <div className="flex items-center space-x-1 px-2 py-0.5 bg-yellow-400/10 text-yellow-500 border border-yellow-400/20 rounded text-[10px]" title="Baseline Active">
                                    <Pin size={10} className="fill-current" />
                                    <span>Baseline</span>
                                    <button onClick={(e) => handleUnpin(e)} className="hover:text-white ml-1"><Trash2 size={10} /></button>
                                </div>
                            )}
                            <button onClick={handleClear} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"><Trash2 size={14} /></button>
                        </div>
                    </div>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none"><Search size={12} className="text-slate-500" /></div>
                        <input
                            type="text"
                            placeholder="Filter..."
                            value={filterQuery}
                            onChange={(e) => setFilterQuery(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded py-1.5 pl-8 pr-3 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-slate-700/50">
                    {/* List Items (Same) */}
                    {requests.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-600 text-xs">
                            <Filter size={24} className="mb-2 opacity-20" />
                            <p>No requests</p>
                        </div>
                    ) : filteredRequests.length === 0 ? (
                        <div className="p-4 text-xs text-slate-500 text-center">No matches</div>
                    ) : (
                        filteredRequests.map(({ r, i }) => {
                            const name = r.request.url.split('/').pop().split('?')[0] || '/';
                            const domain = new URL(r.request.url).hostname;
                            return (
                                <div
                                    key={i}
                                    onClick={() => setSelectedIdx(i)}
                                    className={clsx("group px-3 py-2.5 cursor-pointer border-b border-slate-800/40 hover:bg-slate-800/50 transition-colors flex flex-col relative", selectedIdx === i ? "bg-blue-900/10" : "")}
                                >
                                    {selectedIdx === i && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-500 rounded-r" />}
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center space-x-2">
                                            <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded border leading-none tracking-wide", getMethodColor(r.request.method))}>{r.request.method}</span>
                                            <span className={clsx("text-xs font-mono font-medium", getStatusColor(r.request.response?.status || 0))}>{r.request.response?.status || '...'}</span>
                                        </div>
                                        <button
                                            onClick={(e) => handlePin(r, e)}
                                            className={clsx("opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-700", baselineRequest === r ? "opacity-100 text-yellow-400" : "text-slate-500 hover:text-white")}
                                        >
                                            <Pin size={12} className={baselineRequest === r ? "fill-current" : ""} />
                                        </button>
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className={clsx("truncate text-xs font-medium mb-0.5", selectedIdx === i ? "text-blue-100" : "text-slate-300")}>{name}</span>
                                        <span className="truncate text-[10px] text-slate-500 font-mono">{domain}</span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </ResizableBox>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
                {/* Top Toolbar / Tab Bar */}
                <div className="h-12 flex-shrink-0 border-b border-slate-800 flex items-center px-4 space-x-3 bg-slate-900 z-20">
                    {/* Tabs */}
                    <div className="flex items-center bg-slate-950 rounded p-1 border border-slate-800 mr-2">
                        <button
                            onClick={() => setActiveTab('request')}
                            className={clsx("px-3 py-1 text-xs rounded font-medium transition-all flex items-center space-x-1", activeTab === 'request' ? "bg-slate-800 text-white shadow-sm" : "text-slate-500 hover:text-slate-300")}
                        >
                            <FileText size={12} />
                            <span>Request</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('response')}
                            className={clsx("px-3 py-1 text-xs rounded font-medium transition-all flex items-center space-x-1 relative", activeTab === 'response' ? "bg-slate-800 text-white shadow-sm" : "text-slate-500 hover:text-slate-300")}
                        >
                            <Server size={12} />
                            <span>Response</span>
                            {activeTab !== 'response' && latestResponse && <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />}
                        </button>
                    </div>

                    {/* Shared Toolbar Items */}
                    {activeTab === 'request' && (
                        <>
                            <div className="h-4 w-[1px] bg-slate-800 mx-1" />
                            <button onClick={() => setCleanMode(!cleanMode)} className={clsx("flex items-center space-x-1 text-xs px-2 py-1.5 rounded transition-all border", cleanMode ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700")} title="Strip telemetry"><Shield size={12} /></button>
                            <button onClick={() => setFollowTraffic(!followTraffic)} className={clsx("flex items-center space-x-1 text-xs px-2 py-1.5 rounded transition-all border", followTraffic ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700")} title="Follow"><Activity size={12} /></button>
                            <button onClick={() => setSmartFormatMode(!smartFormatMode)} className={clsx("flex items-center space-x-1 text-xs px-2 py-1.5 rounded transition-all border", smartFormatMode ? "bg-teal-500/10 text-teal-400 border-teal-500/20" : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700")} title="Smart Format"><RefreshCw size={12} /></button>
                        </>
                    )}

                    {(activeTab === 'request' ? showRequestDiff : showResponseDiff) && (
                        <button
                            onClick={() => setSmartDiffMode(!smartDiffMode)}
                            className={clsx("flex items-center space-x-2 text-xs px-2 py-1.5 rounded transition-all border", smartDiffMode ? "bg-purple-500/10 text-purple-400 border-purple-500/20" : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700")}
                            title="Smart Diff"
                        >
                            <Spline size={12} />
                            <span className="hidden xl:inline">Smart Diff</span>
                        </button>
                    )}

                    <div className="flex-1" />

                    {(activeTab === 'request' ? showRequestDiff : showResponseDiff) && !validationError && !formatWarning && (
                        <div className="hidden xl:flex items-center space-x-2 text-xs text-slate-500 mr-4">
                            <span className="flex items-center"><Pin size={10} className="mr-1 inline" /> Baseline</span>
                            <ArrowRightLeft size={10} />
                            <span>Comparison</span>
                        </div>
                    )}

                    {/* Send / Copy Actions */}
                    {activeTab === 'request' ? (
                        <>
                            {validationError && <div className="flex items-center space-x-1 text-xs text-red-500 mr-2"><AlertTriangle size={12} /><span>{validationError}</span></div>}
                            {!validationError && formatWarning && <div className="flex items-center space-x-1 text-xs text-yellow-500 mr-2"><AlertTriangle size={12} /><span>Format Mismatch</span></div>}

                            <button
                                onClick={handleSmartCopy}
                                disabled={(!isDirty && copyStatus === 'idle') || !!validationError}
                                className={clsx("mr-2 flex items-center space-x-2 text-xs px-3 py-1.5 rounded font-medium border transition-all", copyStatus === 'copied' ? "bg-green-600 text-white border-green-500" : copyStatus === 'error' ? "bg-red-600 text-white border-red-500" : isDirty ? "bg-blue-600/80 text-white border-blue-500 hover:bg-blue-600" : "bg-slate-800 text-slate-500 border-slate-700 opacity-50")}
                            >
                                {copyStatus === 'copied' ? <Check size={12} /> : copyStatus === 'error' ? <AlertTriangle size={12} /> : <Copy size={12} />}
                                <span className="hidden lg:inline">{isDirty ? "Copy New" : "Copy"}</span>
                            </button>

                            <button
                                onClick={handleSend}
                                disabled={!!validationError || isLoading}
                                className={clsx(
                                    "flex items-center space-x-2 text-xs px-4 py-1.5 rounded font-bold border transition-all shadow-lg",
                                    isLoading
                                        ? "bg-slate-700 text-slate-400 border-slate-600 cursor-wait"
                                        : "bg-blue-500 text-white border-blue-400 hover:bg-blue-400 hover:border-blue-300 shadow-blue-500/20"
                                )}
                            >
                                {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
                                <span>Send</span>
                            </button>
                        </>
                    ) : (
                        // Response Tab Actions
                        <div className="flex items-center space-x-3">
                            {latestResponse ? (
                                <>
                                    <div className="flex items-center space-x-2 px-2 py-1 bg-slate-900 border border-slate-800 rounded">
                                        <span className={clsx("text-xs font-mono font-bold", getStatusColor(latestResponse.status))}>{latestResponse.status} {latestResponse.statusText}</span>
                                        <span className="text-slate-600 text-[10px]">|</span>
                                        <span className="text-xs text-slate-400">{latestResponse.timeMs}ms</span>
                                    </div>
                                </>
                            ) : (
                                <span className="text-xs text-slate-500 italic">No response yet</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Editor Area */}
                <div className="flex-1 overflow-hidden bg-slate-950 relative">
                    {selectedIdx === -1 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-700 p-8 text-center">
                            <div className="bg-slate-900 rounded-full p-6 mb-4 shadow-xl border border-slate-800"><Network size={48} className="text-slate-600" /></div>
                            <h3 className="text-lg font-semibold text-slate-400 mb-2">Ready to Fuzz</h3>
                            <p className="text-sm text-slate-600 max-w-xs">Select data to begin.</p>
                        </div>
                    ) : (
                        activeTab === 'request' ? (
                            <div className="h-full w-full relative">
                                {showRequestDiff ? (
                                    <RequestDiffEditor original={originalReqText} modified={modifiedReqText} />
                                ) : (
                                    <RequestEditor value={editorContent} onChange={(val) => setEditorContent(val || '')} />
                                )}
                            </div>
                        ) : (
                            <div className="h-full w-full relative">
                                {/* Response View */}
                                {latestResponse ? (
                                    showResponseDiff ? (
                                        <RequestDiffEditor original={originalResText} modified={modifiedResText} />
                                    ) : (
                                        <RequestEditor value={getResponseText(latestResponse)} onChange={() => { }} /> // Read only by not using change handler effectively or passing readonly prop if added
                                    )
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-700">
                                        <Server size={32} className="mb-2 opacity-50" />
                                        <p>No response data available.</p>
                                        <button onClick={() => setActiveTab('request')} className="mt-2 text-blue-500 hover:underline text-xs">Go to Request</button>
                                    </div>
                                )}
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
