import { ApiPayApi } from '../credentials/ApiPayApi.credentials';

describe('ApiPayApi Credentials', () => {
	let credentials: ApiPayApi;

	beforeEach(() => {
		credentials = new ApiPayApi();
	});

	test('should have correct name', () => {
		expect(credentials.name).toBe('apiPayApi');
	});

	test('should have correct displayName', () => {
		expect(credentials.displayName).toBe('ApiPay API');
	});

	test('should have documentationUrl', () => {
		expect(credentials.documentationUrl).toBe('https://apipay.kz/docs');
	});

	test('should have icon', () => {
		expect(credentials.icon).toBe('file:apipay.svg');
	});

	test('should define 3 properties', () => {
		expect(credentials.properties).toHaveLength(3);
	});

	describe('properties', () => {
		test('should have apiKey property', () => {
			const apiKey = credentials.properties.find((p) => p.name === 'apiKey');
			expect(apiKey).toBeDefined();
			expect(apiKey!.type).toBe('string');
			expect(apiKey!.required).toBe(true);
			expect(apiKey!.typeOptions).toEqual({ password: true });
		});

		test('should have webhookSecret property', () => {
			const secret = credentials.properties.find((p) => p.name === 'webhookSecret');
			expect(secret).toBeDefined();
			expect(secret!.type).toBe('string');
			expect(secret!.typeOptions).toEqual({ password: true });
		});

		test('should have environment property with options', () => {
			const env = credentials.properties.find((p) => p.name === 'environment');
			expect(env).toBeDefined();
			expect(env!.type).toBe('options');
			expect(env!.default).toBe('sandbox');
			expect((env as any).options).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ value: 'production' }),
					expect.objectContaining({ value: 'sandbox' }),
				]),
			);
		});
	});

	describe('authenticate', () => {
		test('should use generic auth type', () => {
			expect(credentials.authenticate).toEqual({
				type: 'generic',
				properties: {
					headers: {
						'X-API-Key': '={{$credentials.apiKey}}',
					},
				},
			});
		});
	});

	describe('test', () => {
		test('should test with GET /invoices?per_page=1', () => {
			expect(credentials.test).toEqual({
				request: {
					baseURL: 'https://bpapi.bazarbay.site/api/v1',
					url: '/invoices',
					qs: { per_page: '1' },
					method: 'GET',
				},
			});
		});
	});
});
