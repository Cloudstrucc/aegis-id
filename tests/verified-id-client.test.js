const test = require('node:test');
const assert = require('node:assert/strict');

const VerifiedIdClient = require('../src/services/verified-id-client');

test('VerifiedIdClient exposes missing live configuration safely', async () => {
  const client = new VerifiedIdClient({
    publicBaseUrl: 'https://aegis.example.com',
    config: {
      mode: 'live',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: '',
      scope: '3db474b9-6a0c-4840-96ac-1fceb342124f/.default',
      apiBaseUrl: 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials',
      authorityDid: 'did:web:aegis.example.com',
      manifestUrl: 'https://aegis.example.com/manifest.json',
      credentialType: 'EmployeeCredential',
      clientName: 'Vanguard Aegis ID'
    }
  });

  await assert.rejects(
    () => client.createIssuanceRequest({ claims: { email: 'identity@example.com' } }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.expose, true);
      assert.deepEqual(error.details.missing, ['AZURE_CLIENT_SECRET']);
      assert.match(error.details.recommendedFix, /VID_MODE to mock/i);
      return true;
    }
  );
});

test('VerifiedIdClient explains missing Microsoft Verified ID app roles', async () => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        requestId: 'request-123',
        date: 'Wed, 17 Jun 2026 02:58:02 GMT',
        mscv: 'correlation.1',
        error: {
          code: 'unauthorized',
          message: 'The requested resource requires authentication',
          innererror: {
            code: 'invalid_aad_access_token',
            message: 'Provided access token contains no roles.'
          }
        }
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  };

  const client = new VerifiedIdClient({
    publicBaseUrl: 'https://aegis.example.com',
    config: {
      mode: 'live',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: '3db474b9-6a0c-4840-96ac-1fceb342124f/.default',
      apiBaseUrl: 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials',
      authorityDid: 'did:web:aegis.example.com',
      manifestUrl: 'https://aegis.example.com/manifest.json',
      credentialType: 'EmployeeCredential',
      clientName: 'Vanguard Aegis ID'
    }
  });
  client.getAccessToken = async () => 'access-token-without-roles';

  try {
    await assert.rejects(
      () => client.createIssuanceRequest({ claims: { email: 'identity@example.com' } }),
      (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /no application roles/i);
        assert.equal(error.details.providerStatus, 401);
        assert.equal(error.details.providerCode, 'invalid_aad_access_token');
        assert.match(error.details.recommendedFix, /VerifiableCredential\.Create\.All/);
        assert.deepEqual(error.details.portalChecklist.slice(0, 2), [
          'Confirm the wizard Client ID is the app registration that calls Microsoft Entra Verified ID.',
          'Add API permission: APIs my organization uses > Verifiable Credentials Service Request > Application permission > VerifiableCredential.Create.All.'
        ]);
        return true;
      }
    );
    assert.equal(requestBody.manifest, 'https://aegis.example.com/manifest.json');
    assert.equal(Object.hasOwn(requestBody, 'manifestUrl'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('VerifiedIdClient explains missing Microsoft Verified ID manifest responses', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        requestId: 'request-456',
        date: 'Wed, 17 Jun 2026 03:06:51 GMT',
        mscv: 'correlation.2',
        error: {
          code: 'badRequest',
          message: 'The request is invalid.',
          innererror: {
            code: 'badOrMissingField',
            message: 'Issuance must specify a manifest.',
            target: 'manifest'
          }
        }
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  const client = new VerifiedIdClient({
    publicBaseUrl: 'https://aegis.example.com',
    config: {
      mode: 'live',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: '3db474b9-6a0c-4840-96ac-1fceb342124f/.default',
      apiBaseUrl: 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials',
      authorityDid: 'did:web:aegis.example.com',
      manifestUrl: 'https://aegis.example.com/manifest.json',
      credentialType: 'EmployeeCredential',
      clientName: 'Vanguard Aegis ID'
    }
  });
  client.getAccessToken = async () => 'access-token';

  try {
    await assert.rejects(
      () => client.createIssuanceRequest({ claims: { email: 'identity@example.com' } }),
      (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /missing the credential manifest/i);
        assert.equal(error.details.providerCode, 'badOrMissingField');
        assert.equal(error.details.providerTarget, 'manifest');
        assert.match(error.details.recommendedFix, /Copy the manifest URL/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('VerifiedIdClient explains Microsoft Verified ID authority mismatch responses', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        requestId: 'request-789',
        date: 'Wed, 17 Jun 2026 03:34:01 GMT',
        mscv: 'correlation.3',
        error: {
          code: 'badRequest',
          message: 'The request is invalid.',
          innererror: {
            code: 'badOrMissingField',
            message: 'Requested authority did not match an existing authority',
            target: 'authority'
          }
        }
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  const client = new VerifiedIdClient({
    publicBaseUrl: 'https://aegis.example.com',
    config: {
      mode: 'live',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: '3db474b9-6a0c-4840-96ac-1fceb342124f/.default',
      apiBaseUrl: 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials',
      authorityDid: 'did:web:wrong-authority.example.com',
      manifestUrl: 'https://aegis.example.com/manifest.json',
      credentialType: 'EmployeeCredential',
      clientName: 'Vanguard Aegis ID'
    }
  });
  client.getAccessToken = async () => 'access-token';

  try {
    await assert.rejects(
      () => client.createIssuanceRequest({ claims: { email: 'identity@example.com' } }),
      (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /authority DID does not match/i);
        assert.equal(error.details.providerTarget, 'authority');
        assert.match(error.details.recommendedFix, /same tenant and credential contract/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('VerifiedIdClient omits bare requested claim names from live presentation constraints', async () => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        requestId: 'presentation-123',
        url: 'openid-vc://presentation-request',
        expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  };

  const client = new VerifiedIdClient({
    publicBaseUrl: 'https://aegis.example.com',
    config: {
      mode: 'live',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: '3db474b9-6a0c-4840-96ac-1fceb342124f/.default',
      apiBaseUrl: 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials',
      authorityDid: 'did:web:aegis.example.com',
      manifestUrl: 'https://aegis.example.com/manifest.json',
      credentialType: 'VerifiedEmployee',
      clientName: 'Vanguard Aegis ID'
    }
  });
  client.getAccessToken = async () => 'access-token';

  try {
    await client.createPresentationRequest({
      credentialType: 'VerifiedEmployee',
      acceptedIssuers: ['did:web:issuer.example.com'],
      requestedClaims: ['employeeId', 'email', 'employmentStatus']
    });

    assert.equal(requestBody.requestedCredentials[0].type, 'VerifiedEmployee');
    assert.equal(Object.hasOwn(requestBody.requestedCredentials[0], 'constraints'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('VerifiedIdClient includes explicit presentation constraint filters', async () => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        requestId: 'presentation-456',
        url: 'openid-vc://presentation-request',
        expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  };

  const client = new VerifiedIdClient({
    publicBaseUrl: 'https://aegis.example.com',
    config: {
      mode: 'live',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: '3db474b9-6a0c-4840-96ac-1fceb342124f/.default',
      apiBaseUrl: 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials',
      authorityDid: 'did:web:aegis.example.com',
      manifestUrl: 'https://aegis.example.com/manifest.json',
      credentialType: 'VerifiedEmployee',
      clientName: 'Vanguard Aegis ID'
    }
  });
  client.getAccessToken = async () => 'access-token';

  try {
    await client.createPresentationRequest({
      constraints: [
        { claimName: 'employmentStatus', values: ['active'] },
        { claimName: 'department', contains: 'Finance' },
        { claimName: 'ignoredBecauseNoFilter' }
      ]
    });

    assert.deepEqual(requestBody.requestedCredentials[0].constraints, [
      { claimName: 'employmentStatus', values: ['active'] },
      { claimName: 'department', contains: 'Finance' }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
