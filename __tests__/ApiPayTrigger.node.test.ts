import { ApiPayTrigger } from '../nodes/ApiPay/ApiPayTrigger.node';
import { createMockWebhookFunctions, generateSignature } from './helpers';

describe('ApiPayTrigger Node', () => {
	let trigger: ApiPayTrigger;

	beforeEach(() => {
		trigger = new ApiPayTrigger();
	});

	// ════════════════════════════════════
	// Description checks
	// ════════════════════════════════════

	test('should have correct basic description', () => {
		expect(trigger.description.name).toBe('apiPayTrigger');
		expect(trigger.description.displayName).toBe('ApiPay Trigger');
		expect(trigger.description.group).toContain('trigger');
		expect(trigger.description.inputs).toEqual([]);
		expect(trigger.description.webhooks).toBeDefined();
		expect(trigger.description.webhooks![0].httpMethod).toBe('POST');
	});

	test('should list all 7 event types', () => {
		const eventsProperty = trigger.description.properties.find((p) => p.name === 'events');
		expect(eventsProperty).toBeDefined();
		expect((eventsProperty as any).options).toHaveLength(7);

		const eventValues = (eventsProperty as any).options.map((o: any) => o.value);
		expect(eventValues).toContain('invoice.status_changed');
		expect(eventValues).toContain('invoice.refunded');
		expect(eventValues).toContain('subscription.payment_succeeded');
		expect(eventValues).toContain('subscription.payment_failed');
		expect(eventValues).toContain('subscription.grace_period_started');
		expect(eventValues).toContain('subscription.expired');
		expect(eventValues).toContain('webhook.test');
	});

	// ════════════════════════════════════
	// HMAC Verification
	// ════════════════════════════════════

	describe('HMAC Verification', () => {
		test('should accept webhook with valid signature', async () => {
			const body = { event: 'invoice.status_changed', invoice: { id: 1, status: 'paid' } };
			const rawBody = JSON.stringify(body);
			const secret = 'test-webhook-secret';
			const signature = generateSignature(rawBody, secret);

			const mockFn = createMockWebhookFunctions(
				body,
				{ 'x-webhook-signature': signature },
				rawBody,
				{ events: [], webhookSecret: secret },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData).toBeDefined();
			expect(result.workflowData![0][0].json.event).toBe('invoice.status_changed');
		});

		test('should reject webhook with invalid signature (403)', async () => {
			const body = { event: 'invoice.status_changed', invoice: { id: 1, status: 'paid' } };
			const rawBody = JSON.stringify(body);

			const mockFn = createMockWebhookFunctions(
				body,
				{ 'x-webhook-signature': 'sha256=invalidsignaturevalue' },
				rawBody,
				{ events: [], webhookSecret: 'test-webhook-secret' },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.webhookResponse).toBeDefined();
			expect(result.webhookResponse!.status).toBe(403);
			expect(result.workflowData).toBeUndefined();
		});

		test('should reject webhook with missing signature (403)', async () => {
			const body = { event: 'invoice.status_changed' };
			const rawBody = JSON.stringify(body);

			const mockFn = createMockWebhookFunctions(
				body,
				{},
				rawBody,
				{ events: [], webhookSecret: 'test-webhook-secret' },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.webhookResponse).toBeDefined();
			expect(result.webhookResponse!.status).toBe(403);
			expect(result.workflowData).toBeUndefined();
		});

		test('should skip verification when webhookSecret is empty', async () => {
			const body = { event: 'invoice.status_changed', invoice: { id: 1 } };
			const rawBody = JSON.stringify(body);

			const mockFn = createMockWebhookFunctions(
				body,
				{},
				rawBody,
				{ events: [], webhookSecret: '' },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData).toBeDefined();
			expect(result.workflowData![0][0].json.event).toBe('invoice.status_changed');
		});
	});

	// ════════════════════════════════════
	// Event Filtering
	// ════════════════════════════════════

	describe('Event Filtering', () => {
		test('should pass through selected event', async () => {
			const body = { event: 'invoice.status_changed', invoice: { id: 1, status: 'paid' } };
			const rawBody = JSON.stringify(body);
			const secret = 'test-webhook-secret';
			const signature = generateSignature(rawBody, secret);

			const mockFn = createMockWebhookFunctions(
				body,
				{ 'x-webhook-signature': signature },
				rawBody,
				{ events: ['invoice.status_changed'], webhookSecret: secret },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData).toBeDefined();
			expect(result.workflowData![0][0].json.event).toBe('invoice.status_changed');
		});

		test('should filter out unselected event (200, no workflow)', async () => {
			const body = { event: 'invoice.refunded', invoice: { id: 1 } };
			const rawBody = JSON.stringify(body);
			const secret = 'test-webhook-secret';
			const signature = generateSignature(rawBody, secret);

			const mockFn = createMockWebhookFunctions(
				body,
				{ 'x-webhook-signature': signature },
				rawBody,
				{ events: ['invoice.status_changed'], webhookSecret: secret },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.webhookResponse).toBeDefined();
			expect(result.webhookResponse!.status).toBe(200);
			expect(result.webhookResponse!.body).toEqual({ received: true, filtered: true });
			expect(result.workflowData).toBeUndefined();
		});

		test('should pass all events when no filter selected', async () => {
			const body = { event: 'subscription.payment_failed', subscription: { id: 5 } };
			const rawBody = JSON.stringify(body);
			const secret = 'test-webhook-secret';
			const signature = generateSignature(rawBody, secret);

			const mockFn = createMockWebhookFunctions(
				body,
				{ 'x-webhook-signature': signature },
				rawBody,
				{ events: [], webhookSecret: secret },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData).toBeDefined();
			expect(result.workflowData![0][0].json.event).toBe('subscription.payment_failed');
		});
	});

	// ════════════════════════════════════
	// Payload Parsing — all 7 event types
	// ════════════════════════════════════

	describe('Payload Parsing', () => {
		const secret = 'test-webhook-secret';

		function createSignedWebhook(body: object) {
			const rawBody = JSON.stringify(body);
			const signature = generateSignature(rawBody, secret);
			return createMockWebhookFunctions(
				body,
				{ 'x-webhook-signature': signature },
				rawBody,
				{ events: [], webhookSecret: secret },
			);
		}

		test('should parse invoice.status_changed event', async () => {
			const body = {
				event: 'invoice.status_changed',
				invoice: {
					id: 1,
					external_order_id: 'ORD-001',
					amount: 1000,
					status: 'paid',
					description: 'Test',
					client_name: 'John',
					client_phone: '87001234567',
					is_sandbox: true,
					paid_at: '2026-03-29T10:00:00Z',
				},
				source: 'kaspi',
				timestamp: '2026-03-29T10:00:00Z',
			};

			const mockFn = createSignedWebhook(body);
			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData![0][0].json.event).toBe('invoice.status_changed');
			expect(result.workflowData![0][0].json.invoice).toEqual(
				expect.objectContaining({ id: 1, status: 'paid' }),
			);
		});

		test('should parse invoice.refunded event', async () => {
			const body = {
				event: 'invoice.refunded',
				invoice: {
					id: 1,
					amount: 1000,
					status: 'refunded',
					total_refunded: 1000,
					is_sandbox: true,
					external_order_id: 'ORD-001',
				},
				source: 'api',
				timestamp: '2026-03-29T10:00:00Z',
			};

			const mockFn = createSignedWebhook(body);
			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData![0][0].json.event).toBe('invoice.refunded');
			expect(result.workflowData![0][0].json.invoice).toEqual(
				expect.objectContaining({ total_refunded: 1000 }),
			);
		});

		test('should parse subscription.payment_succeeded event', async () => {
			const body = {
				event: 'subscription.payment_succeeded',
				subscription: {
					id: 5,
					external_subscriber_id: 'SUB-001',
					phone_number: '87001234567',
					subscriber_name: 'John',
					amount: 5000,
					billing_period: 'monthly',
					status: 'active',
					next_billing_at: '2026-04-29',
					failed_attempts: 0,
					in_grace_period: false,
					is_sandbox: true,
				},
				invoice_id: 200,
				amount: 5000,
				paid_at: '2026-03-29T10:00:00Z',
				source: 'kaspi',
				timestamp: '2026-03-29T10:00:00Z',
			};

			const mockFn = createSignedWebhook(body);
			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData![0][0].json.event).toBe('subscription.payment_succeeded');
			expect(result.workflowData![0][0].json.invoice_id).toBe(200);
		});

		test('should parse subscription.payment_failed event', async () => {
			const body = {
				event: 'subscription.payment_failed',
				subscription: { id: 5, failed_attempts: 2 },
				invoice_id: 201,
				amount: 5000,
				reason: 'Insufficient funds',
				attempt_number: 2,
				source: 'kaspi',
				timestamp: '2026-03-29T10:00:00Z',
			};

			const mockFn = createSignedWebhook(body);
			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData![0][0].json.event).toBe('subscription.payment_failed');
			expect(result.workflowData![0][0].json.reason).toBe('Insufficient funds');
		});

		test('should parse subscription.grace_period_started event', async () => {
			const body = {
				event: 'subscription.grace_period_started',
				subscription: { id: 5, in_grace_period: true },
				grace_period_days: 7,
				expires_at: '2026-04-05',
				source: 'system',
				timestamp: '2026-03-29T10:00:00Z',
			};

			const mockFn = createSignedWebhook(body);
			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData![0][0].json.event).toBe('subscription.grace_period_started');
			expect(result.workflowData![0][0].json.grace_period_days).toBe(7);
		});

		test('should parse subscription.expired event', async () => {
			const body = {
				event: 'subscription.expired',
				subscription: { id: 5, status: 'expired' },
				source: 'system',
				timestamp: '2026-03-29T10:00:00Z',
			};

			const mockFn = createSignedWebhook(body);
			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData![0][0].json.event).toBe('subscription.expired');
			expect(result.workflowData![0][0].json.subscription).toEqual(
				expect.objectContaining({ status: 'expired' }),
			);
		});

		test('should parse webhook.test event', async () => {
			const body = {
				event: 'webhook.test',
				source: 'test',
				timestamp: '2026-03-29T10:00:00Z',
			};

			const mockFn = createSignedWebhook(body);
			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData![0][0].json.event).toBe('webhook.test');
			expect(result.workflowData![0][0].json.source).toBe('test');
		});
	});
});
