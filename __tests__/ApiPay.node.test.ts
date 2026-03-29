import { ApiPay } from '../nodes/ApiPay/ApiPay.node';
import { createMockExecuteFunctions } from './helpers';

const BASE = 'https://bpapi.bazarbay.site/api/v1';

describe('ApiPay Node', () => {
	let node: ApiPay;

	beforeEach(() => {
		node = new ApiPay();
	});

	// ════════════════════════════════════
	// Description checks
	// ════════════════════════════════════

	test('should have correct basic description', () => {
		expect(node.description.name).toBe('apiPay');
		expect(node.description.displayName).toBe('ApiPay');
		expect(node.description.group).toContain('transform');
		expect(node.description.version).toBe(1);
		expect(node.description.credentials).toEqual([{ name: 'apiPayApi', required: true }]);
	});

	// ════════════════════════════════════
	// Invoice
	// ════════════════════════════════════

	describe('Invoice', () => {
		test('should create an invoice', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'create',
				amount: 1000,
				phoneNumber: '87001234567',
				description: '',
				externalOrderId: '',
				additionalFields: {},
			});

			const mockResponse = {
				id: 123,
				amount: 1000,
				status: 'pending',
				phone_number: '87001234567',
				created_at: '2026-03-29T10:00:00Z',
			};

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce(
				mockResponse,
			);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(1);
			expect(result[0][0].json.id).toBe(123);
			expect(result[0][0].json.amount).toBe(1000);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices`,
					method: 'POST',
					body: expect.objectContaining({
						amount: 1000,
						phone_number: '87001234567',
					}),
				}),
			);
		});

		test('should create an invoice with description and external order ID', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'create',
				amount: 500,
				phoneNumber: '87009876543',
				description: 'Test invoice',
				externalOrderId: 'ORD-001',
				additionalFields: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 124,
				amount: 500,
				description: 'Test invoice',
				external_order_id: 'ORD-001',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.id).toBe(124);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					body: expect.objectContaining({
						description: 'Test invoice',
						external_order_id: 'ORD-001',
					}),
				}),
			);
		});

		test('should create an invoice with cart items', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'create',
				amount: 0,
				phoneNumber: '87001234567',
				description: '',
				externalOrderId: '',
				additionalFields: {
					cartItems: {
						item: [
							{ catalogItemId: 10, count: 2, price: 500 },
							{ catalogItemId: 20, count: 1 },
						],
					},
					discountPercentage: 10,
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 125,
				amount: 900,
				discount_percentage: 10,
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.id).toBe(125);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					body: expect.objectContaining({
						discount_percentage: 10,
						cart_items: [
							{ catalog_item_id: 10, count: 2, price: 500 },
							{ catalog_item_id: 20, count: 1 },
						],
					}),
				}),
			);
		});

		test('should get an invoice', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'get',
				invoiceId: 123,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 123,
				amount: 1000,
				status: 'paid',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.id).toBe(123);
			expect(result[0][0].json.status).toBe('paid');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/123`,
					method: 'GET',
				}),
			);
		});

		test('should get many invoices with limit', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'getAll',
				returnAll: false,
				limit: 10,
				filters: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1 }, { id: 2 }],
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(2);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices`,
					method: 'GET',
					qs: expect.objectContaining({ page: 1, per_page: 10 }),
				}),
			);
		});

		test('should get many invoices with filters', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'getAll',
				returnAll: false,
				limit: 50,
				filters: {
					status: ['paid', 'pending'],
					dateFrom: '2026-01-01',
					dateTo: '2026-03-29',
					search: 'test',
					sortBy: 'amount',
					sortOrder: 'asc',
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1, status: 'paid' }],
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(1);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					qs: expect.objectContaining({
						'status[]': ['paid', 'pending'],
						date_from: '2026-01-01',
						date_to: '2026-03-29',
						search: 'test',
						sort_by: 'amount',
						sort_order: 'asc',
					}),
				}),
			);
		});

		test('should get all invoices with pagination (returnAll)', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'getAll',
				returnAll: true,
				filters: {},
			});

			const page1 = { data: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) };
			const page2 = { data: [{ id: 101 }, { id: 102 }] };

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock)
				.mockResolvedValueOnce(page1)
				.mockResolvedValueOnce(page2);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(102);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		});

		test('should cancel an invoice', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'cancel',
				invoiceId: 123,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 123,
				status: 'cancelled',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.status).toBe('cancelled');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/123/cancel`,
					method: 'POST',
				}),
			);
		});

		test('should check invoice statuses', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'checkStatus',
				invoiceIds: '1, 2, 3',
			});

			const mockResponse = [
				{ id: 1, status: 'paid' },
				{ id: 2, status: 'pending' },
				{ id: 3, status: 'cancelled' },
			];

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce(
				mockResponse,
			);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(3);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/status/check`,
					method: 'POST',
					body: { invoice_ids: [1, 2, 3] },
				}),
			);
		});
	});

	// ════════════════════════════════════
	// Refund
	// ════════════════════════════════════

	describe('Refund', () => {
		test('should create a full refund', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'refund',
				operation: 'create',
				invoiceId: 100,
				additionalFields: {},
			});

			const mockResponse = {
				refund: { id: 1, invoice_id: 100, amount: 1000, status: 'pending' },
				invoice: { id: 100, amount: 1000, status: 'refunded' },
			};

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce(
				mockResponse,
			);

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json).toEqual(expect.objectContaining({ refund: expect.any(Object) }));

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/100/refund`,
					method: 'POST',
				}),
			);
		});

		test('should create a partial refund with reason', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'refund',
				operation: 'create',
				invoiceId: 100,
				additionalFields: {
					amount: 300,
					reason: 'Customer request',
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				refund: { id: 2, invoice_id: 100, amount: 300, status: 'pending', reason: 'Customer request' },
				invoice: { id: 100, amount: 1000, status: 'partially_refunded' },
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.refund).toEqual(
				expect.objectContaining({ amount: 300, reason: 'Customer request' }),
			);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					body: expect.objectContaining({
						amount: 300,
						reason: 'Customer request',
					}),
				}),
			);
		});

		test('should create a refund with return items', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'refund',
				operation: 'create',
				invoiceId: 100,
				additionalFields: {
					returnItems: {
						item: [{ catalogItemId: 5, count: 1 }],
					},
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				refund: { id: 3, invoice_id: 100, amount: 500, status: 'pending' },
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					body: expect.objectContaining({
						return_items: [{ catalog_item_id: 5, count: 1 }],
					}),
				}),
			);
		});

		test('should get a refund', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'refund',
				operation: 'get',
				refundId: 42,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 42,
				invoice_id: 100,
				amount: 500,
				status: 'completed',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.id).toBe(42);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/refunds/42`,
					method: 'GET',
				}),
			);
		});

		test('should get many refunds', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'refund',
				operation: 'getAll',
				returnAll: false,
				limit: 25,
				filters: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1 }, { id: 2 }],
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(2);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/refunds`,
					method: 'GET',
					qs: expect.objectContaining({ page: 1, per_page: 25 }),
				}),
			);
		});

		test('should get many refunds with filters', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'refund',
				operation: 'getAll',
				returnAll: false,
				limit: 50,
				filters: {
					status: ['pending', 'completed'],
					invoiceId: 100,
					dateFrom: '2026-01-01',
					dateTo: '2026-03-01',
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1 }],
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					qs: expect.objectContaining({
						'status[]': ['pending', 'completed'],
						invoice_id: 100,
						date_from: '2026-01-01',
						date_to: '2026-03-01',
					}),
				}),
			);
		});

		test('should get refunds by invoice', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'refund',
				operation: 'getByInvoice',
				invoiceId: 100,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce([
				{ id: 1, invoice_id: 100 },
				{ id: 2, invoice_id: 100 },
			]);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(2);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/100/refunds`,
					method: 'GET',
				}),
			);
		});
	});

	// ════════════════════════════════════
	// Subscription
	// ════════════════════════════════════

	describe('Subscription', () => {
		test('should create a subscription', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'create',
				phoneNumber: '87001234567',
				billingPeriod: 'monthly',
				amount: 5000,
				additionalFields: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 1,
				phone_number: '87001234567',
				billing_period: 'monthly',
				amount: 5000,
				status: 'active',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.id).toBe(1);
			expect(result[0][0].json.status).toBe('active');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions`,
					method: 'POST',
					body: expect.objectContaining({
						phone_number: '87001234567',
						billing_period: 'monthly',
						amount: 5000,
					}),
				}),
			);
		});

		test('should create a subscription with all additional fields', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'create',
				phoneNumber: '87001234567',
				billingPeriod: 'weekly',
				amount: 1000,
				additionalFields: {
					billingDay: 15,
					description: 'Weekly sub',
					subscriberName: 'John',
					externalSubscriberId: 'EXT-001',
					startedAt: '2026-04-01T00:00:00.000Z',
					maxRetryAttempts: 5,
					retryIntervalHours: 12,
					gracePeriodDays: 7,
					metadata: '{"key":"value"}',
					webhookId: 42,
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 2,
				status: 'active',
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					body: expect.objectContaining({
						billing_day: 15,
						description: 'Weekly sub',
						subscriber_name: 'John',
						external_subscriber_id: 'EXT-001',
						started_at: '2026-04-01',
						max_retry_attempts: 5,
						retry_interval_hours: 12,
						grace_period_days: 7,
						metadata: { key: 'value' },
						webhook_id: 42,
					}),
				}),
			);
		});

		test('should get a subscription', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'get',
				subscriptionId: 10,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
				status: 'active',
				billing_period: 'monthly',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.id).toBe(10);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions/10`,
					method: 'GET',
				}),
			);
		});

		test('should get many subscriptions with limit', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'getAll',
				returnAll: false,
				limit: 20,
				filters: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1 }, { id: 2 }],
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(2);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions`,
					method: 'GET',
					qs: expect.objectContaining({ page: 1, per_page: 20 }),
				}),
			);
		});

		test('should get many subscriptions with filters', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'getAll',
				returnAll: false,
				limit: 50,
				filters: {
					status: 'active',
					phoneNumber: '87001234567',
					externalSubscriberId: 'EXT-001',
					search: 'test',
					billingPeriod: 'monthly',
					sortBy: 'amount',
					sortOrder: 'desc',
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1 }],
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					qs: expect.objectContaining({
						status: 'active',
						phone_number: '87001234567',
						external_subscriber_id: 'EXT-001',
						search: 'test',
						billing_period: 'monthly',
						sort_by: 'amount',
						sort_order: 'desc',
					}),
				}),
			);
		});

		test('should get all subscriptions with pagination (returnAll)', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'getAll',
				returnAll: true,
				filters: {},
			});

			const page1 = { data: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) };
			const page2 = { data: [{ id: 101 }] };

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock)
				.mockResolvedValueOnce(page1)
				.mockResolvedValueOnce(page2);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(101);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		});

		test('should update a subscription', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'update',
				subscriptionId: 10,
				updateFields: {
					amount: 7500,
					billingDay: 20,
					description: 'Updated',
					subscriberName: 'Jane',
					metadata: '{"tier":"premium"}',
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
				amount: 7500,
				status: 'active',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.amount).toBe(7500);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions/10`,
					method: 'PUT',
					body: expect.objectContaining({
						amount: 7500,
						billing_day: 20,
						description: 'Updated',
						subscriber_name: 'Jane',
						metadata: { tier: 'premium' },
					}),
				}),
			);
		});

		test('should update a subscription with cart items', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'update',
				subscriptionId: 10,
				updateFields: {
					cartItems: {
						item: [{ catalogItemId: 5, count: 3, price: 200 }],
					},
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					body: expect.objectContaining({
						cart_items: [{ catalog_item_id: 5, count: 3, price: 200 }],
					}),
				}),
			);
		});

		test('should pause a subscription', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'pause',
				subscriptionId: 10,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
				status: 'paused',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.status).toBe('paused');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions/10/pause`,
					method: 'POST',
				}),
			);
		});

		test('should resume a subscription', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'resume',
				subscriptionId: 10,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
				status: 'active',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.status).toBe('active');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions/10/resume`,
					method: 'POST',
				}),
			);
		});

		test('should cancel a subscription', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'cancel',
				subscriptionId: 10,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
				status: 'cancelled',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.status).toBe('cancelled');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions/10/cancel`,
					method: 'POST',
				}),
			);
		});

		test('should get subscription invoices', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'getInvoices',
				subscriptionId: 10,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce([
				{ id: 200, subscription_id: 10, status: 'paid' },
				{ id: 201, subscription_id: 10, status: 'pending' },
			]);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(2);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions/10/invoices`,
					method: 'GET',
				}),
			);
		});
	});

	// ════════════════════════════════════
	// Catalog
	// ════════════════════════════════════

	describe('Catalog', () => {
		test('should get catalog units', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'getUnits',
			});

			const mockResponse = [
				{ id: 1, name: 'piece' },
				{ id: 2, name: 'kg' },
			];

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce(
				mockResponse,
			);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(2);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog/units`,
					method: 'GET',
				}),
			);
		});

		test('should get many catalog items', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'getAll',
				returnAll: false,
				limit: 50,
				filters: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1, name: 'Widget' }],
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(1);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog`,
					method: 'GET',
					qs: expect.objectContaining({ page: 1, per_page: 50 }),
				}),
			);
		});

		test('should get many catalog items with filters', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'getAll',
				returnAll: false,
				limit: 50,
				filters: {
					search: 'Widget',
					barcode: '123456',
					firstChar: 'W',
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1, name: 'Widget' }],
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					qs: expect.objectContaining({
						search: 'Widget',
						barcode: '123456',
						first_char: 'W',
					}),
				}),
			);
		});

		test('should create catalog items (batch)', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'create',
				items: {
					item: [
						{ name: 'Widget', sellingPrice: 100, unitId: 1, barcode: 'BC-001' },
						{ name: 'Gadget', sellingPrice: 200, unitId: 2, imageId: 5 },
					],
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				message: 'Items created',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(1);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog`,
					method: 'POST',
					body: {
						items: [
							{ name: 'Widget', selling_price: 100, unit_id: 1, barcode: 'BC-001' },
							{ name: 'Gadget', selling_price: 200, unit_id: 2, image_id: 5 },
						],
					},
				}),
			);
		});

		test('should upload a catalog image', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'uploadImage',
				binaryPropertyName: 'data',
			});

			const mockBinaryData = {
				fileName: 'photo.jpg',
				mimeType: 'image/jpeg',
			};
			const mockBuffer = Buffer.from('fake-image-data');

			(mockFn.helpers.assertBinaryData as jest.Mock).mockReturnValue(mockBinaryData);
			(mockFn.helpers.getBinaryDataBuffer as jest.Mock).mockResolvedValue(mockBuffer);

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				image_id: 42,
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.image_id).toBe(42);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog/upload-image`,
					method: 'POST',
					body: {
						image: {
							value: mockBuffer,
							options: {
								filename: 'photo.jpg',
								contentType: 'image/jpeg',
							},
						},
					},
				}),
			);
		});

		test('should update a catalog item', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'update',
				itemId: 5,
				updateFields: {
					name: 'Updated Widget',
					sellingPrice: 150,
					unitId: 2,
					imageId: 10,
					barcode: 'BC-002',
					isImageDeleted: false,
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 5,
				name: 'Updated Widget',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.name).toBe('Updated Widget');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog/5`,
					method: 'PATCH',
					body: expect.objectContaining({
						name: 'Updated Widget',
						selling_price: 150,
						unit_id: 2,
						image_id: 10,
						barcode: 'BC-002',
						is_image_deleted: false,
					}),
				}),
			);
		});

		test('should delete a catalog item', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'delete',
				itemId: 5,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				message: 'Deleted',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(1);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog/5`,
					method: 'DELETE',
				}),
			);
		});
	});

	// ════════════════════════════════════
	// Status
	// ════════════════════════════════════

	describe('Status', () => {
		test('should perform health check', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'status',
				operation: 'healthCheck',
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				status: 'ok',
				timestamp: '2026-03-29T02:09:09+00:00',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.status).toBe('ok');

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/status`,
					method: 'GET',
				}),
			);
		});
	});

	// ════════════════════════════════════
	// Error Handling
	// ════════════════════════════════════

	describe('Error Handling', () => {
		test('should throw on 401 Unauthorized', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'get',
				invoiceId: 999,
			});

			const error = new Error('Request failed with status 401');
			(error as any).statusCode = 401;

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(error);

			await expect(node.execute.call(mockFn)).rejects.toThrow();
		});

		test('should throw on 422 Validation Error', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'create',
				amount: -1,
				phoneNumber: 'invalid',
				description: '',
				externalOrderId: '',
				additionalFields: {},
			});

			const error = new Error('Validation failed');
			(error as any).statusCode = 422;

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(error);

			await expect(node.execute.call(mockFn)).rejects.toThrow();
		});

		test('should throw on 429 Rate Limit', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'getAll',
				returnAll: false,
				limit: 10,
				filters: {},
			});

			const error = new Error('Rate limit exceeded');
			(error as any).statusCode = 429;

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(error);

			await expect(node.execute.call(mockFn)).rejects.toThrow();
		});

		test('should continue on fail when enabled', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'get',
				invoiceId: 999,
				_continueOnFail: true,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(
				new Error('Not found'),
			);

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(1);
			expect(result[0][0].json.error).toBe('Not found');
		});

		test('should continue on fail with correct pairedItem', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'get',
				invoiceId: 999,
				_continueOnFail: true,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(
				new Error('Server error'),
			);

			const result = await node.execute.call(mockFn);

			expect(result[0][0].pairedItem).toEqual({ item: 0 });
		});
	});
});
