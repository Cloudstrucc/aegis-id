// SAML 2.0 upstream authentication adapter.
//
// SP-initiated SSO: Aegis is the Service Provider, the customer's IdP (ADFS,
// Entra, Shibboleth, PingFederate…) is the Identity Provider. Signature
// verification, assertion conditions and metadata parsing all go through the
// maintained @node-saml/node-saml library — we never hand-roll XML-DSig, per the
// repo's "official, well-supported libraries for security-sensitive code" rule.

const xml2js = require('xml2js');
const { SAML } = require('@node-saml/node-saml');

const {
  normalizeText,
  applyAttributeMap,
  buildClaims,
  adapterError
} = require('./adapter-interface');

const PROTOCOL = 'saml';

const NAME_ID_FORMATS = {
  emailAddress: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  transient: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified'
};

// Profile keys node-saml adds that are not user attributes.
const RESERVED_PROFILE_KEYS = new Set([
  'issuer', 'inResponseTo', 'sessionIndex', 'nameID', 'nameIDFormat',
  'nameQualifier', 'spNameQualifier', 'ID', 'mail', 'email', 'getAssertionXml',
  'getAssertion', 'getSamlResponseXml', 'attributes'
]);

function describe() {
  return {
    kind: PROTOCOL,
    name: 'SAML 2.0',
    protocol: 'SAML 2.0',
    family: 'Federation · Upstream',
    direction: 'upstream',
    icon: 'SAM',
    phishingResistant: false,
    mandatory: true, // SSC ITC M4 classic-protocol baseline
    summary: 'SP-initiated SSO against a SAML identity provider — signed assertions, NameID and attribute mapping.'
  };
}

function configSchema() {
  return [
    { key: 'idpMetadataUrl', label: 'IdP metadata URL', type: 'url', required: false,
      help: 'The identity provider’s SAML metadata. Used to fill the entity ID, SSO URL and signing certificate; paste the values below if you have no URL.' },
    { key: 'idpEntityId', label: 'IdP entity ID', type: 'text', required: true,
      help: 'The entityID the IdP asserts as its issuer.' },
    { key: 'idpSsoUrl', label: 'IdP SSO URL', type: 'url', required: true,
      help: 'The SingleSignOnService (HTTP-Redirect) endpoint users are sent to.' },
    { key: 'idpSigningCert', label: 'IdP signing certificate (PEM)', type: 'textarea', required: true,
      help: 'The IdP token-signing public certificate. Public material, so it is stored as-is to verify assertion signatures.' },
    { key: 'spEntityId', label: 'SP entity ID', type: 'text', required: true,
      help: 'The entityID Aegis presents as the Service Provider, e.g. https://aegis-id.io/saml/<org>.' },
    { key: 'acsUrl', label: 'Assertion Consumer Service (ACS) URL', type: 'url', required: true,
      help: 'Where the IdP posts the SAML Response. Must be registered on the IdP.' },
    { key: 'nameIdFormat', label: 'NameID format', type: 'select', required: true,
      options: [['emailAddress', 'emailAddress'], ['persistent', 'persistent'], ['transient', 'transient'], ['unspecified', 'unspecified']] },
    { key: 'wantAssertionsSigned', label: 'Require signed assertions', type: 'boolean', required: false },
    { key: 'attributeMap', label: 'Attribute → claim map', type: 'textarea', required: false,
      help: 'One mapping per line, e.g. http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress → email' },
    { key: 'roleAttribute', label: 'Role attribute name', type: 'text', required: false,
      help: 'Attribute whose values become roles, e.g. http://schemas.microsoft.com/ws/2008/06/identity/claims/role' }
  ];
}

function normalizeConfig(input = {}) {
  const nameIdKey = normalizeText(input.nameIdFormat, 40) || 'emailAddress';
  return {
    idpMetadataUrl: normalizeText(input.idpMetadataUrl, 800),
    idpEntityId: normalizeText(input.idpEntityId, 400),
    idpSsoUrl: normalizeText(input.idpSsoUrl, 800),
    idpSigningCert: normalizeText(input.idpSigningCert, 20000),
    spEntityId: normalizeText(input.spEntityId, 400),
    acsUrl: normalizeText(input.acsUrl, 800),
    nameIdFormat: NAME_ID_FORMATS[nameIdKey] ? nameIdKey : 'emailAddress',
    wantAssertionsSigned: input.wantAssertionsSigned === undefined ? true : Boolean(input.wantAssertionsSigned),
    attributeMap: normalizeText(input.attributeMap, 4000),
    roleAttribute: normalizeText(input.roleAttribute, 400)
  };
}

function validateConfig(config = {}) {
  const problems = [];
  if (!config.idpEntityId) problems.push('IdP entity ID is required.');
  if (!config.idpSsoUrl) problems.push('IdP SSO URL is required.');
  if (!config.idpSigningCert || !/-----BEGIN CERTIFICATE-----/.test(config.idpSigningCert)) {
    problems.push('A PEM-encoded IdP signing certificate is required.');
  }
  if (!config.spEntityId) problems.push('SP entity ID is required.');
  if (!config.acsUrl) problems.push('ACS URL is required.');
  return problems;
}

function samlClient(config) {
  return new SAML({
    entryPoint: config.idpSsoUrl,
    idpCert: config.idpSigningCert,
    issuer: config.spEntityId,
    callbackUrl: config.acsUrl,
    audience: config.spEntityId,
    identifierFormat: NAME_ID_FORMATS[config.nameIdFormat] || NAME_ID_FORMATS.emailAddress,
    wantAssertionsSigned: config.wantAssertionsSigned !== false,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 5000,
    // We do not require InResponseTo tracking for the first-pass adapter; the
    // state store (see registry) carries correlation when a flow is wired to a
    // connected app.
    validateInResponseTo: 'never'
  });
}

async function startAuthorization({ instance, relayState = '' }) {
  const config = instance.config;
  const client = samlClient(config);
  const redirectUrl = await client.getAuthorizeUrlAsync(normalizeText(relayState, 500), '', {});
  return { redirectUrl };
}

async function completeAuthorization({ instance, body = {} }) {
  const samlResponse = body.SAMLResponse || body.samlResponse;
  if (!samlResponse) {
    throw adapterError('A SAMLResponse is required at the ACS endpoint.', 400);
  }
  const client = samlClient(instance.config);
  const { profile } = await client.validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) {
    throw adapterError('The SAML response did not contain a valid assertion.', 400);
  }
  return profile;
}

function mapClaims(profile = {}, instance = {}) {
  const config = instance.config || {};
  const attributes = {};
  for (const [key, value] of Object.entries(profile)) {
    if (!RESERVED_PROFILE_KEYS.has(key)) {
      attributes[key] = value;
    }
  }
  if (profile.attributes && typeof profile.attributes === 'object') {
    Object.assign(attributes, profile.attributes);
  }
  const mapped = applyAttributeMap(attributes, config.attributeMap);
  const email = mapped.email || profile.email || profile.mail || profile.nameID;
  const name = mapped.name || profile.displayName || profile.cn || email;
  const roleValue = config.roleAttribute ? attributes[config.roleAttribute] : mapped.roles;

  return buildClaims({
    protocol: PROTOCOL,
    instanceId: instance.id,
    issuer: profile.issuer || config.idpEntityId,
    rawSubject: profile.nameID || email,
    email,
    name,
    roles: roleValue,
    acr: 'urn:aegis-id:auth:upstream-saml'
  });
}

/** Parse IdP metadata XML into the three fields the config needs. */
async function parseMetadata(xml) {
  const parsed = await xml2js.parseStringPromise(xml, { tagNameProcessors: [xml2js.processors.stripPrefix], explicitArray: true });
  const descriptor = parsed?.EntityDescriptor || parsed?.EntitiesDescriptor?.EntityDescriptor?.[0];
  if (!descriptor) {
    throw adapterError('Could not find an EntityDescriptor in the metadata.', 400);
  }
  const entityId = descriptor.$?.entityID || '';
  const idp = Array.isArray(descriptor.IDPSSODescriptor) ? descriptor.IDPSSODescriptor[0] : descriptor.IDPSSODescriptor;
  let ssoUrl = '';
  const services = idp?.SingleSignOnService || [];
  for (const service of services) {
    if ((service.$?.Binding || '').includes('HTTP-Redirect')) {
      ssoUrl = service.$?.Location || ssoUrl;
    }
  }
  if (!ssoUrl && services[0]) {
    ssoUrl = services[0].$?.Location || '';
  }
  let cert = '';
  const keyDescriptors = idp?.KeyDescriptor || [];
  for (const kd of keyDescriptors) {
    if (kd.$?.use && kd.$.use !== 'signing') continue;
    const x509 = kd?.KeyInfo?.[0]?.X509Data?.[0]?.X509Certificate?.[0];
    if (x509) {
      cert = `-----BEGIN CERTIFICATE-----\n${String(x509).replace(/\s+/g, '')}\n-----END CERTIFICATE-----`;
      break;
    }
  }
  return { entityId, ssoUrl, cert };
}

async function test({ instance, sample = {}, fetchImpl = fetch }) {
  const config = instance.config || {};

  // 1. A real signed response is the strongest test: verify + map it.
  if (sample.samlResponse) {
    const profile = await completeAuthorization({ instance, body: { SAMLResponse: sample.samlResponse } });
    const claims = mapClaims(profile, instance);
    return { ok: true, title: 'Assertion verified', detail: `Signature valid, conditions in window, mapped ${Object.keys(claims).length} claims.`, claims };
  }

  // 2. Metadata (pasted or fetched) confirms the IdP coordinates and signing cert.
  let xml = sample.metadataXml;
  if (!xml && config.idpMetadataUrl) {
    const response = await fetchImpl(config.idpMetadataUrl);
    if (!response.ok) {
      return { ok: false, title: 'Metadata unreachable', detail: `IdP metadata returned HTTP ${response.status}.` };
    }
    xml = await response.text();
  }
  if (xml) {
    const meta = await parseMetadata(xml);
    return {
      ok: Boolean(meta.entityId && meta.ssoUrl && meta.cert),
      title: 'Metadata parsed',
      detail: `entityID ${meta.entityId || '—'}, SSO ${meta.ssoUrl || '—'}, signing cert ${meta.cert ? 'present' : 'missing'}.`,
      suggested: meta
    };
  }

  // 3. No sample: fall back to a config sanity check.
  const problems = validateConfig(config);
  return problems.length
    ? { ok: false, title: 'Configuration incomplete', detail: problems.join(' ') }
    : { ok: true, title: 'Configuration valid', detail: 'Paste a signed SAML response or metadata to run a live check.' };
}

module.exports = {
  describe,
  configSchema,
  normalizeConfig,
  validateConfig,
  startAuthorization,
  completeAuthorization,
  mapClaims,
  parseMetadata,
  test
};
