import React, { useState } from 'react';
import { useScopeStore } from '../stores/useScopeStore';
import { X, Plus, Trash2, Shield, Target } from 'lucide-react';
import clsx from 'clsx';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const ScopeModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const {
        includeRules,
        excludeRules,
        scopeEnabled,
        setScopeEnabled,
        addIncludeRule,
        removeIncludeRule,
        addExcludeRule,
        removeExcludeRule
    } = useScopeStore();

    const [newInclude, setNewInclude] = useState('');
    const [newExclude, setNewExclude] = useState('');

    if (!isOpen) return null;

    const handleAddInclude = (e: React.FormEvent) => {
        e.preventDefault();
        if (newInclude.trim()) {
            addIncludeRule(newInclude.trim());
            setNewInclude('');
        }
    };

    const handleAddExclude = (e: React.FormEvent) => {
        e.preventDefault();
        if (newExclude.trim()) {
            addExcludeRule(newExclude.trim());
            setNewExclude('');
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950">
                    <div className="flex items-center space-x-2 text-slate-100 font-semibold text-sm">
                        <Target size={16} className="text-blue-400" />
                        <span>Target Scope Configuration</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 overflow-y-auto space-y-4 text-xs">
                    {/* Toggle Scope */}
                    <div className="flex items-center justify-between p-3 bg-slate-950 rounded border border-slate-800">
                        <div className="space-y-0.5">
                            <span className="font-semibold text-slate-200">Enable Scope Filtering</span>
                            <p className="text-[11px] text-slate-400">
                                Restrict request logging & persistence to matched targets only.
                            </p>
                        </div>
                        <button
                            onClick={() => setScopeEnabled(!scopeEnabled)}
                            className={clsx(
                                'px-3 py-1 rounded text-xs font-semibold border transition-all',
                                scopeEnabled
                                    ? 'bg-blue-600 text-white border-blue-500'
                                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                            )}
                        >
                            {scopeEnabled ? 'Scope Active' : 'Disabled'}
                        </button>
                    </div>

                    {/* Include Rules */}
                    <div className="space-y-2">
                        <span className="font-semibold text-slate-300 flex items-center space-x-1">
                            <Shield size={12} className="text-emerald-400" />
                            <span>Include Patterns (e.g. *.target.com)</span>
                        </span>
                        <form onSubmit={handleAddInclude} className="flex space-x-2">
                            <input
                                type="text"
                                placeholder="*.target.com or api.target.com/*"
                                value={newInclude}
                                onChange={(e) => setNewInclude(e.target.value)}
                                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                            />
                            <button
                                type="submit"
                                className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium flex items-center space-x-1"
                            >
                                <Plus size={14} />
                                <span>Add</span>
                            </button>
                        </form>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                            {includeRules.length === 0 ? (
                                <p className="text-slate-500 italic text-[11px]">No include patterns defined (captures all non-excluded traffic).</p>
                            ) : (
                                includeRules.map((rule, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-2.5 py-1 bg-slate-950 rounded border border-slate-800">
                                        <span className="font-mono text-emerald-400">{rule}</span>
                                        <button onClick={() => removeIncludeRule(idx)} className="text-slate-500 hover:text-red-400"><Trash2 size={12} /></button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Exclude Rules */}
                    <div className="space-y-2">
                        <span className="font-semibold text-slate-300 flex items-center space-x-1">
                            <Shield size={12} className="text-red-400" />
                            <span>Exclude Patterns (e.g. *.google.com, *.target.com/health)</span>
                        </span>
                        <form onSubmit={handleAddExclude} className="flex space-x-2">
                            <input
                                type="text"
                                placeholder="*.analytics.com or *.target.com/static/*"
                                value={newExclude}
                                onChange={(e) => setNewExclude(e.target.value)}
                                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                            />
                            <button
                                type="submit"
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium flex items-center space-x-1 border border-slate-700"
                            >
                                <Plus size={14} />
                                <span>Add</span>
                            </button>
                        </form>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                            {excludeRules.length === 0 ? (
                                <p className="text-slate-500 italic text-[11px]">No exclude patterns defined.</p>
                            ) : (
                                excludeRules.map((rule, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-2.5 py-1 bg-slate-950 rounded border border-slate-800">
                                        <span className="font-mono text-red-400">{rule}</span>
                                        <button onClick={() => removeExcludeRule(idx)} className="text-slate-500 hover:text-red-400"><Trash2 size={12} /></button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-950 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-xs border border-slate-700"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
