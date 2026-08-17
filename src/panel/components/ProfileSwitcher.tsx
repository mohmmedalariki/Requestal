import React, { useState } from 'react';
import { useProfileStore } from '../stores/useProfileStore';
import { UserCheck, Plus, Trash2, X, Shield } from 'lucide-react';
import clsx from 'clsx';

interface Props {
    onApplyProfileToRequest?: (cookies: string, headers: Record<string, string>) => void;
}

export const ProfileSwitcher: React.FC<Props> = ({ onApplyProfileToRequest }) => {
    const { profiles, activeProfileId, addProfile, deleteProfile, setActiveProfile } = useProfileStore();
    const [isOpen, setIsOpen] = useState(false);
    const [newProfileName, setNewProfileName] = useState('');
    const [newCookies, setNewCookies] = useState('');

    const activeProfile = profiles.find(p => p.id === activeProfileId);

    const handleCreateProfile = (e: React.FormEvent) => {
        e.preventDefault();
        if (newProfileName.trim()) {
            addProfile(newProfileName.trim(), newCookies.trim());
            setNewProfileName('');
            setNewCookies('');
        }
    };

    const handleSelectProfile = (id: string) => {
        const target = profiles.find(p => p.id === id);
        setActiveProfile(id === activeProfileId ? null : id);
        if (target && onApplyProfileToRequest) {
            onApplyProfileToRequest(target.cookies, target.headers);
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={clsx(
                    'flex items-center space-x-1 text-xs px-2 py-1 rounded border transition-all flex-shrink-0',
                    activeProfile
                        ? 'bg-purple-600/10 text-purple-400 border-purple-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                )}
                title={activeProfile ? `Active Profile: ${activeProfile.name}` : "Multi-Account IDOR Profile Switcher"}
            >
                <UserCheck size={12} />
                <span className="max-w-[65px] lg:max-w-[100px] truncate text-[11px] hidden sm:inline">{activeProfile ? activeProfile.name : 'Auth'}</span>
            </button>

            {isOpen && (
                <>
                    {/* Backdrop to capture clicks outside */}
                    <div 
                        className="fixed inset-0 z-40 bg-transparent" 
                        onClick={() => setIsOpen(false)} 
                    />
                    <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl z-50 p-3 text-xs space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <span className="font-semibold text-slate-200 flex items-center space-x-1">
                                <Shield size={12} className="text-purple-400" />
                                <span>Auth Profiles (IDOR Testing)</span>
                            </span>
                            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white">
                                <X size={14} />
                            </button>
                        </div>

                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {profiles.map(profile => (
                                <div
                                    key={profile.id}
                                    className={clsx(
                                        'flex items-center justify-between p-2 rounded border cursor-pointer transition-all',
                                        activeProfileId === profile.id
                                            ? 'bg-purple-900/20 border-purple-500/50 text-purple-200'
                                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                                    )}
                                    onClick={() => handleSelectProfile(profile.id)}
                                >
                                    <div className="flex items-center space-x-2 truncate">
                                        <div
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: profile.color }}
                                        />
                                        <span className="font-medium truncate">{profile.name}</span>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteProfile(profile.id);
                                        }}
                                        className="text-slate-500 hover:text-red-400 p-1"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <form onSubmit={handleCreateProfile} className="space-y-2 border-t border-slate-800 pt-2">
                            <input
                                type="text"
                                placeholder="Profile Name (e.g. Victim Account)"
                                value={newProfileName}
                                onChange={(e) => setNewProfileName(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                            />
                            <textarea
                                placeholder="Cookie header or session token"
                                value={newCookies}
                                onChange={(e) => setNewCookies(e.target.value)}
                                rows={2}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                            />
                            <button
                                type="submit"
                                className="w-full py-1 bg-purple-600 hover:bg-purple-500 text-white rounded font-medium flex items-center justify-center space-x-1"
                            >
                                <Plus size={12} />
                                <span>Add Auth Profile</span>
                            </button>
                        </form>
                    </div>
                </>
            )}
        </div>
    );
};
