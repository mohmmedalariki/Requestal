import { z } from 'zod';

export const CdpRequestWillBeSentSchema = z.object({
    requestId: z.string(),
    loaderId: z.string().optional(),
    documentURL: z.string().optional(),
    request: z.object({
        url: z.string(),
        method: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        postData: z.string().optional(),
        hasPostData: z.boolean().optional(),
        initialPriority: z.string().optional(),
        referrerPolicy: z.string().optional()
    }),
    timestamp: z.number(),
    wallTime: z.number().optional(),
    initiator: z.object({
        type: z.string(),
        url: z.string().optional(),
        lineNumber: z.number().optional(),
        stack: z.any().optional()
    }).optional(),
    redirectResponse: z.object({
        url: z.string().optional(),
        status: z.number(),
        statusText: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional()
    }).optional(),
    type: z.string().optional()
});

export const CdpRequestExtraInfoSchema = z.object({
    requestId: z.string(),
    associatedCookies: z.array(z.any()).optional(),
    headers: z.record(z.string(), z.string()),
    connectTiming: z.any().optional(),
    clientSecurityState: z.any().optional()
});

export const CdpResponseReceivedSchema = z.object({
    requestId: z.string(),
    loaderId: z.string().optional(),
    timestamp: z.number(),
    type: z.string().optional(),
    response: z.object({
        url: z.string(),
        status: z.number(),
        statusText: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        mimeType: z.string().optional(),
        protocol: z.string().optional(),
        fromDiskCache: z.boolean().optional(),
        fromServiceWorker: z.boolean().optional()
    })
});

export const CdpResponseReceivedExtraInfoSchema = z.object({
    requestId: z.string(),
    blockedCookies: z.array(z.any()).optional(),
    headers: z.record(z.string(), z.string()),
    resourceIPAddressSpace: z.string().optional(),
    statusCode: z.number().optional(),
    headersText: z.string().optional()
});

export const CdpLoadingFinishedSchema = z.object({
    requestId: z.string(),
    timestamp: z.number(),
    encodedDataLength: z.number().optional()
});

export const CdpWebSocketFrameSchema = z.object({
    requestId: z.string(),
    timestamp: z.number(),
    response: z.object({
        opcode: z.number(),
        mask: z.boolean(),
        payloadData: z.string()
    })
});

export type CdpRequestWillBeSent = z.infer<typeof CdpRequestWillBeSentSchema>;
export type CdpRequestExtraInfo = z.infer<typeof CdpRequestExtraInfoSchema>;
export type CdpResponseReceived = z.infer<typeof CdpResponseReceivedSchema>;
export type CdpResponseReceivedExtraInfo = z.infer<typeof CdpResponseReceivedExtraInfoSchema>;
