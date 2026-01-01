import React, { useRef } from 'react';
import { DiffEditor, type Monaco } from '@monaco-editor/react';

interface Props {
    original: string; // Baseline
    modified: string; // Current Comparison
    theme?: string;
}

export const RequestDiffEditor: React.FC<Props> = ({ original, modified, theme = "vs-dark" }) => {
    const diffEditorRef = useRef<any>(null);

    function handleEditorDidMount(editor: any, _monaco: Monaco) {
        diffEditorRef.current = editor;
    }

    return (
        <DiffEditor
            height="100%"
            original={original}
            modified={modified}
            language="http"
            theme={theme}
            onMount={handleEditorDidMount}
            options={{
                originalEditable: false, // Baseline should be read-only in diff view
                readOnly: true,         // Comparison also read-only in diff view? Or editable? Usually diff is read-only
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                fontFamily: "'Fira Code', 'Menlo', 'Monaco', 'Courier New', monospace",
                fontSize: 13,
                diffWordWrap: 'on'
            }}
        />
    );
};
