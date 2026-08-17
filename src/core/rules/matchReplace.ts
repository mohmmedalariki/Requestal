export type RuleTarget =
    | 'request_header'
    | 'request_body'
    | 'request_url'
    | 'response_header'
    | 'response_body'
    | 'header'
    | 'body'
    | 'url';

export interface MatchReplaceRule {
    id: string;
    name: string;
    enabled: boolean;
    target: RuleTarget;
    matchPattern: string;
    replacement: string;
    isRegex: boolean;
}

export function applyMatchReplaceRules(
    url: string,
    headers: Record<string, string>,
    body: string | null,
    rules: MatchReplaceRule[]
): { url: string; headers: Record<string, string>; body: string | null } {
    let finalUrl = url;
    let finalHeaders = { ...headers };
    let finalBody = body;

    const activeRules = rules.filter(r => r.enabled && (
        r.target === 'url' || r.target === 'request_url' ||
        r.target === 'header' || r.target === 'request_header' ||
        r.target === 'body' || r.target === 'request_body'
    ));

    for (const rule of activeRules) {
        try {
            const regex = rule.isRegex
                ? new RegExp(rule.matchPattern, 'g')
                : new RegExp(rule.matchPattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'g');

            if (rule.target === 'url' || rule.target === 'request_url') {
                finalUrl = finalUrl.replace(regex, rule.replacement);
            } else if ((rule.target === 'body' || rule.target === 'request_body') && finalBody) {
                finalBody = finalBody.replace(regex, rule.replacement);
            } else if (rule.target === 'header' || rule.target === 'request_header') {
                const updated: Record<string, string> = {};
                Object.entries(finalHeaders).forEach(([k, v]) => {
                    const newK = k.replace(regex, rule.replacement);
                    const newV = v.replace(regex, rule.replacement);
                    updated[newK] = newV;
                });
                finalHeaders = updated;
            }
        } catch {
            // Ignore malformed regex during execution
        }
    }

    return {
        url: finalUrl,
        headers: finalHeaders,
        body: finalBody
    };
}

export function applyResponseMatchReplaceRules(
    headers: Record<string, string>,
    body: string | null,
    rules: MatchReplaceRule[]
): { headers: Record<string, string>; body: string | null } {
    let finalHeaders = { ...headers };
    let finalBody = body;

    const activeRules = rules.filter(r => r.enabled && (
        r.target === 'response_header' || r.target === 'response_body' ||
        r.target === 'header' || r.target === 'body'
    ));

    for (const rule of activeRules) {
        try {
            const regex = rule.isRegex
                ? new RegExp(rule.matchPattern, 'g')
                : new RegExp(rule.matchPattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'g');

            if ((rule.target === 'response_body' || rule.target === 'body') && finalBody) {
                finalBody = finalBody.replace(regex, rule.replacement);
            } else if (rule.target === 'response_header' || rule.target === 'header') {
                const updated: Record<string, string> = {};
                Object.entries(finalHeaders).forEach(([k, v]) => {
                    const newK = k.replace(regex, rule.replacement);
                    const newV = v.replace(regex, rule.replacement);
                    updated[newK] = newV;
                });
                finalHeaders = updated;
            }
        } catch {
            // Ignore malformed regex during execution
        }
    }

    return {
        headers: finalHeaders,
        body: finalBody
    };
}
