/**
 * Proxy Relay Bridge
 * Facilitates relaying replay requests through a local intercepting proxy (mitmproxy, Caido, Burp).
 */

export interface ProxyRelayConfig {
    enabled: boolean;
    proxyUrl: string; // e.g. "http://127.0.0.1:8080"
}

export const DEFAULT_PROXY_CONFIG: ProxyRelayConfig = {
    enabled: false,
    proxyUrl: 'http://127.0.0.1:8080'
};

const PROXY_CONFIG_KEY = 'requestal_proxy_relay_config';

export function loadProxyConfig(): ProxyRelayConfig {
    try {
        const raw = localStorage.getItem(PROXY_CONFIG_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        // Fallthrough
    }
    return DEFAULT_PROXY_CONFIG;
}

export function saveProxyConfig(config: ProxyRelayConfig) {
    localStorage.setItem(PROXY_CONFIG_KEY, JSON.stringify(config));
}
