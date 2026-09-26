import { ApiPay } from '../nodes/ApiPay/ApiPay.node';
import { createMockExecuteFunctions } from './helpers';
import { API_BASE_URL } from '../nodes/ApiPay/constants';

const BASE = API_BASE_URL;

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

			// The server totals the cart. Sending amount: 0 alongside it is rejected with 422,
			// so the field must not be in the body at all.
			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: Record<string, unknown> }];
			expect(options.body).not.toHaveProperty('amount');
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

	describe('Dropdowns', () => {
		function createMockLoadOptions() {
			return {
				helpers: { httpRequestWithAuthentication: jest.fn() },
			} as any;
		}

		test('should offer units by name', async () => {
			const mockFn = createMockLoadOptions();
			mockFn.helpers.httpRequestWithAuthentication.mockResolvedValueOnce({
				data: [
					{ id: 1, name: 'piece', name_kaz: 'dana' },
					{ id: 2, name: 'kilogram' },
				],
			});

			const units = await (node as any).methods.loadOptions.getUnits.call(mockFn);

			expect(units).toEqual([
				{ name: 'piece', value: 1 },
				{ name: 'kilogram', value: 2 },
			]);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/catalog/units`, method: 'GET' }),
			);
		});

		test('should offer catalog items with their price', async () => {
			const mockFn = createMockLoadOptions();
			mockFn.helpers.httpRequestWithAuthentication.mockResolvedValueOnce({
				data: [
					{ id: 10, name: 'Coffee', selling_price: 1200 },
					{ id: 11, name: 'Service' },
				],
			});

			const items = await (node as any).methods.loadOptions.getCatalogItems.call(mockFn);

			expect(items).toEqual([
				{ name: 'Coffee — 1200', value: 10 },
				{ name: 'Service', value: 11 },
			]);
			// A dropdown cannot paginate, so the list is capped; a larger catalog is handled by
			// putting an expression in the field instead.
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/catalog`, qs: { page: 1, per_page: 200 } }),
			);
		});

		test('should survive an empty catalog', async () => {
			const mockFn = createMockLoadOptions();
			mockFn.helpers.httpRequestWithAuthentication.mockResolvedValueOnce({});

			await expect(
				(node as any).methods.loadOptions.getCatalogItems.call(mockFn),
			).resolves.toEqual([]);
		});
	});

	describe('Invoice: top-up operations', () => {
		test('should carry the idempotency key and note on a single invoice', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'create',
				amount: 1000,
				phoneNumber: '87001234567',
				description: '',
				externalOrderId: '',
				additionalFields: {
					externalOrderIdIdempotency: 'ord-7',
					internalComment: 'regular customer',
					kaspiConnectionId: 12,
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 1 });

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					body: {
						phone_number: '87001234567',
						amount: 1000,
						external_order_id_idempotency: 'ord-7',
						internal_comment: 'regular customer',
						kaspi_connection_id: 12,
					},
				}),
			);
		});

		test('should create invoices in bulk with a shared till', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'createBulk',
				kaspiConnectionId: 12,
				invoices: {
					invoice: [
						{ phoneNumber: '87001234567', amount: 1000, externalOrderIdIdempotency: 'a' },
						{ phoneNumber: '87007654321', amount: 0, description: 'Order 2' },
					],
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				invoices: [{ id: 1 }, { error_code: 'amount_must_be_whole_tenge' }],
			});

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { url: string; body: { invoices: Record<string, unknown>[]; kaspi_connection_id: number } }];
			expect(options.url).toBe(`${BASE}/invoices/bulk`);
			expect(options.body.kaspi_connection_id).toBe(12);
			// A zero amount must not reach the server — same rule as the single invoice.
			expect(options.body.invoices).toEqual([
				{ phone_number: '87001234567', amount: 1000, external_order_id_idempotency: 'a' },
				{ phone_number: '87007654321', description: 'Order 2' },
			]);
		});

		test('should send origin and date_field when listing', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'getAll',
				returnAll: false,
				limit: 10,
				filters: { status: ['paid', 'partially_refunded'], dateField: 'paid_at', origin: 'kaspi' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ data: [] });

			await node.execute.call(mockFn);

			// Without date_field a cash-day reconciliation silently uses created_at and an
			// invoice issued yesterday but paid today falls out of the day.
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					qs: expect.objectContaining({ date_field: 'paid_at', origin: 'kaspi' }),
				}),
			);
		});

		test('should erase the note with null, not with an absent key', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'updateNote',
				invoiceId: 42,
				internalComment: '',
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 42 });

			await node.execute.call(mockFn);

			// A body without the key is a 422 — there is no silent "changed nothing".
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/42`,
					method: 'PATCH',
					body: { internal_comment: null },
				}),
			);
		});

		test('should read statistics and simulate a status', async () => {
			const stats = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'getStats',
				filters: { period: 'month', dateField: 'paid_at' },
			});
			(stats.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ total: 5 });
			await node.execute.call(stats);
			expect(stats.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/stats`,
					qs: { period: 'month', date_field: 'paid_at' },
				}),
			);

			const sim = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'simulateStatus',
				invoiceId: 42,
				status: 'paid',
				additionalFields: { kaspiSourceType: 'GOLD' },
			});
			(sim.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ status: 'paid' });
			await node.execute.call(sim);
			expect(sim.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/42/simulate-status`,
					method: 'POST',
					body: { status: 'paid', kaspi_source_type: 'GOLD' },
				}),
			);
		});
	});

	describe('Invoice: Create QR', () => {
		test('should create a QR invoice and keep the tiyn', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'createQr',
				amount: 1500.5,
				description: 'Order 1024',
				additionalFields: { externalOrderIdIdempotency: 'order-1024' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 700,
				status: 'pending',
				qr_token_url: 'https://qr.kaspi.kz/x',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.id).toBe(700);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/invoices/qr`,
					method: 'POST',
					// Unlike the phone route, the QR route accepts fractional amounts —
					// rounding here would silently change the price.
					body: {
						amount: 1500.5,
						description: 'Order 1024',
						external_order_id_idempotency: 'order-1024',
					},
				}),
			);
		});

		test('should omit amount when the QR invoice is built from a cart', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'createQr',
				amount: 0,
				description: '',
				additionalFields: {
					cartItems: { item: [{ catalogItemId: 10, count: 2 }] },
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 701 });

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: Record<string, unknown> }];
			expect(options.body).not.toHaveProperty('amount');
			expect(options.body.cart_items).toEqual([{ catalog_item_id: 10, count: 2 }]);
		});
	});

	describe('Account', () => {
		test.each([
			['getHealth', '/account/health'],
			['getTariff', '/tariff'],
			['getPlans', '/tariff/plans'],
		])('should read %s', async (operation, path) => {
			const mockFn = createMockExecuteFunctions({ resource: 'account', operation });
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ ok: true });

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}${path}`, method: 'GET' }),
			);
		});
	});

	describe('Catalog: bulk delete, scan, queue', () => {
		test('should send exactly one target list and keep a dry run harmless', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'bulkDelete',
				matchBy: 'ids',
				values: '101, 102 ,103',
				additionalFields: { dryRun: true, expectedCount: 3, idempotencyKey: 'wipe-1' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				would_delete: 3,
				not_yours: [],
			});

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { url: string; method: string; body: Record<string, unknown> }];
			// POST, not DELETE: a body on DELETE is poorly supported by the 1C clients this
			// endpoint exists for. And exactly one list — never both.
			expect(options.method).toBe('POST');
			expect(options.url).toBe(`${BASE}/catalog/bulk-delete`);
			expect(options.body).toEqual({
				ids: [101, 102, 103],
				expected_count: 3,
				dry_run: true,
				idempotency_key: 'wipe-1',
			});
			expect(options.body).not.toHaveProperty('external_refs');
		});

		test('should match by external refs without coercing them to numbers', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'bulkDelete',
				matchBy: 'external_refs',
				values: '1C-00042,1C-00043',
				additionalFields: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ accepted: 2 });

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: Record<string, unknown> }];
			expect(options.body).toEqual({ external_refs: ['1C-00042', '1C-00043'] });
		});

		test('should scan a barcode and treat an empty result as a non-error', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'scan',
				barcode: '4607015232646',
			});

			// An empty data[] means "not in the national catalogue" — a normal 200, not a failure.
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [],
				scan_result: { code: 'not_found' },
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.data).toEqual([]);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog/scan`,
					method: 'POST',
					body: { input: '4607015232646' },
				}),
			);
		});

		test.each([
			['getQueue', '/catalog/queue'],
			['getErrors', '/catalog/errors'],
		])('should page %s', async (operation, path) => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation,
				returnAll: false,
				limit: 25,
				filters: { sortOrder: 'asc' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				current_page: 1,
				data: [{ id: 1 }],
				total: 1,
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}${path}`,
					qs: { sort_order: 'asc', page: 1, per_page: 25 },
				}),
			);
		});
	});

	describe('Subscription: simulations', () => {
		test('should start and stop a simulation', async () => {
			const start = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'startSimulation',
				subscriptionId: 9,
				intervalMinutes: 10,
				maxInvoices: 3,
			});
			(start.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ message: 'Simulation started' });
			await node.execute.call(start);
			expect(start.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/subscriptions/9/start-simulation`,
					method: 'POST',
					body: { interval_minutes: 10, max_invoices: 3 },
				}),
			);

			const stop = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'stopSimulation',
				subscriptionId: 9,
			});
			(stop.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ message: 'Simulation stopped' });
			await node.execute.call(stop);
			expect(stop.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/subscriptions/9/stop-simulation`, method: 'POST' }),
			);
		});

		test('should create one sandbox invoice without a body', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'subscription',
				operation: 'simulateInvoice',
				subscriptionId: 9,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				message: 'Sandbox invoice created for subscription',
			});

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { url: string; body?: unknown }];
			expect(options.url).toBe(`${BASE}/subscriptions/9/simulate-invoice`);
			expect(options.body).toBeUndefined();
		});
	});

	describe('Cashbox', () => {
		test('should summarise a day and default the till to primary', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'cashbox',
				operation: 'getSummary',
				date: '2026-09-25',
				kaspiConnectionId: 0,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ cash_total: '1000.00' });

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { url: string; qs: Record<string, unknown> }];
			expect(options.url).toBe(`${BASE}/cashbox/summary`);
			// 0 means "let the server pick the primary till" — sending it would be a bad id.
			expect(options.qs).toEqual({ date: '2026-09-25' });
		});

		test('should require a shift window and pass the till when given', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'cashbox',
				operation: 'getShifts',
				dateFrom: '2026-09-01',
				dateTo: '2026-09-25',
				kaspiConnectionId: 12,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ data: [] });

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/cashbox/shifts`,
					qs: { date_from: '2026-09-01', date_to: '2026-09-25', kaspi_connection_id: 12 },
				}),
			);
		});

		test('should close a shift with an idempotency key', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'cashbox',
				operation: 'closeShift',
				shiftNumber: 41,
				clientOperationId: 'close-41-2026-09-25',
				kaspiConnectionId: 0,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				operation_id: 900,
				status: 'pending',
			});

			const result = await node.execute.call(mockFn);

			// 202: the close is asynchronous and polled through Get Operation.
			expect(result[0][0].json.operation_id).toBe(900);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/cashbox/shifts/close`,
					method: 'POST',
					body: { client_operation_id: 'close-41-2026-09-25', shift_number: 41 },
				}),
			);
		});

		test.each([
			['setAutoClose', '/cashbox/settings/auto-close'],
			['setAutoWithdrawal', '/cashbox/settings/auto-withdrawal'],
		])('should flip %s through its own literal path', async (operation, path) => {
			const mockFn = createMockExecuteFunctions({
				resource: 'cashbox',
				operation,
				enabled: true,
				kaspiConnectionId: 0,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ changed: true });

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}${path}`, method: 'PUT', body: { enabled: true } }),
			);
		});

		test('should read reconciliation, report, settings and an operation', async () => {
			const cases: Array<[Record<string, unknown>, string]> = [
				[{ resource: 'cashbox', operation: 'getReconciliation', shiftId: 5, kaspiConnectionId: 0 }, `${BASE}/cashbox/reconciliation`],
				[{ resource: 'cashbox', operation: 'getShiftReport', shiftId: 5 }, `${BASE}/cashbox/shifts/5/report`],
				[{ resource: 'cashbox', operation: 'getSettings' }, `${BASE}/cashbox/settings`],
				[{ resource: 'cashbox', operation: 'getOperation', operationId: 900 }, `${BASE}/cashbox/operations/900`],
			];

			for (const [params, url] of cases) {
				const mockFn = createMockExecuteFunctions(params);
				(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ ok: true });
				await node.execute.call(mockFn);
				expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
					'apiPayApi',
					expect.objectContaining({ url, method: 'GET' }),
				);
			}
		});
	});

	describe('Client', () => {
		test('should check a phone number', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'client',
				operation: 'check',
				phoneNumber: '77001234567',
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				phone: '87001234567',
				has_kaspi: true,
				client_name: 'Ivan I.',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.has_kaspi).toBe(true);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/clients/check`,
					method: 'POST',
					body: { phone: '77001234567' },
				}),
			);
		});
	});

	describe('Webhook Log', () => {
		test('should filter deliveries', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'webhookLog',
				operation: 'getAll',
				returnAll: false,
				limit: 20,
				filters: { invoiceId: 7, event: 'invoice.status_changed', status: 'failed' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				current_page: 1,
				data: [{ id: 1 }],
				total: 1,
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(1);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/webhook-logs`,
					qs: {
						invoice_id: 7,
						event: 'invoice.status_changed',
						status: 'failed',
						page: 1,
						per_page: 20,
					},
				}),
			);
		});

		test('should stop paging once total is reached', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'webhookLog',
				operation: 'getAll',
				returnAll: true,
				filters: {},
			});

			// A server that ignores per_page and keeps answering full pages used to spin this
			// loop forever. `total` is the brake.
			const fullPage = Array.from({ length: 100 }, (_, n) => ({ id: n + 1 }));
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValue({
				current_page: 1,
				data: fullPage,
				total: 100,
			});

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(100);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		});

		test('should get one delivery', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'webhookLog',
				operation: 'get',
				webhookLogId: 3,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 3 });

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/webhook-logs/3`, method: 'GET' }),
			);
		});

		test('should read catalog webhook logs', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'catalog',
				operation: 'getWebhookLogs',
				returnAll: false,
				limit: 5,
				filters: { catalogItemId: 42, status: 'failed' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				current_page: 1,
				data: [{ id: 9 }],
				total: 1,
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/catalog/webhook-logs`,
					qs: { catalog_item_id: 42, status: 'failed', page: 1, per_page: 5 },
				}),
			);
		});
	});

	describe('QR Refund', () => {
		test('should issue a refund link tied to an invoice', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'createLink',
				additionalFields: { invoiceId: 88, amount: '500.00' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 3,
				customer_url: 'https://qr.apipay.kz/r/abc',
				link_expires_at: '2026-09-26T10:00:00+05:00',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.customer_url).toBe('https://qr.apipay.kz/r/abc');
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/qr-refunds/links`,
					method: 'POST',
					body: { invoice_id: 88, amount: '500.00' },
				}),
			);
		});

		test('should send exactly one of count or amount per returned line', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'createLink',
				additionalFields: {
					invoiceId: 88,
					returnItems: {
						item: [
							{ catalogItemId: 1, count: 2, amount: 900 },
							{ catalogItemId: 2, count: 0, amount: 300 },
						],
					},
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 4 });

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: { return_items: Record<string, unknown>[] } }];
			// The server refuses a line carrying both, so count wins when it is set.
			expect(options.body.return_items).toEqual([
				{ catalog_item_id: 1, count: 2 },
				{ catalog_item_id: 2, amount: 300 },
			]);
		});

		test('should mark a 200 execute as proven', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'execute',
				sessionId: 7,
				operationRef: 'op-ref',
				additionalFields: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				statusCode: 200,
				body: { status: 'completed' },
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json).toMatchObject({
				refundOutcome: 'proven',
				doNotRetry: false,
				httpCode: '200',
				status: 'completed',
			});
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/qr-refunds/7/execute`,
					method: 'POST',
					// Without returnFullResponse the node cannot tell 200 from 202, and the body
					// alone does not say: one of the 202 codes ships no snapshot at all.
					returnFullResponse: true,
					body: { operation_ref: 'op-ref' },
				}),
			);
		});

		test('⛔ should NOT report a 202 execute as success', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'execute',
				sessionId: 7,
				operationRef: 'op-ref',
				additionalFields: {},
			});

			// 202 means the attempt is spent and the outcome is not proven. Axios counts it as
			// success, so a node that trusts the transport paints green over a refund Kaspi may
			// not have applied — and a re-run can refund twice.
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				statusCode: 202,
				body: { error_code: 'qr_refund_execution_uncertain', status: 'execution_uncertain' },
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json).toMatchObject({
				refundOutcome: 'unproven',
				doNotRetry: true,
				httpCode: '202',
			});
			expect(result[0][0].json.refundOutcome).not.toBe('proven');
		});

		test('⛔ should mark a 409 in-progress refusal as unproven too', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'execute',
				sessionId: 7,
				operationRef: 'op-ref',
				additionalFields: {},
				_continueOnFail: true,
			});

			// Class is decided by CODE, not by HTTP family: 409 in-progress and 409 uncertain
			// both mean the money may already be gone, while 502 means Kaspi refused.
			const refusal = Object.assign(new Error('Request failed with status code 409'), {
				response: {
					status: 409,
					headers: {},
					data: { error_code: 'qr_refund_execution_in_progress' },
				},
			});
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(refusal);

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json).toMatchObject({
				errorCode: 'qr_refund_execution_in_progress',
				refundOutcome: 'unproven',
				doNotRetry: true,
			});
		});

		test('should leave a Kaspi refusal retryable', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'execute',
				sessionId: 7,
				operationRef: 'op-ref',
				additionalFields: {},
				_continueOnFail: true,
			});

			// 502 kaspi_error is the one refusal AFTER reaching Kaspi where a retry is right.
			const refusal = Object.assign(new Error('Request failed with status code 502'), {
				response: { status: 502, headers: {}, data: { error_code: 'kaspi_error' } },
			});
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(refusal);

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.errorCode).toBe('kaspi_error');
			expect(result[0][0].json).not.toHaveProperty('doNotRetry');
			expect(result[0][0].json).not.toHaveProperty('refundOutcome');
		});

		test('should prefer items over amount when both are given', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'execute',
				sessionId: 7,
				operationRef: 'op-ref',
				additionalFields: {
					amount: 100,
					items: { item: [{ ref: 'line-1', amount: 50 }] },
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				statusCode: 200,
				body: {},
			});

			await node.execute.call(mockFn);

			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: Record<string, unknown> }];
			// amount and items are mutually exclusive; sending both is a 422.
			expect(options.body).not.toHaveProperty('amount');
			expect(options.body.items).toEqual([{ ref: 'line-1', amount: 50 }]);
		});

		test('should revoke a link and read a session', async () => {
			const revoke = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'revokeLink',
				linkId: 3,
			});
			(revoke.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ status: 'expired' });
			await node.execute.call(revoke);
			expect(revoke.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/qr-refunds/links/3`, method: 'DELETE' }),
			);

			const get = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'get',
				sessionId: 7,
			});
			(get.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 7 });
			await node.execute.call(get);
			expect(get.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/qr-refunds/7`, method: 'GET' }),
			);
		});

		test('should list and read returnable operations', async () => {
			const list = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'getOperations',
				sessionId: 7,
				cursor: 'c1',
			});
			(list.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ data: [] });
			await node.execute.call(list);
			expect(list.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/qr-refunds/7/operations`,
					qs: { cursor: 'c1' },
				}),
			);

			const one = createMockExecuteFunctions({
				resource: 'qrRefund',
				operation: 'getOperation',
				sessionId: 7,
				operationRef: 'op-ref',
			});
			(one.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ ref: 'op-ref' });
			await node.execute.call(one);
			expect(one.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/qr-refunds/7/operations/op-ref`, method: 'GET' }),
			);
		});
	});

	describe('Receipt', () => {
		test('should issue a fiscal receipt with quantity, not count', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'receipt',
				operation: 'issue',
				paymentType: 3,
				clientOperationId: 'op-1',
				cartItems: { item: [{ catalogItemId: 42, quantity: 2, price: 500 }] },
				additionalFields: { receivedAmt: 1200 },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 5,
				status: 'pending',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.status).toBe('pending');
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/receipts`,
					method: 'POST',
					// ⚠️ `quantity`, not `count`: the invoice routes use the other name and
					// sending it here gets the receipt refused.
					body: {
						payment_type: 3,
						client_operation_id: 'op-1',
						cart_items: [{ catalog_item_id: 42, quantity: 2, price: 500 }],
						received_amt: 1200,
					},
				}),
			);
		});

		test('should attach the error code only when simulating a failure', async () => {
			const issued = createMockExecuteFunctions({
				resource: 'receipt',
				operation: 'issue',
				paymentType: 5,
				clientOperationId: 'op-2',
				cartItems: { item: [{ catalogItemId: 1, quantity: 1 }] },
				additionalFields: { simulateStatus: 'issued', simulateErrorCode: 'shift_closed' },
			});
			(issued.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 6 });
			await node.execute.call(issued);

			const [, issuedOptions] = (issued.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: { simulate: Record<string, unknown> } }];
			expect(issuedOptions.body.simulate).toEqual({ status: 'issued' });

			const failed = createMockExecuteFunctions({
				resource: 'receipt',
				operation: 'issue',
				paymentType: 5,
				clientOperationId: 'op-3',
				cartItems: { item: [{ catalogItemId: 1, quantity: 1 }] },
				additionalFields: { simulateStatus: 'failed', simulateErrorCode: 'shift_closed' },
			});
			(failed.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 7 });
			await node.execute.call(failed);

			const [, failedOptions] = (failed.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: { simulate: Record<string, unknown> } }];
			expect(failedOptions.body.simulate).toEqual({ status: 'failed', error_code: 'shift_closed' });
		});

		test('should preview a fiscal receipt', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'receipt',
				operation: 'preview',
				paymentType: 3,
				totalPrice: 10,
				additionalFields: {},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ Title: 'Payment method', Subtitle: 'Cash', isBoldText: false }],
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/receipts/preview`,
					method: 'POST',
					body: { payment_type: 3, total_price: 10 },
				}),
			);
		});

		test('should filter the receipt history', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'receipt',
				operation: 'getAll',
				returnAll: false,
				limit: 10,
				filters: { status: 'issued', paymentType: 3, from: '2026-07-13' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				data: [{ id: 1 }],
			});

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/receipts`,
					qs: { status: 'issued', payment_type: 3, from: '2026-07-13', page: 1, per_page: 10 },
				}),
			);
		});

		test('should pass the pending receipt of an invoice through untouched', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'getReceipt',
				invoiceId: 99,
			});

			// The endpoint answers 202 with a pending body. Axios counts that as success, so the
			// node must hand the body over and let the workflow branch on `status` — dressing it
			// up as ready would invent links that do not exist yet.
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				status: 'pending',
				poll_after: 2,
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json).toEqual({ status: 'pending', poll_after: 2 });
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/invoices/99/receipt`, method: 'GET' }),
			);
		});
	});

	describe('Static QR', () => {
		test('should create a printable sheet', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'staticQr',
				operation: 'create',
				amount: 5000,
				description: 'Order 1024',
				additionalFields: { singleUse: true, externalOrderId: 'ord-1' },
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
				short_code: 'K7M9P2Q4',
				print_url: 'https://qr.apipay.kz/9f1c',
				status: 'active',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.short_code).toBe('K7M9P2Q4');
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({
					url: `${BASE}/static-qr`,
					method: 'POST',
					body: {
						amount: 5000,
						description: 'Order 1024',
						external_order_id: 'ord-1',
						single_use: true,
					},
				}),
			);
		});

		test('should get a printable sheet', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'staticQr',
				operation: 'get',
				staticQrId: 10,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({ id: 10 });

			await node.execute.call(mockFn);

			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/static-qr/10`, method: 'GET' }),
			);
		});

		test('should disable a printable sheet', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'staticQr',
				operation: 'disable',
				staticQrId: 10,
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockResolvedValueOnce({
				id: 10,
				status: 'disabled',
			});

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json.status).toBe('disabled');
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledWith(
				'apiPayApi',
				expect.objectContaining({ url: `${BASE}/static-qr/10`, method: 'DELETE' }),
			);
		});

		test('should paginate printable sheets when returning all', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'staticQr',
				operation: 'getAll',
				returnAll: true,
			});

			const firstPage = Array.from({ length: 100 }, (_, n) => ({ id: n + 1 }));
			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock)
				.mockResolvedValueOnce({ data: firstPage })
				.mockResolvedValueOnce({ data: [{ id: 101 }] });

			const result = await node.execute.call(mockFn);

			expect(result[0]).toHaveLength(101);
			expect(mockFn.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		});
	});

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
					body: expect.any(FormData),
				}),
			);

			// The upload has to go out as multipart. Asserting the shape of the options object
			// is not enough: version 0.1.0 passed a `{ value, options }` literal that looked
			// right here and was serialised to JSON on the wire.
			const [, options] = (mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mock
				.calls[0] as [string, { body: FormData; json?: boolean }];

			expect(options.json).toBeUndefined();

			const uploaded = options.body.get('image');
			expect(uploaded).toBeInstanceOf(Blob);

			const file = uploaded as Blob & { name: string };
			expect(file.name).toBe('photo.jpg');
			expect(file.type).toBe('image/jpeg');
			expect(Buffer.from(await file.arrayBuffer())).toEqual(mockBuffer);
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

		test('should carry the refusal code and field errors on continueOnFail', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'create',
				amount: 1000,
				phoneNumber: '87001234567',
				description: '',
				externalOrderId: '',
				additionalFields: {},
				_continueOnFail: true,
			});

			const refusal = Object.assign(new Error('Request failed with status code 422'), {
				httpCode: '422',
				response: {
					status: 422,
					headers: {},
					data: {
						error_code: 'amount_must_be_whole_tenge',
						errors: { amount: ['The amount must be a whole number of tenge.'] },
					},
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(refusal);

			const result = await node.execute.call(mockFn);

			// Without this, a failed item carried only error.message and the workflow had no way
			// to tell a validation refusal from a rate limit.
			expect(result[0][0].json).toMatchObject({
				httpCode: '422',
				errorCode: 'amount_must_be_whole_tenge',
				errors: { amount: ['The amount must be a whole number of tenge.'] },
			});
		});

		test('should surface Retry-After when the rate limit is hit', async () => {
			const mockFn = createMockExecuteFunctions({
				resource: 'invoice',
				operation: 'get',
				invoiceId: 1,
				_continueOnFail: true,
			});

			const throttled = Object.assign(new Error('Request failed with status code 429'), {
				response: {
					status: 429,
					headers: { 'retry-after': '30' },
					data: { error_code: 'rate_limit_exceeded' },
				},
			});

			(mockFn.helpers.httpRequestWithAuthentication as jest.Mock).mockRejectedValueOnce(throttled);

			const result = await node.execute.call(mockFn);

			expect(result[0][0].json).toMatchObject({
				httpCode: '429',
				errorCode: 'rate_limit_exceeded',
				retryAfter: '30',
			});
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
