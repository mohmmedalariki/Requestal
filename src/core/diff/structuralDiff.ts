import * as jsondiffpatch from 'jsondiffpatch';

const differ = jsondiffpatch.create({
    objectHash: function (obj: any, index?: number) {
        if (!obj || typeof obj !== 'object') return `$$primitive:${String(obj)}`;
        return obj._id || obj.id || obj.name || `$$index:${index ?? 0}`;
    },
    arrays: {
        detectMove: true,
        includeValueOnMove: false
    }
});

export interface StructuralDiffResult {
    isJson: boolean;
    delta: any | undefined;
    summary: {
        added: number;
        removed: number;
        modified: number;
    };
    formattedText: string;
}

export function computeStructuralDiff(leftJsonStr: string, rightJsonStr: string): StructuralDiffResult {
    let leftObj: any;
    let rightObj: any;

    try {
        leftObj = JSON.parse(leftJsonStr);
        rightObj = JSON.parse(rightJsonStr);
    } catch {
        return {
            isJson: false,
            delta: undefined,
            summary: { added: 0, removed: 0, modified: 0 },
            formattedText: 'Non-JSON content: Structural diff unavailable.'
        };
    }

    const delta = differ.diff(leftObj, rightObj);

    if (!delta) {
        return {
            isJson: true,
            delta: undefined,
            summary: { added: 0, removed: 0, modified: 0 },
            formattedText: 'No structural differences detected (JSON bodies are identical in structure and values).'
        };
    }

    // Count changes
    let added = 0;
    let removed = 0;
    let modified = 0;

    function countChanges(d: any) {
        if (!d || typeof d !== 'object') return;
        if (Array.isArray(d)) {
            if (d.length === 1) added++;
            else if (d.length === 2) modified++;
            else if (d.length === 3 && d[2] === 0) removed++;
            return;
        }
        for (const key of Object.keys(d)) {
            if (key !== '_t') {
                countChanges(d[key]);
            }
        }
    }

    countChanges(delta);

    return {
        isJson: true,
        delta,
        summary: { added, removed, modified },
        formattedText: JSON.stringify(delta, null, 2)
    };
}
