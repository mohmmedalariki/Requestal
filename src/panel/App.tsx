import { useState, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ResizableBox } from 'react-resizable';
import clsx from 'clsx';
import {
    Network, Trash2, Search, Filter, Pin, Spline, Activity, Check,
    AlertTriangle, Play, Loader2, FileText, Server, Shield,
    Copy, Download, Target, Zap, Pause, ArrowLeftRight
} from 'lucide-react';

import { RequestEditor } from './components/RequestEditor';
import { RequestDiffEditor } from './components/RequestDiffEditor';
import { FidelityBadge } from './components/FidelityBadge';
import { ScopeModal } from './components/ScopeModal';
import { ProfileSwitcher } from './components/ProfileSwitcher';
import { CommandPreview } from './components/CommandPreview';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InterceptBar } from './components/InterceptBar';
import type { PausedTrafficItem } from '../core/capture/proEngine';

import { smartDiff } from '../core/diff/engine';
import { toggleRequestMethod } from '../core/format/methodToggle';
import { dispatchRequest, type DispatchResponse } from '../core/dispatcher/client';
import { detectSecrets } from '../core/secrets/detect';

import { useCaptureStore } from './stores/useCaptureStore';
import { useSettingsStore } from './stores/useSettingsStore';
import { useScopeStore } from './stores/useScopeStore';
import { useEditorState } from './hooks/useEditorState';

function App() {
    // Zustand Stores
    const {
        requests,
        selectedId,
        selectedBody,
        baselineId,
        baselineBody,
        filterQuery,
        followTraffic,
        initStore,
        addIncomingRequests,
        selectRequest,
        setFilterQuery,
        setFollowTraffic,
        pinBaseline,
        unpinBaseline,
        clearAll,
        updateSelectedBodyContent
    } = useCaptureStore();

    const {
        cleanMode,
        smartDiffMode,
        sidebarWidth,
        activeTab,
        proEngineActive,
        setCleanMode,
        setSmartDiffMode,
        setSidebarWidth,
        setActiveTab,
        setProEngineActive
    } = useSettingsStore();

    const { scopeEnabled } = useScopeStore();

    // Local UI State
    const [isScopeModalOpen, setIsScopeModalOpen] = useState(false);
    const [showCommandPreview, setShowCommandPreview] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [latestResponse, setLatestResponse] = useState<DispatchResponse | null>(null);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
    const [isInterceptArmed, setIsInterceptArmed] = useState(false);
    const [pausedTraffic, setPausedTraffic] = useState<PausedTrafficItem | null>(null);

    // Virtual list parent ref
    const listParentRef = useRef<HTMLDivElement>(null);

    // Editor state hook
    const {
        content: editorContent,
        setContent: setEditorContent,
        validationError,
        formatWarning
    } = useEditorState({ smartFormatMode: false });

    // Initialize Store on mount & listen to background IPC
    useEffect(() => {
        initStore();

        // Point 5: Keep service worker alive while side panel is active
        let heartbeatPort: chrome.runtime.Port | null = null;
        try {
            heartbeatPort = chrome.runtime.connect({ name: 'requestal_sidepanel_heartbeat' });
        } catch {
            // Ignore if connection fails
        }

        const messageListener = (message: any) => {
            if (message && message.type === 'NEW_REQUESTS' && Array.isArray(message.payload)) {
                addIncomingRequests(message.payload);
            } else if (message && message.type === 'TRAFFIC_PAUSED' && message.payload) {
                const item: PausedTrafficItem = message.payload;
                setPausedTraffic(item);
                if (item.stage === 'response') {
                    setActiveTab('response');
                    const headerLines = (item.headers || []).map(h => `${h.name}: ${h.value}`).join('\r\n');
                    const full = `HTTP/1.1 ${item.statusCode || 200} ${item.statusText || 'OK'}\r\n${headerLines}\r\n\r\n${item.body || ''}`;
                    setEditorContent(full);
                } else {
                    setActiveTab('request');
                    const headerLines = (item.headers || []).map(h => `${h.name}: ${h.value}`).join('\r\n');
                    const full = `${item.method} ${item.url} HTTP/1.1\r\n${headerLines}\r\n\r\n${item.body || ''}`;
                    setEditorContent(full);
                }
            } else if (message && message.type === 'PRO_ENGINE_DETACHED') {
                // Point 3: Handle DevTools collision and clean up state
                setProEngineActive(false);
                setIsInterceptArmed(false);
                setPausedTraffic(null);
                if (message.payload?.message) {
                    alert(message.payload.message);
                }
            }
        };

        chrome.runtime.onMessage.addListener(messageListener);
        return () => {
            chrome.runtime.onMessage.removeListener(messageListener);
            if (heartbeatPort) heartbeatPort.disconnect();
        };
    }, [initStore, addIncomingRequests, setActiveTab, setEditorContent, setProEngineActive]);

    // Sync Editor with Selected Request Body
    useEffect(() => {
        if (selectedBody) {
            setEditorContent(selectedBody.rawRequest || '');
            setCopyStatus('idle');
            setLatestResponse(null); // Reset replay response so we show captured response by default
        }
    }, [selectedBody, setEditorContent]);

    // Filtered Requests Computation
    const filteredRequests = useMemo(() => {
        if (!filterQuery.trim()) return requests;
        const q = filterQuery.toLowerCase();
        return requests.filter(r =>
            (r.url || '').toLowerCase().includes(q) ||
            (r.method || '').toLowerCase().includes(q) ||
            (r.host || '').toLowerCase().includes(q)
        );
    }, [requests, filterQuery]);

    // Virtualizer Setup for 60fps scrolling (§5.1)
    const rowVirtualizer = useVirtualizer({
        count: filteredRequests.length,
        getScrollElement: () => listParentRef.current,
        estimateSize: () => 64,
        overscan: 10
    });

    // Detected Secrets Scan
    const detectedSecrets = useMemo(() => {
        return detectSecrets(editorContent);
    }, [editorContent]);

    // Pro Mode (CDP) Toggle Handler
    const handleToggleProMode = async () => {
        if (!proEngineActive) {
            // Query active tab and attach CDP debugger engine
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTabId = tabs[0]?.id;
                if (typeof activeTabId === 'number') {
                    chrome.runtime.sendMessage({ type: 'ATTACH_PRO_ENGINE', tabId: activeTabId }, (res) => {
                        if (res && res.success) {
                            setProEngineActive(true);
                        } else {
                            alert(res?.error || 'Failed to attach Pro Engine debugger to the active tab.');
                        }
                    });
                } else {
                    alert('No active browser tab found to attach debugger.');
                }
            });
        } else {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTabId = tabs[0]?.id;
                if (typeof activeTabId === 'number') {
                    chrome.runtime.sendMessage({ type: 'DETACH_PRO_ENGINE', tabId: activeTabId }, () => {
                        setProEngineActive(false);
                        setIsInterceptArmed(false);
                        setPausedTraffic(null);
                    });
                } else {
                    setProEngineActive(false);
                    setIsInterceptArmed(false);
                    setPausedTraffic(null);
                }
            });
        }
    };

    // Interception Handlers
    const handleToggleIntercept = async () => {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            const activeTabId = tabs[0]?.id;
            if (typeof activeTabId !== 'number') {
                alert('No active browser tab found.');
                return;
            }

            if (!isInterceptArmed) {
                if (!proEngineActive) {
                    const attachSuccess = await new Promise<boolean>((resolve) => {
                        chrome.runtime.sendMessage({ type: 'ATTACH_PRO_ENGINE', tabId: activeTabId }, (res) => {
                            if (res && res.success) {
                                setProEngineActive(true);
                                resolve(true);
                            } else {
                                alert(res?.error || 'Failed to attach Pro Mode for interception.');
                                resolve(false);
                            }
                        });
                    });

                    if (!attachSuccess) return;
                }

                const { includeRules, excludeRules, scopeEnabled } = useScopeStore.getState();

                chrome.runtime.sendMessage({
                    type: 'ENABLE_INTERCEPTION',
                    tabId: activeTabId,
                    stage: 'Response',
                    manualIntercept: true,
                    includeRules: scopeEnabled ? includeRules : [],
                    excludeRules: scopeEnabled ? excludeRules : [],
                    resourceTypes: ['Document', 'XHR', 'Fetch']
                }, (res) => {
                    if (res && res.success) {
                        setIsInterceptArmed(true);
                    }
                });
            } else {
                chrome.runtime.sendMessage({
                    type: 'DISABLE_INTERCEPTION',
                    tabId: activeTabId
                }, () => {
                    setIsInterceptArmed(false);
                    setPausedTraffic(null);
                });
            }
        });
    };

    const handleFulfillPaused = (statusCode: number, headers: { name: string; value: string }[], body: string) => {
        if (!pausedTraffic) return;
        chrome.runtime.sendMessage({
            type: 'FULFILL_PAUSED_RESPONSE',
            tabId: pausedTraffic.tabId,
            requestId: pausedTraffic.requestId,
            responseCode: statusCode,
            responseHeaders: headers,
            body
        }, () => {
            setPausedTraffic(null);
        });
    };

    const handleContinuePaused = () => {
        if (!pausedTraffic) return;
        chrome.runtime.sendMessage({
            type: 'CONTINUE_PAUSED_ITEM',
            tabId: pausedTraffic.tabId,
            requestId: pausedTraffic.requestId,
            isResponse: pausedTraffic.stage === 'response'
        }, () => {
            setPausedTraffic(null);
        });
    };

    const handleDropPaused = () => {
        if (!pausedTraffic) return;
        chrome.runtime.sendMessage({
            type: 'FAIL_PAUSED_ITEM',
            tabId: pausedTraffic.tabId,
            requestId: pausedTraffic.requestId
        }, () => {
            setPausedTraffic(null);
        });
    };

    // Actions
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

    const handleSend = async () => {
        if (!editorContent) return;
        setIsLoading(true);

        try {
            const response = await dispatchRequest(editorContent);
            setLatestResponse(response);
            setActiveTab('response');
        } catch (e) {
            console.error('Dispatch Failed:', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportHar = () => {
        chrome.runtime.sendMessage({ type: 'EXPORT_HAR', redact: true }, (res) => {
            if (res && res.harJson) {
                const blob = new Blob([res.harJson], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `requestal-session-${Date.now()}.har`;
                a.click();
                URL.revokeObjectURL(url);
            }
        });
    };

    const handleApplyProfile = (authString: string) => {
        if (!authString || !editorContent) return;
        const lines = editorContent.split('\n');
        const headerEndIdx = lines.findIndex(l => l.replace(/\r$/, '').trim() === '');
        const newLines = [...lines];

        const trimmed = authString.trim();

        if (trimmed.toLowerCase().startsWith('authorization:')) {
            const authIdx = newLines.findIndex(l => l.toLowerCase().startsWith('authorization:'));
            if (authIdx > -1) {
                newLines[authIdx] = trimmed;
            } else {
                const insertIdx = headerEndIdx > -1 ? headerEndIdx : 1;
                newLines.splice(insertIdx, 0, trimmed);
            }
        } else if (trimmed.toLowerCase().startsWith('bearer ') || trimmed.startsWith('eyJ')) {
            const authIdx = newLines.findIndex(l => l.toLowerCase().startsWith('authorization:'));
            const headerVal = trimmed.startsWith('eyJ') ? `Authorization: Bearer ${trimmed}` : `Authorization: ${trimmed}`;
            if (authIdx > -1) {
                newLines[authIdx] = headerVal;
            } else {
                const insertIdx = headerEndIdx > -1 ? headerEndIdx : 1;
                newLines.splice(insertIdx, 0, headerVal);
            }
        } else {
            // Treat as Cookie header
            const cookieVal = trimmed.toLowerCase().startsWith('cookie:') ? trimmed : `Cookie: ${trimmed}`;
            const cookieIdx = newLines.findIndex(l => l.toLowerCase().startsWith('cookie:'));
            if (cookieIdx > -1) {
                newLines[cookieIdx] = cookieVal;
            } else {
                const insertIdx = headerEndIdx > -1 ? headerEndIdx : 1;
                newLines.splice(insertIdx, 0, cookieVal);
            }
        }

        const updated = newLines.join('\n');
        setEditorContent(updated);
        updateSelectedBodyContent(updated);
    };

    const handleToggleMethod = () => {
        if (!editorContent) return;
        const updated = toggleRequestMethod(editorContent);
        setEditorContent(updated);
        updateSelectedBodyContent(updated);
    };

    // Derived Diff Text
    const selectedSummary = requests.find(r => r.id === selectedId);
    const showRequestDiff = activeTab === 'request' && baselineId !== null && selectedId !== null && !!baselineBody?.rawRequest;
    const originalReqText = showRequestDiff ? (smartDiffMode ? smartDiff(baselineBody?.rawRequest || '') : (baselineBody?.rawRequest || '')) : '';
    const modifiedReqText = showRequestDiff ? (smartDiffMode ? smartDiff(editorContent) : editorContent) : '';

    const getResponseText = (res: DispatchResponse | null) => {
        if (!res) return '';
        const headerString = Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
        return `HTTP/1.1 ${res.status} ${res.statusText}\r\n${headerString}\r\n\r\n${res.body}`;
    };

    const currentResponseText = useMemo(() => {
        if (latestResponse) {
            return getResponseText(latestResponse);
        }
        return selectedBody?.rawResponse || '';
    }, [latestResponse, selectedBody]);

    const showResponseDiff = activeTab === 'response' && baselineId !== null && !!currentResponseText && !!baselineBody?.rawResponse;
    const originalResText = showResponseDiff ? (baselineBody?.rawResponse || '') : '';
    const modifiedResText = showResponseDiff ? currentResponseText : '';

    const getMethodColor = (method: string) => {
        switch ((method || '').toUpperCase()) {
            case 'GET': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
            case 'POST': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
            case 'PUT': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
            case 'DELETE': return 'text-red-400 bg-red-400/10 border-red-400/20';
            default: return 'text-slate-300 bg-slate-500/10 border-slate-500/20';
        }
    };

    const getStatusColor = (status: number) => {
        if (status >= 500) return 'text-red-500';
        if (status >= 400) return 'text-amber-400';
        if (status >= 300) return 'text-blue-400';
        if (status >= 200) return 'text-emerald-400';
        return 'text-slate-500';
    };

    const isDirty = selectedBody && editorContent !== selectedBody.rawRequest;

    return (
        <ErrorBoundary fallbackTitle="Application Error">
            <div className="flex h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden font-sans select-none">
                {/* Resizable Sidebar */}
                <ResizableBox
                    width={sidebarWidth}
                    height={Infinity}
                    axis="x"
                    resizeHandles={['e']}
                    minConstraints={[240, Infinity]}
                    maxConstraints={[650, Infinity]}
                    onResizeStop={(_e, data) => setSidebarWidth(data.size.width)}
                    handle={<div className="react-resizable-handle react-resizable-handle-e group hover:bg-transparent"><div className="h-full w-[1px] bg-slate-800 group-hover:bg-blue-500 transition-colors mx-auto" /></div>}
                    className="flex-shrink-0 flex flex-col border-r border-slate-800 bg-slate-900/60 backdrop-blur-sm z-10"
                >
                    {/* Sidebar Header */}
                    <div className="p-3 border-b border-slate-800 space-y-2.5 bg-slate-900">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2 text-slate-100 font-semibold tracking-tight">
                                <div className="bg-blue-600/20 p-1 rounded text-blue-400">
                                    <Network size={15} />
                                </div>
                                <span className="text-sm">Requestal</span>
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">{requests.length}</span>
                            </div>

                            <div className="flex items-center space-x-1">
                                <button
                                    onClick={handleToggleProMode}
                                    className={clsx(
                                        'flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-all',
                                        proEngineActive
                                            ? 'bg-purple-600/20 text-purple-300 border-purple-500/40 shadow-sm'
                                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                                    )}
                                    title="Toggle Pro Mode (CDP Debugger Engine)"
                                >
                                    <Zap size={10} className={proEngineActive ? 'fill-current text-purple-400' : ''} />
                                    <span>{proEngineActive ? 'Pro (CDP)' : 'Pro'}</span>
                                </button>

                                <button
                                    onClick={handleToggleIntercept}
                                    className={clsx(
                                        'flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-all',
                                        isInterceptArmed
                                            ? 'bg-amber-600/20 text-amber-300 border-amber-500/40 shadow-sm animate-pulse'
                                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                                    )}
                                    title={isInterceptArmed ? 'Traffic Intercept Armed (Click to Disable)' : 'Arm Live Interception for Requests & Responses'}
                                >
                                    <Pause size={10} className={isInterceptArmed ? 'fill-current text-amber-400' : ''} />
                                    <span>{isInterceptArmed ? 'Intercept ON' : 'Intercept'}</span>
                                </button>

                                <button
                                    onClick={() => setIsScopeModalOpen(true)}
                                    className={clsx(
                                        'p-1.5 rounded transition-colors border',
                                        scopeEnabled
                                            ? 'bg-blue-600/20 text-blue-400 border-blue-500/30'
                                            : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-white'
                                    )}
                                    title="Target Scope Configuration"
                                >
                                    <Target size={13} />
                                </button>

                                <button
                                    onClick={handleExportHar}
                                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                                    title="Export Session as HAR 1.2"
                                >
                                    <Download size={13} />
                                </button>

                                <button
                                    onClick={clearAll}
                                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                    title="Clear Unpinned Requests"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>

                        {/* Search Filter */}
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                <Search size={12} className="text-slate-500" />
                            </div>
                            <input
                                type="text"
                                placeholder="Filter URL, host, method..."
                                value={filterQuery}
                                onChange={(e) => setFilterQuery(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded py-1.5 pl-8 pr-3 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                            />
                        </div>
                    </div>

                    {/* Virtualized Request List (§5.1) */}
                    <div ref={listParentRef} className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-slate-700/50 relative">
                        {requests.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-slate-600 text-xs">
                                <Filter size={24} className="mb-2 opacity-20" />
                                <p>No captured requests</p>
                            </div>
                        ) : filteredRequests.length === 0 ? (
                            <div className="p-4 text-xs text-slate-500 text-center">No matching requests</div>
                        ) : (
                            <div
                                style={{
                                    height: `${rowVirtualizer.getTotalSize()}px`,
                                    width: '100%',
                                    position: 'relative'
                                }}
                            >
                                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                    const r = filteredRequests[virtualRow.index];
                                    const isSelected = selectedId === r.id;
                                    const isPinned = baselineId === r.id || r.isPinned;

                                    return (
                                        <div
                                            key={r.id || virtualRow.index}
                                            onClick={() => r.id && selectRequest(r.id)}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                height: `${virtualRow.size}px`,
                                                transform: `translateY(${virtualRow.start}px)`
                                            }}
                                            className={clsx(
                                                'px-3 py-2 cursor-pointer border-b border-slate-800/40 hover:bg-slate-800/50 transition-colors flex flex-col justify-center relative',
                                                isSelected ? 'bg-blue-900/15' : ''
                                            )}
                                        >
                                            {isSelected && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-500 rounded-r" />}

                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center space-x-1.5 truncate">
                                                    <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded border leading-none tracking-wide font-mono', getMethodColor(r.method))}>
                                                        {r.method}
                                                    </span>
                                                    <span className={clsx('text-xs font-mono font-medium', getStatusColor(r.status))}>
                                                        {r.status || '...'}
                                                    </span>
                                                    <FidelityBadge fidelity={r.fidelity} notes={r.fidelityNotes} showLabel={false} />
                                                </div>

                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (r.id) {
                                                            if (isPinned) {
                                                                unpinBaseline();
                                                            } else {
                                                                pinBaseline(r.id);
                                                            }
                                                        }
                                                    }}
                                                    className={clsx(
                                                        'flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-all border',
                                                        isPinned
                                                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm opacity-100'
                                                            : 'bg-transparent text-slate-500 hover:text-amber-300 hover:bg-slate-800 border-transparent hover:border-slate-700 opacity-40 group-hover:opacity-100'
                                                    )}
                                                    title={isPinned ? '📌 Baseline Active (Click to Unpin)' : '📌 Pin as Baseline for Comparison/Diff'}
                                                >
                                                    <Pin size={11} className={isPinned ? 'fill-amber-400 text-amber-400' : ''} />
                                                    {isPinned && <span className="font-bold tracking-wider">PIN</span>}
                                                </button>
                                            </div>

                                            <div className="flex flex-col min-w-0">
                                                <span className={clsx('truncate text-xs font-medium', isSelected ? 'text-blue-100' : 'text-slate-300')}>
                                                    {r.url.split('/').pop()?.split('?')[0] || '/'}
                                                </span>
                                                <span className="truncate text-[10px] text-slate-500 font-mono">{r.host}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </ResizableBox>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
                    {/* Top Toolbar Container */}
                    <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900 z-30 overflow-visible relative">
                        {/* Main Action Bar */}
                        <div className="h-11 flex items-center justify-between px-2 sm:px-3 gap-1 sm:gap-2 overflow-visible">
                            {/* Left Controls Cluster */}
                            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 py-1 overflow-visible">
                                {/* Request / Response Tab Switcher */}
                                <div className="flex items-center bg-slate-950 rounded p-0.5 border border-slate-800 flex-shrink-0">
                                    <button
                                        onClick={() => setActiveTab('request')}
                                        className={clsx(
                                            'px-2.5 py-1 text-xs rounded font-medium transition-all flex items-center space-x-1',
                                            activeTab === 'request' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                                        )}
                                    >
                                        <FileText size={12} />
                                        <span>Request</span>
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('response')}
                                        className={clsx(
                                            'px-2.5 py-1 text-xs rounded font-medium transition-all flex items-center space-x-1 relative',
                                            activeTab === 'response' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                                        )}
                                    >
                                        <Server size={12} />
                                        <span>Response</span>
                                        {activeTab !== 'response' && latestResponse && (
                                            <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />
                                        )}
                                    </button>
                                </div>

                                {/* Feature Toggles */}
                                {activeTab === 'request' && (
                                    <>
                                        <div className="h-3.5 w-[1px] bg-slate-800 mx-0.5 flex-shrink-0" />
                                        <button
                                            onClick={() => setCleanMode(!cleanMode)}
                                            className={clsx(
                                                'p-1.5 rounded transition-all border flex-shrink-0',
                                                cleanMode ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                            )}
                                            title="Clean Mode (Strip telemetry & fingerprint headers)"
                                        >
                                            <Shield size={13} />
                                        </button>
                                        <button
                                            onClick={() => setFollowTraffic(!followTraffic)}
                                            className={clsx(
                                                'p-1.5 rounded transition-all border flex-shrink-0',
                                                followTraffic ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                            )}
                                            title="Follow Traffic (Auto-tail newest request)"
                                        >
                                            <Activity size={13} />
                                        </button>
                                        <button
                                            onClick={handleToggleMethod}
                                            className="p-1.5 rounded transition-all border flex-shrink-0 bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-cyan-300 hover:border-slate-600 active:scale-95"
                                            title="Change Request Method (Toggle POST <-> GET & sync body/query parameters)"
                                        >
                                            <ArrowLeftRight size={13} />
                                        </button>
                                    </>
                                )}

                                {/* Diff Mode Toggle */}
                                {(activeTab === 'request' ? showRequestDiff : showResponseDiff) && (
                                    <button
                                        onClick={() => setSmartDiffMode(!smartDiffMode)}
                                        className={clsx(
                                            'flex items-center space-x-1 text-xs px-2 py-1 rounded transition-all border flex-shrink-0',
                                            smartDiffMode ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                        )}
                                        title="Smart Diff (Mask timestamps & volatile headers)"
                                    >
                                        <Spline size={12} />
                                        <span className="hidden lg:inline text-[11px]">Diff</span>
                                    </button>
                                )}

                                {/* Dedicated Pin Baseline Button */}
                                {selectedId !== null && (
                                    <button
                                        onClick={() => {
                                            if (selectedId) {
                                                if (baselineId === selectedId) {
                                                    unpinBaseline();
                                                } else {
                                                    pinBaseline(selectedId);
                                                }
                                            }
                                        }}
                                        className={clsx(
                                            'flex items-center space-x-1 text-xs px-2 py-1 rounded transition-all border font-medium flex-shrink-0',
                                            baselineId === selectedId
                                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm shadow-amber-500/10'
                                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-amber-300 hover:border-slate-600'
                                        )}
                                        title={
                                            baselineId === selectedId
                                                ? '📌 Baseline Active (Click to Unpin)'
                                                : '📌 Pin as Baseline for Diff/Compare'
                                        }
                                    >
                                        <Pin size={12} className={clsx(baselineId === selectedId ? 'fill-amber-400 text-amber-400' : '')} />
                                        <span className="hidden xl:inline text-[11px]">{baselineId === selectedId ? 'Pinned' : 'Pin'}</span>
                                    </button>
                                )}

                                {/* Profile Switcher */}
                                <div className="flex-shrink-0">
                                    <ProfileSwitcher onApplyProfileToRequest={handleApplyProfile} />
                                </div>
                            </div>

                            {/* Right Action Buttons Cluster (Strictly Pinned with flex-shrink-0) */}
                            {activeTab === 'request' ? (
                                <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 ml-auto">
                                    <button
                                        onClick={() => setShowCommandPreview(!showCommandPreview)}
                                        className={clsx(
                                            'flex items-center text-xs px-2 py-1 rounded border transition-all flex-shrink-0',
                                            showCommandPreview
                                                ? 'bg-blue-600/20 text-blue-300 border-blue-500/30'
                                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                        )}
                                        title="Command Generator (ffuf, cURL, nuclei, sqlmap)"
                                    >
                                        <span className="font-mono text-[11px]">CLI</span>
                                    </button>

                                    <button
                                        onClick={handleSmartCopy}
                                        disabled={!!validationError}
                                        className={clsx(
                                            'flex items-center space-x-1 text-xs px-2.5 py-1 rounded font-medium border transition-all flex-shrink-0',
                                            copyStatus === 'copied' ? 'bg-emerald-600 text-white border-emerald-500' :
                                            copyStatus === 'error' ? 'bg-red-600 text-white border-red-500' :
                                            isDirty ? 'bg-blue-600/80 text-white border-blue-500 hover:bg-blue-600' :
                                            'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                        )}
                                        title={isDirty ? 'Copy modified HTTP request' : 'Copy original HTTP request'}
                                    >
                                        {copyStatus === 'copied' ? <Check size={12} /> : copyStatus === 'error' ? <AlertTriangle size={12} /> : <Copy size={12} />}
                                        <span className="hidden md:inline">{isDirty ? 'Copy New' : 'Copy'}</span>
                                    </button>

                                    <button
                                        onClick={handleSend}
                                        disabled={!!validationError || isLoading}
                                        className={clsx(
                                            'flex items-center space-x-1.5 text-xs px-3.5 py-1 rounded font-bold border transition-all shadow-md flex-shrink-0',
                                            isLoading
                                                ? 'bg-slate-700 text-slate-400 border-slate-600 cursor-wait'
                                                : 'bg-blue-500 text-white border-blue-400 hover:bg-blue-400 shadow-blue-500/20'
                                        )}
                                    >
                                        {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
                                        <span>Send</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center space-x-2 flex-shrink-0 ml-auto">
                                    {currentResponseText ? (
                                        <div className="flex items-center space-x-1.5 px-2 py-0.5 bg-slate-900 border border-slate-800 rounded font-mono text-[11px]">
                                            <span className={clsx('font-bold', getStatusColor(latestResponse ? latestResponse.status : (selectedSummary?.status || 200)))}>
                                                {latestResponse
                                                    ? `${latestResponse.status} ${latestResponse.statusText}`
                                                    : (selectedSummary?.status ? `${selectedSummary.status} ${selectedSummary.statusText || 'OK'}` : '200 OK')}
                                            </span>
                                            {latestResponse && (
                                                <>
                                                    <span className="text-slate-600">|</span>
                                                    <span className="text-slate-400">{latestResponse.timeMs}ms</span>
                                                    {latestResponse.isTruncated && (
                                                        <span className="text-[10px] text-amber-400">(Truncated)</span>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>

                        {/* Secondary Context & Warning Sub-Strip (Only renders when needed) */}
                        {(detectedSecrets.length > 0 || validationError || formatWarning || (baselineId !== null && baselineId !== selectedId)) && (
                            <div className="min-h-6 bg-slate-950/90 border-t border-slate-800/60 px-3 py-0.5 flex items-center flex-wrap gap-2 text-[11px] z-10">
                                {detectedSecrets.length > 0 && (
                                    <div className="flex items-center space-x-1 text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                                        <AlertTriangle size={11} />
                                        <span>Secret Found ({detectedSecrets.length})</span>
                                    </div>
                                )}

                                {validationError && (
                                    <div className="flex items-center space-x-1 text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                                        <AlertTriangle size={11} />
                                        <span>{validationError}</span>
                                    </div>
                                )}

                                {!validationError && formatWarning && (
                                    <div className="flex items-center space-x-1 text-amber-400">
                                        <AlertTriangle size={11} />
                                        <span>{formatWarning}</span>
                                    </div>
                                )}

                                {baselineId !== null && baselineId !== selectedId && (
                                    <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono">
                                        <Pin size={10} className="fill-amber-400 text-amber-400" />
                                        <span>Diff vs #{baselineId}</span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                unpinBaseline();
                                            }}
                                            className="hover:text-white ml-1 font-bold px-0.5 text-slate-400 hover:text-white"
                                            title="Unpin Baseline"
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Command Preview Drawer */}
                    {showCommandPreview && (
                        <div className="p-3 bg-slate-900 border-b border-slate-800 z-20">
                            <CommandPreview
                                rawRequest={editorContent}
                                url={
                                    selectedSummary?.url ||
                                    (() => {
                                        if (!editorContent) return 'https://target/';
                                        const lines = editorContent.split('\n');
                                        const firstLine = lines[0] || '';
                                        const parts = firstLine.trim().split(/\s+/);
                                        const path = parts.length > 1 ? parts[1] : '/';
                                        if (path.startsWith('http://') || path.startsWith('https://')) return path;
                                        const hostLine = lines.find(l => l.toLowerCase().startsWith('host:'));
                                        const host = hostLine ? hostLine.split(':')[1]?.trim() : 'localhost';
                                        return `https://${host}${path.startsWith('/') ? path : '/' + path}`;
                                    })()
                                }
                            />
                        </div>
                    )}

                    {/* §7.4 — Initiator / Call-Stack Tracing (Pro Mode) */}
                    {selectedSummary?.initiator && proEngineActive && (
                        <div className="px-4 py-1.5 border-b border-slate-800 bg-slate-900/60 flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
                            <span className="text-purple-400 font-semibold">Initiator:</span>
                            <span className="text-slate-300">
                                {typeof selectedSummary.initiator === 'string'
                                    ? selectedSummary.initiator
                                    : selectedSummary.initiator?.url
                                        ? `${selectedSummary.initiator.url}${selectedSummary.initiator.lineNumber ? ':' + selectedSummary.initiator.lineNumber : ''}`
                                        : selectedSummary.initiator?.type || 'unknown'}
                            </span>
                        </div>
                    )}

                    {/* Live Traffic Interception Banner & Actions */}
                    {pausedTraffic && (
                        <InterceptBar
                            pausedItem={pausedTraffic}
                            editorContent={editorContent}
                            onFulfill={handleFulfillPaused}
                            onContinue={handleContinuePaused}
                            onDrop={handleDropPaused}
                        />
                    )}

                    {/* Editor Content Area */}
                    <div className="flex-1 overflow-hidden bg-slate-950 relative">
                        {selectedId === null && !pausedTraffic ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-700 p-8 text-center">
                                <div className="bg-slate-900 rounded-full p-6 mb-4 shadow-xl border border-slate-800">
                                    <Network size={44} className="text-slate-600" />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-400 mb-1">Requestal V2 Ready</h3>
                                <p className="text-sm text-slate-600 max-w-xs">
                                    Select or capture a request from the sidebar to inspect, modify, and fuzz.
                                </p>
                            </div>
                        ) : pausedTraffic ? (
                            <div className="h-full w-full relative">
                                <RequestEditor
                                    value={editorContent}
                                    onChange={(val) => {
                                        setEditorContent(val || '');
                                    }}
                                />
                            </div>
                        ) : activeTab === 'request' ? (
                            <div className="h-full w-full relative">
                                {showRequestDiff ? (
                                    <RequestDiffEditor original={originalReqText} modified={modifiedReqText} />
                                ) : (
                                    <RequestEditor
                                        value={editorContent}
                                        onChange={(val) => {
                                             const updated = val || '';
                                             setEditorContent(updated);
                                             updateSelectedBodyContent(updated);
                                        }}
                                    />
                                )}
                            </div>
                        ) : (
                            <div className="h-full w-full relative">
                                {currentResponseText ? (
                                    showResponseDiff ? (
                                        <RequestDiffEditor original={originalResText} modified={modifiedResText} />
                                    ) : (
                                        <RequestEditor
                                            value={currentResponseText}
                                            onChange={() => {}}
                                        />
                                    )
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-700">
                                        <Server size={32} className="mb-2 opacity-50" />
                                        <p className="text-sm">No response data available.</p>
                                        <button
                                            onClick={() => setActiveTab('request')}
                                            className="mt-2 text-blue-400 hover:underline text-xs"
                                        >
                                            Go to Request & click Send
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Modals */}
                <ScopeModal isOpen={isScopeModalOpen} onClose={() => setIsScopeModalOpen(false)} />
            </div>
        </ErrorBoundary>
    );
}

export default App;
