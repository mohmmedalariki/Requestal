export const BASELINE_KEY = 'requestal_baseline';
export const BASELINE_RES_KEY = 'requestal_baseline_response';

export const saveBaseline = (request: any, response: any = null) => {
    if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [BASELINE_KEY]: request });
        if (response) {
            chrome.storage.local.set({ [BASELINE_RES_KEY]: response });
        } else {
            chrome.storage.local.remove(BASELINE_RES_KEY);
        }
    } else {
        localStorage.setItem(BASELINE_KEY, JSON.stringify(request));
        if (response) {
            localStorage.setItem(BASELINE_RES_KEY, JSON.stringify(response));
        } else {
            localStorage.removeItem(BASELINE_RES_KEY);
        }
    }
};

export const getBaseline = async (): Promise<{ request: any, response: any | null } | null> => {
    if (chrome && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get([BASELINE_KEY, BASELINE_RES_KEY]);
        if (result[BASELINE_KEY]) {
            return {
                request: result[BASELINE_KEY],
                response: result[BASELINE_RES_KEY] || null
            };
        }
        return null;
    } else {
        const rawReq = localStorage.getItem(BASELINE_KEY);
        const rawRes = localStorage.getItem(BASELINE_RES_KEY);
        if (rawReq) {
            return {
                request: JSON.parse(rawReq),
                response: rawRes ? JSON.parse(rawRes) : null
            };
        }
        return null;
    }
};

export const clearBaseline = () => {
    if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove([BASELINE_KEY, BASELINE_RES_KEY]);
    } else {
        localStorage.removeItem(BASELINE_KEY);
        localStorage.removeItem(BASELINE_RES_KEY);
    }
};
