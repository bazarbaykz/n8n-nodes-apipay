import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

export function createMockExecuteFunctions(params: Record<string, any> = {}): IExecuteFunctions {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _itemIndex: number, fallback?: any) => {
			return params[name] ?? fallback;
		},
		getCredentials: async () => ({
			apiKey: 'test-api-key',
			webhookSecret: 'test-webhook-secret',
			environment: 'sandbox',
		}),
		getNode: () => ({ name: 'ApiPay', type: 'n8n-nodes-apipay.apiPay', typeVersion: 1 }),
		continueOnFail: () => params._continueOnFail ?? false,
		helpers: {
			httpRequestWithAuthentication: jest.fn(),
			httpRequest: jest.fn(),
			returnJsonArray: (data: any) =>
				Array.isArray(data) ? data.map((d: any) => ({ json: d })) : [{ json: data }],
			constructExecutionMetaData: (data: any, _meta: any) => data,
			assertBinaryData: jest.fn(),
			getBinaryDataBuffer: jest.fn(),
		},
	} as unknown as IExecuteFunctions;
}

export function createMockWebhookFunctions(
	body: object,
	headers: Record<string, string> = {},
	rawBody?: Buffer | string,
	params: Record<string, any> = {},
): IWebhookFunctions {
	return {
		getBodyData: () => body,
		getHeaderData: () => headers,
		getRequestObject: () => ({
			rawBody: rawBody ?? Buffer.from(JSON.stringify(body)),
			body,
		}),
		getNodeParameter: (name: string, fallback?: any) => params[name] ?? fallback,
		getCredentials: async () => ({
			apiKey: 'test-api-key',
			webhookSecret: params.webhookSecret ?? 'test-webhook-secret',
			environment: 'sandbox',
		}),
		getNode: () => ({
			name: 'ApiPay Trigger',
			type: 'n8n-nodes-apipay.apiPayTrigger',
			typeVersion: 1,
		}),
		helpers: {
			returnJsonArray: (data: any) =>
				Array.isArray(data) ? data.map((d: any) => ({ json: d })) : [{ json: data }],
		},
	} as unknown as IWebhookFunctions;
}

export const BASE_URL = 'https://bpapi.bazarbay.site';
export const API_PATH = '/api/v1';

export function generateSignature(body: string, secret: string): string {
	const { createHmac } = require('crypto');
	return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}
