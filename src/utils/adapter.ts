import { serializeBody } from './bodyConverter';

export function webRequestToHar(details: any, bodyData: any): any {
    // details: result of onBeforeSendHeaders (contains requestHeaders)
    // bodyData: result of onBeforeRequest (contains requestBody)

    // Construct HAR-like object
    const headers = details.requestHeaders || [];

    // Detect Content-Type
    let contentType = '';
    const ctHeader = headers.find((h: any) => h.name.toLowerCase() === 'content-type');
    if (ctHeader) {
        contentType = ctHeader.value;
    }

    // Parse body if exists
    let postData = undefined;
    if (bodyData && bodyData.requestBody) {
        if (bodyData.requestBody.raw && bodyData.requestBody.raw[0]) {
            const rawBytes = bodyData.requestBody.raw[0].bytes;
            const decoder = new TextDecoder("utf-8");
            postData = {
                text: decoder.decode(rawBytes)
            };
        } else if (bodyData.requestBody.formData) {
            // Handle form data strictly based on Content-Type
            // formData is an object like { key: ["value"] }
            // We need to flatten it appropriately

            // First, normalize formData to a simpler object or array structure that our converter understands
            // Chrome's formData is { key: [val1, val2] }
            const normalized: any = {};
            Object.keys(bodyData.requestBody.formData).forEach(key => {
                const vals = bodyData.requestBody.formData[key];
                if (vals.length === 1) {
                    normalized[key] = vals[0];
                } else {
                    normalized[key] = vals;
                }
            });

            postData = {
                text: serializeBody(normalized, contentType)
            };
        }
    }

    return {
        request: {
            method: details.method,
            url: details.url,
            httpVersion: 'HTTP/1.1', // Assumed, will be enforced by sanitization anyway
            headers: headers,
            postData: postData,
            response: { status: 0 } // Pending response
        }
    };
}
