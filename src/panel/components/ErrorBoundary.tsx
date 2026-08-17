import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallbackTitle?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[Requestal ErrorBoundary] Caught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-slate-950 text-slate-300">
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-full mb-3 text-red-400">
                        <AlertTriangle size={24} />
                    </div>
                    <h4 className="text-sm font-semibold text-slate-200 mb-1">
                        {this.props.fallbackTitle || 'Rendering Error Encountered'}
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mb-4 font-mono">
                        {this.state.error?.message || 'An unexpected rendering error occurred.'}
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="flex items-center space-x-1.5 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors"
                    >
                        <RefreshCw size={12} />
                        <span>Try Again</span>
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
