const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Phase B of custom domains: the shared chrome reads the site's branding
// rather than naming Vanguard, and outbound messages name the brand they
// are sent for. On the platform host nothing visible changes.

const ROOT = path.resolve(__dirname, '..');

test('platform branding is the Aegis ID defaults, and an organization record overrides them', () => {
  const { platformBranding, normalizeBranding } = require('../src/services/site-context-service');
  const platform = platformBranding();
  assert.equal(platform.appName, 'Aegis ID');
  assert.equal(platform.shortName, 'Aegis ID');
  assert.equal(platform.logoUrl, '/images/brand/aegis-id-lockup-white.svg');
  assert.equal(platform.logoMarkUrl, '/images/brand/aegis-mark-white.svg');
  assert.equal(platform.poweredByHidden, true, 'the platform never says "powered by" itself');

  const contoso = normalizeBranding({
    displayName: 'Contoso',
    productName: 'Contoso ID',
    logoDataUrl: 'data:image/png;base64,AAAA',
    supportEmail: 'help@contoso.example',
    poweredByHidden: false
  });
  assert.equal(contoso.appName, 'Contoso - Contoso ID');
  assert.equal(contoso.shortName, 'Contoso ID');
  assert.equal(contoso.logoUrl, 'data:image/png;base64,AAAA');
  assert.equal(contoso.logoAlt, 'Contoso');
  assert.equal(contoso.poweredByHidden, false);

  // Name only: the product stays Aegis ID, as the blade promises.
  assert.equal(normalizeBranding({ displayName: 'Contoso' }).shortName, 'Aegis ID');
});

test('the shared chrome carries no hard-coded platform name', () => {
  for (const relative of ['views/partials/site-header.hbs', 'views/partials/site-footer.hbs', 'views/pages/not-found.hbs']) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.doesNotMatch(source, /Vanguard Cloud Services/, `${relative} names the platform directly`);
    assert.doesNotMatch(source, /vanguard-cloud-services-logo/, `${relative} links the platform logo directly`);
  }
});

test('messages name the brand they are sent for', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/services/otp-delivery-service.js'), 'utf8');
  const templates = source.slice(source.indexOf('const TEMPLATES'), source.indexOf('\n};', source.indexOf('const TEMPLATES')));
  assert.doesNotMatch(templates, /Aegis ID/, 'a template still says "Aegis ID" instead of ${brand}');
});

test('org branding stores the site identity fields', async (t) => {
  const os = require('node:os');
  const fsp = require('node:fs/promises');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vanguard-branding-'));
  const vars = ['SUBSCRIBER_WORKSPACE_STORE_PATH', 'ORG_ADMIN_STORE_PATH', 'ORG_ADMIN_EVENT_STORE_PATH'];
  const previous = Object.fromEntries(vars.map((name) => [name, process.env[name]]));
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(tempDir, 'workspaces.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(tempDir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(tempDir, 'events.json');
  for (const mod of ['../src/config', '../src/services/platform-service', '../src/services/org-admin-service']) {
    delete require.cache[require.resolve(mod)];
  }
  t.after(() => {
    for (const name of vars) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    for (const mod of ['../src/config', '../src/services/platform-service', '../src/services/org-admin-service']) {
      delete require.cache[require.resolve(mod)];
    }
  });

  const workspace = { id: 'org-brand', subscriptionId: 'sub-brand', organization: 'Contoso', ownerEmail: 'admin@contoso.example', members: [{ email: 'admin@contoso.example', role: 'administrator', addedAt: new Date().toISOString() }], platforms: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await fsp.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace]), 'utf8');
  const subscription = { id: 'sub-brand', email: 'admin@contoso.example', organization: 'Contoso' };
  const { updateBranding } = require('../src/services/org-admin-service');

  const branding = await updateBranding(workspace, subscription, {
    paletteId: 'vanguard',
    displayName: '  Contoso  ',
    productName: 'Contoso ID',
    faviconDataUrl: 'data:image/png;base64,AAAA',
    supportEmail: 'Help@Contoso.Example',
    poweredByHidden: 'on'
  });
  assert.equal(branding.displayName, 'Contoso');
  assert.equal(branding.productName, 'Contoso ID');
  assert.equal(branding.faviconDataUrl, 'data:image/png;base64,AAAA');
  assert.equal(branding.supportEmail, 'help@contoso.example');
  assert.equal(branding.poweredByHidden, true);

  // A favicon that is not an icon is dropped; the previous one is kept.
  const again = await updateBranding(workspace, subscription, { paletteId: 'vanguard', faviconDataUrl: 'data:text/html;base64,AAAA' });
  assert.equal(again.faviconDataUrl, 'data:image/png;base64,AAAA');
  assert.equal(again.poweredByHidden, false, 'an unchecked box is false');

  const removed = await updateBranding(workspace, subscription, { paletteId: 'vanguard', removeFavicon: '1' });
  assert.equal(removed.faviconDataUrl, '');
});
