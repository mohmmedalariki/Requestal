import MiniSearch from 'minisearch';
import type { RequestSummary } from '../storage/db';

export interface SearchDoc {
    id: number;
    method: string;
    url: string;
    host: string;
    tags: string;
}

export class RequestSearchIndex {
    private miniSearch: MiniSearch<SearchDoc>;

    constructor() {
        this.miniSearch = new MiniSearch<SearchDoc>({
            fields: ['method', 'url', 'host', 'tags'],
            storeFields: ['id', 'method', 'url', 'host'],
            searchOptions: {
                boost: { url: 2, method: 1.5, host: 1.2 },
                fuzzy: 0.2,
                prefix: true
            }
        });
    }

    public indexRequests(summaries: RequestSummary[]) {
        const docs: SearchDoc[] = summaries
            .filter(s => s.id !== undefined)
            .map(s => ({
                id: s.id!,
                method: s.method,
                url: s.url,
                host: s.host,
                tags: (s.tags || []).join(' ')
            }));

        this.miniSearch.removeAll();
        this.miniSearch.addAll(docs);
    }

    public addRequest(summary: RequestSummary) {
        if (!summary.id) return;
        if (this.miniSearch.has(summary.id)) {
            this.miniSearch.discard(summary.id);
        }
        this.miniSearch.add({
            id: summary.id,
            method: summary.method,
            url: summary.url,
            host: summary.host,
            tags: (summary.tags || []).join(' ')
        });
    }

    public search(query: string): number[] {
        if (!query.trim()) return [];
        const results = this.miniSearch.search(query);
        return results.map(r => r.id as number);
    }

    public clear() {
        this.miniSearch.removeAll();
    }
}

export const searchIndex = new RequestSearchIndex();
