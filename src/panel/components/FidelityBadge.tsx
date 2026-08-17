import React from 'react';
import type { FidelityType } from '../../shared/utils/http';
import clsx from 'clsx';
import { ShieldCheck, ShieldAlert, AlertCircle } from 'lucide-react';

interface Props {
    fidelity: FidelityType;
    notes?: string[];
    className?: string;
    showLabel?: boolean;
}

export const FidelityBadge: React.FC<Props> = ({
    fidelity,
    notes = [],
    className,
    showLabel = true
}) => {
    let colorClasses = '';
    let label = '';
    let Icon = ShieldCheck;
    let tooltip = '';

    switch (fidelity) {
        case 'full':
            colorClasses = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
            label = 'Full (Wire)';
            Icon = ShieldCheck;
            tooltip = 'Captured with Pro Mode (CDP) — Full wire headers & organic response body present.';
            break;
        case 'partial':
            colorClasses = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
            label = 'Standard';
            Icon = ShieldAlert;
            tooltip = 'Captured via Standard Engine — Cookie/Referer/Origin present; Category B headers (Connection, Cache-Control) withheld by Chrome webRequest.';
            break;
        case 'reconstructed':
            colorClasses = 'bg-orange-500/10 text-orange-400 border-orange-500/30';
            label = 'Reconstructed';
            Icon = AlertCircle;
            tooltip = 'Body reconstructed from formData dictionary; parameter order is not guaranteed.';
            break;
    }

    if (notes.length > 0) {
        tooltip += '\n\n' + notes.join('\n');
    }

    return (
        <div
            className={clsx(
                'inline-flex items-center space-x-1 px-1.5 py-0.5 rounded border text-[10px] font-mono leading-none tracking-tight transition-all',
                colorClasses,
                className
            )}
            title={tooltip}
        >
            <Icon size={11} className="shrink-0" />
            {showLabel && <span>{label}</span>}
        </div>
    );
};
