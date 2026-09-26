import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

import { API_BASE_URL } from '../nodes/ApiPay/constants';

export class ApiPayApi implements ICredentialType {
  name = 'apiPayApi';
  displayName = 'ApiPay API';
  documentationUrl = 'https://apipay.kz/docs';
  icon = 'file:apipay.svg' as const;

  // ⛔ There is deliberately no environment selector. One used to be here, doing nothing:
  // it was named "Environment", defaulted to "Sandbox" and promised to switch environments,
  // while sandbox is a property of the organisation behind the API key and is switched in the
  // ApiPay dashboard. A production key with the selector on "Sandbox" billed real customers
  // who looked like test data. Which mode a key works in is visible via Account → Get Health.
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'API key from your ApiPay.kz dashboard',
    },
    {
      displayName: 'Webhook Secret',
      name: 'webhookSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Webhook secret for HMAC-SHA256 signature verification. Needed only by the ApiPay Trigger node. Create or copy it in the ApiPay dashboard next to the notification address — it is shown once. ⚠️ Regenerating the secret invalidates the old one: every other integration listening on the same API key stops passing signature checks until it is updated there too.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'X-API-Key': '={{$credentials.apiKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: API_BASE_URL,
      url: '/invoices',
      qs: { per_page: '1' },
      method: 'GET',
    },
  };
}
