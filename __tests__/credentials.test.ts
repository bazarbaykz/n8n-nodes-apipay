import { ApiPayApi } from '../credentials/ApiPayApi.credentials';
import { API_BASE_URL } from '../nodes/ApiPay/constants';

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

	test('should define exactly the two fields the node reads', () => {
		expect(credentials.properties.map((p) => p.name)).toEqual(['apiKey', 'webhookSecret']);
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

		test('⛔ should NOT offer an environment selector', () => {
			// A field named "Environment", defaulting to "Sandbox", used to sit here doing
			// nothing: sandbox is a property of the organisation behind the API key. A production
			// key with the selector on "Sandbox" billed real customers who looked like test data.
			expect(credentials.properties.find((p) => p.name === 'environment')).toBeUndefined();
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
					baseURL: API_BASE_URL,
					url: '/invoices',
					qs: { per_page: '1' },
					method: 'GET',
				},
			});
		});
	});
});
