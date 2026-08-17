import { create } from 'zustand';

export interface AuthProfile {
    id: string;
    name: string;
    cookies: string;
    headers: Record<string, string>;
    color: string;
}

export interface ProfileStore {
    profiles: AuthProfile[];
    activeProfileId: string | null;
    addProfile: (name: string, cookies?: string, headers?: Record<string, string>) => void;
    updateProfile: (id: string, updates: Partial<AuthProfile>) => void;
    deleteProfile: (id: string) => void;
    setActiveProfile: (id: string | null) => void;
}

const PROFILES_STORAGE_KEY = 'requestal_auth_profiles';

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function loadInitialProfiles(): AuthProfile[] {
    try {
        const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        // Fallthrough
    }
    return [
        { id: 'profile-a', name: 'Account A (Admin)', cookies: '', headers: {}, color: '#3b82f6' },
        { id: 'profile-b', name: 'Account B (Victim)', cookies: '', headers: {}, color: '#10b981' }
    ];
}

export const useProfileStore = create<ProfileStore>((set, get) => {
    const initialProfiles = loadInitialProfiles();

    const persist = () => {
        localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(get().profiles));
    };

    return {
        profiles: initialProfiles,
        activeProfileId: null,

        addProfile: (name, cookies = '', headers = {}) => {
            const id = `profile-${Date.now()}`;
            const color = DEFAULT_COLORS[get().profiles.length % DEFAULT_COLORS.length];
            set(state => ({
                profiles: [...state.profiles, { id, name, cookies, headers, color }]
            }));
            persist();
        },

        updateProfile: (id, updates) => {
            set(state => ({
                profiles: state.profiles.map(p => p.id === id ? { ...p, ...updates } : p)
            }));
            persist();
        },

        deleteProfile: (id) => {
            set(state => ({
                profiles: state.profiles.filter(p => p.id !== id),
                activeProfileId: state.activeProfileId === id ? null : state.activeProfileId
            }));
            persist();
        },

        setActiveProfile: (id) => {
            set({ activeProfileId: id });
        }
    };
});
