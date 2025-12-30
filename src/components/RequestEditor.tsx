import React, { useRef } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';

interface Props {
    value: string;
    onChange: (value: string | undefined) => void;
    language?: string;
    theme?: string;
}

export const RequestEditor: React.FC<Props> = ({ value, onChange, language = "http", theme = "vs-dark" }) => {
    const editorRef = useRef<any>(null);

    function handleEditorDidMount(editor: any, monaco: Monaco) {
        editorRef.current = editor;

        // Add "Inject FUZZ" action
        editor.addAction({
            id: 'inject-fuzz',
            label: 'Smart Inject FUZZ',
            keybindings: [
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI
            ],
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.5,
            run: function (ed: any) {
                const selection = ed.getSelection();
                if (selection) {
                    const op = { range: selection, text: "FUZZ", forceMoveMarkers: true };
                    ed.executeEdits("smart-inject", [op]);
                }
            }
        });
    }

    return (
        <Editor
            height="100%"
            defaultLanguage={language}
            theme={theme} // "vs-dark" matches the requirement for high-performance/dev look
            value={value}
            onChange={onChange}
            onMount={handleEditorDidMount}
            options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                fontFamily: "'Fira Code', 'Menlo', 'Monaco', 'Courier New', monospace",
                fontSize: 13,
            }}
        />
    );
};
