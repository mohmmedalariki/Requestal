import { create } from 'zustand';

export interface ScopeStore {
    includeRules: string[];
    excludeRules: string[];
    scopeEnabled: boolean;
    setScopeEnabled: (enabled: boolean) => void;
    addIncludeRule: (rule: string) => void;
    removeIncludeRule: (index: number) => void;
    addExcludeRule: (rule: string) => void;
    removeExcludeRule: (index: number) => void;
}

const SCOPE_STORAGE_KEY = 'requestal_scope_rules';

function loadInitialScope() {
    try {
        const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        // Fallthrough
    }
    return {
        includeRules: [],
        excludeRules: [],
        scopeEnabled: false
    };
}

export const useScopeStore = create<ScopeStore>((set, get) => {
    const initial = loadInitialScope();

    const persist = () => {
        const { includeRules, excludeRules, scopeEnabled } = get();
        localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify({ includeRules, excludeRules, scopeEnabled }));
    };

    return {
        includeRules: initial.includeRules,
        excludeRules: initial.excludeRules,
        scopeEnabled: initial.scopeEnabled,

        setScopeEnabled: (enabled) => {
            set({ scopeEnabled: enabled });
            persist();
        },

        addIncludeRule: (rule) => {
            if (!rule.trim()) return;
            set(state => ({ includeRules: [...state.includeRules, rule.trim()] }));
            persist();
        },

        removeIncludeRule: (index) => {
            set(state => ({ includeRules: state.includeRules.filter((_, i) => i !== index) }));
            persist();
        },

        addExcludeRule: (rule) => {
            if (!rule.trim()) return;
            set(state => ({ excludeRules: [...state.excludeRules, rule.trim()] }));
            persist();
        },

        removeExcludeRule: (index) => {
            set(state => ({ excludeRules: state.excludeRules.filter((_, i) => i !== index) }));
            persist();
        }
    };
});
