/**
 * Scope Matcher Engine
 * Evaluates hostnames and URLs against glob/wildcard include & exclude patterns.
 * Examples: "*.example.com", "api.target.com/v1/*", "-*.example.com/static/*"
 */

export function wildcardToRegex(pattern: string): RegExp {
    let p = pattern.trim();
    if (p.startsWith('-')) {
        p = p.substring(1).trim();
    }
    // Escape regex special chars except *
    const escaped = p.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

export function scopeRuleToCdpPattern(rule: string): string {
    let p = rule.trim();
    if (p.startsWith('-')) p = p.substring(1).trim();
    if (!p) return '*';
    if (p.startsWith('http://') || p.startsWith('https://')) {
        return p.endsWith('*') ? p : `${p}*`;
    }
    if (p.startsWith('*.')) {
        return `*://${p}/*`;
    }
    return `*://*${p}*`;
}

export function isUrlInScope(
    urlStr: string,
    includeRules: string[],
    excludeRules: string[],
    scopeEnabled: boolean = true
): boolean {
    if (!scopeEnabled) return true;
    if (includeRules.length === 0 && excludeRules.length === 0) return true;

    let urlObj: URL | null = null;
    try {
        urlObj = new URL(urlStr);
    } catch {
        // Fallback for relative or malformed paths
    }

    const host = urlObj ? urlObj.hostname : urlStr;
    const full = urlStr;

    // 1. Check exclude rules first
    for (const rule of excludeRules) {
        if (!rule.trim()) continue;
        const regex = wildcardToRegex(rule);
        if (regex.test(host) || regex.test(full)) {
            return false;
        }
    }

    // 2. If no include rules, and not excluded, it's in scope
    if (includeRules.length === 0) {
        return true;
    }

    // 3. Must match at least one include rule
    for (const rule of includeRules) {
        if (!rule.trim()) continue;
        const regex = wildcardToRegex(rule);
        if (regex.test(host) || regex.test(full)) {
            return true;
        }
    }

    return false;
}
