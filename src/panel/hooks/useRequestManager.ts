
import { useState, useRef, useEffect } from 'react';
import { saveBaseline, getBaseline, clearBaseline } from '../../core/storage';
import { harToRaw } from '../../shared/utils/http';

export function useRequestManager(cleanMode: boolean) {
    const [requests, setRequests] = useState<any[]>([]);
    const [selectedIdx, setSelectedIdx] = useState<number>(-1);
    const [filterQuery, setFilterQuery] = useState('');
    const [followTraffic, setFollowTraffic] = useState(false);

    // Baseline State
    const [baselineRequest, setBaselineRequest] = useState<any | null>(null);
    const [baselineResponse, setBaselineResponse] = useState<any | null>(null);
    const [baselineRaw, setBaselineRaw] = useState<string>('');

    const followTrafficRef = useRef(followTraffic);
    followTrafficRef.current = followTraffic;

    // Load initial baseline
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

    // Update baseline raw representation when clean mode toggles
    useEffect(() => {
        if (baselineRequest) {
            setBaselineRaw(harToRaw(baselineRequest, cleanMode));
        }
    }, [cleanMode, baselineRequest]);

    // Listen for new requests
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

    const handlePin = (req: any, latestResponseForReq: any | null, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setBaselineRequest(req);

        // If the pinned request is the one currently selected, pin its response too
        setBaselineResponse(latestResponseForReq);
        saveBaseline(req, latestResponseForReq);
    };

    const handleUnpin = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setBaselineRequest(null);
        setBaselineResponse(null);
        clearBaseline();
    };

    const handleClear = () => {
        setRequests([]);
        setSelectedIdx(-1);
    };

    const filteredRequests = requests.map((r, i) => ({ r, i })).filter(({ r }) => {
        if (!filterQuery) return true;
        const q = filterQuery.toLowerCase();
        try {
            return (r.request.url || "").toLowerCase().includes(q) ||
                (r.request.method || "").toLowerCase().includes(q);
        } catch {
            return false;
        }
    });

    return {
        requests,
        selectedIdx,
        setSelectedIdx,
        filterQuery,
        setFilterQuery,
        followTraffic,
        setFollowTraffic,
        baselineRequest,
        baselineResponse,
        baselineRaw,
        handlePin,
        handleUnpin,
        handleClear,
        filteredRequests
    };
}
