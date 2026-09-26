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

	test('should offer every event the canon documents', () => {
		const eventsProperty = trigger.description.properties.find((p) => p.name === 'events');
		expect(eventsProperty).toBeDefined();

		const eventValues = (eventsProperty as any).options.map((o: any) => o.value);

		// The full list as of the canon this node was built against. An event missing here is
		// not merely absent from the dropdown: with a non-empty selection the node answers 200
		// and filters it out, so it is unreachable even as raw data.
		expect(eventValues.sort()).toEqual([
			'cashbox.shift_close_failed',
			'cashbox.shift_closed',
			'catalog.item_processed',
			'invoice.qr_scanned',
			'invoice.refunded',
			'invoice.status_changed',
			'qr_refund.completed',
			'qr_refund.execution_uncertain',
			'qr_refund.expired',
			'qr_refund.failed',
			'qr_refund.identified',
			'receipt.failed',
			'receipt.issued',
			'subscription.cancelled',
			'subscription.created',
			'subscription.expired',
			'subscription.grace_period_started',
			'subscription.paused',
			'subscription.payment_failed',
			'subscription.payment_succeeded',
			'subscription.resumed',
			'webhook.test',
		]);
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

		test('⛔ should refuse an unverifiable event when no secret is set', async () => {
			const body = { event: 'invoice.status_changed', invoice: { id: 1 } };
			const rawBody = JSON.stringify(body);

			// The webhook URL is public. Accepting an unsigned body means anyone who knows the
			// address can post "paid" into the workflow, so a missing secret is a refusal by
			// default rather than a silent pass.
			const mockFn = createMockWebhookFunctions(
				body,
				{},
				rawBody,
				{ events: [], webhookSecret: '' },
			);

			const result = await trigger.webhook.call(mockFn);

			expect(result.workflowData).toBeUndefined();
			expect(result.webhookResponse).toEqual({
				status: 403,
				body: { error: 'Webhook secret is not configured' },
			});
		});

		test('should accept an unsigned event only when the check is turned off explicitly', async () => {
			const body = { event: 'invoice.status_changed', invoice: { id: 1 } };
			const rawBody = JSON.stringify(body);

			const mockFn = createMockWebhookFunctions(
				body,
				{},
				rawBody,
				{ events: [], webhookSecret: '', requireSignature: false },
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
