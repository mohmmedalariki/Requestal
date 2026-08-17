import { create } from 'zustand';
import { db, getRequestBody, togglePinRequest, clearUnpinnedRequests, type RequestSummary, type RequestBodyRecord } from '../../core/storage/db';
import { searchIndex } from '../../core/search/searchIndex';
import { isUrlInScope } from '../../core/scope/matcher';
import { useScopeStore } from './useScopeStore';

export interface CaptureStore {
    requests: RequestSummary[];
    selectedId: number | null;
    selectedBody: RequestBodyRecord | null;
    baselineId: number | null;
    baselineSummary: RequestSummary | null;
    baselineBody: RequestBodyRecord | null;
    filterQuery: string;
    followTraffic: boolean;
    isLoadingBody: boolean;

    // Actions
    initStore: () => Promise<void>;
    addIncomingRequests: (items: RequestSummary[]) => void;
    selectRequest: (id: number | null) => Promise<void>;
    setFilterQuery: (query: string) => void;
    setFollowTraffic: (follow: boolean) => void;
    pinBaseline: (id: number) => Promise<void>;
    unpinBaseline: () => void;
    clearAll: () => Promise<void>;
    updateSelectedBodyContent: (rawRequest: string) => void;
}

export const useCaptureStore = create<CaptureStore>((set, get) => ({
    requests: [],
    selectedId: null,
    selectedBody: null,
    baselineId: null,
    baselineSummary: null,
    baselineBody: null,
    filterQuery: '',
    followTraffic: false,
    isLoadingBody: false,

    initStore: async () => {
        const stored = await db.requests.orderBy('timestamp').toArray();
        searchIndex.indexRequests(stored);

        // Check if there is a pinned baseline
        const pinned = stored.find(s => s.isPinned);
        let baselineBody: RequestBodyRecord | null = null;
        if (pinned && pinned.id) {
            const b = await getRequestBody(pinned.id);
            baselineBody = b || null;
        }

        set({
            requests: stored,
            baselineId: pinned?.id || null,
            baselineSummary: pinned || null,
            baselineBody
        });

        // Auto-select latest if requests exist
        if (stored.length > 0) {
            const latest = stored[stored.length - 1];
            if (latest.id) {
                get().selectRequest(latest.id);
            }
        }
    },

    addIncomingRequests: (items: RequestSummary[]) => {
        const { scopeEnabled, includeRules, excludeRules } = useScopeStore.getState();

        // Scope filter
        const valid = items.filter(item => isUrlInScope(item.url, includeRules, excludeRules, scopeEnabled));
        if (valid.length === 0) return;

        valid.forEach(item => searchIndex.addRequest(item));

        set(state => {
            const updated = [...state.requests, ...valid];
            const shouldFollow = state.followTraffic && valid.length > 0;

            if (shouldFollow) {
                const latestId = valid[valid.length - 1].id;
                if (latestId) {
                    setTimeout(() => get().selectRequest(latestId), 0);
                }
            }

            return { requests: updated };
        });
    },

    selectRequest: async (id: number | null) => {
        if (id === null) {
            set({ selectedId: null, selectedBody: null });
            return;
        }

        set({ selectedId: id, isLoadingBody: true });
        const bodyRecord = await getRequestBody(id);
        set({
            selectedBody: bodyRecord || { id, rawRequest: '', rawResponse: '' },
            isLoadingBody: false
        });
    },

    setFilterQuery: (query: string) => {
        set({ filterQuery: query });
    },

    setFollowTraffic: (followTraffic: boolean) => {
        set({ followTraffic });
    },

    pinBaseline: async (id: number) => {
        const summary = get().requests.find(r => r.id === id);
        if (!summary) return;

        // Unpin previous
        const currentPin = get().baselineId;
        if (currentPin && currentPin !== id) {
            await togglePinRequest(currentPin, false);
        }

        await togglePinRequest(id, true);
        const bodyRecord = await getRequestBody(id);

        set(state => ({
            baselineId: id,
            baselineSummary: { ...summary, isPinned: true },
            baselineBody: bodyRecord || null,
            requests: state.requests.map(r => r.id === id ? { ...r, isPinned: true } : (r.id === currentPin ? { ...r, isPinned: false } : r))
        }));
    },

    unpinBaseline: () => {
        const currentPin = get().baselineId;
        if (currentPin) {
            togglePinRequest(currentPin, false);
        }
        set(state => ({
            baselineId: null,
            baselineSummary: null,
            baselineBody: null,
            requests: state.requests.map(r => r.id === currentPin ? { ...r, isPinned: false } : r)
        }));
    },

    clearAll: async () => {
        await clearUnpinnedRequests();
        searchIndex.clear();
        const remaining = await db.requests.toArray();
        searchIndex.indexRequests(remaining);
        set({
            requests: remaining,
            selectedId: remaining.length > 0 ? remaining[0].id || null : null,
            selectedBody: null
        });
    },

    updateSelectedBodyContent: (rawRequest: string) => {
        set(state => {
            if (!state.selectedBody) return state;
            return {
                selectedBody: {
                    ...state.selectedBody,
                    rawRequest
                }
            };
        });
    }
}));
