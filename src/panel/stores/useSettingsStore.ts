import { create } from 'zustand';

export interface SettingsStore {
    cleanMode: boolean;
    smartDiffMode: boolean;
    smartFormatMode: boolean;
    structuralDiffMode: boolean;
    proEngineActive: boolean;
    sidebarWidth: number;
    activeTab: 'request' | 'response';
    setCleanMode: (val: boolean) => void;
    setSmartDiffMode: (val: boolean) => void;
    setSmartFormatMode: (val: boolean) => void;
    setStructuralDiffMode: (val: boolean) => void;
    setProEngineActive: (val: boolean) => void;
    setSidebarWidth: (width: number) => void;
    setActiveTab: (tab: 'request' | 'response') => void;
}

const SETTINGS_STORAGE_KEY = 'requestal_settings_v2';

function loadInitialSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        // Fallthrough
    }
    return {
        cleanMode: false,
        smartDiffMode: false,
        smartFormatMode: true,
        structuralDiffMode: false,
        proEngineActive: false,
        sidebarWidth: 320,
        activeTab: 'request'
    };
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
    const initial = loadInitialSettings();

    const persist = () => {
        const state = get();
        localStorage.setItem(
            SETTINGS_STORAGE_KEY,
            JSON.stringify({
                cleanMode: state.cleanMode,
                smartDiffMode: state.smartDiffMode,
                smartFormatMode: state.smartFormatMode,
                structuralDiffMode: state.structuralDiffMode,
                proEngineActive: state.proEngineActive,
                sidebarWidth: state.sidebarWidth
            })
        );
    };

    return {
        cleanMode: initial.cleanMode ?? false,
        smartDiffMode: initial.smartDiffMode ?? false,
        smartFormatMode: initial.smartFormatMode ?? true,
        structuralDiffMode: initial.structuralDiffMode ?? false,
        proEngineActive: initial.proEngineActive ?? false,
        sidebarWidth: initial.sidebarWidth ?? 320,
        activeTab: 'request',

        setCleanMode: (cleanMode) => { set({ cleanMode }); persist(); },
        setSmartDiffMode: (smartDiffMode) => { set({ smartDiffMode }); persist(); },
        setSmartFormatMode: (smartFormatMode) => { set({ smartFormatMode }); persist(); },
        setStructuralDiffMode: (structuralDiffMode) => { set({ structuralDiffMode }); persist(); },
        setProEngineActive: (proEngineActive) => { set({ proEngineActive }); persist(); },
        setSidebarWidth: (sidebarWidth) => { set({ sidebarWidth }); persist(); },
        setActiveTab: (activeTab) => set({ activeTab })
    };
});
