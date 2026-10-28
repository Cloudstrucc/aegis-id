const express = require('express');

const { authorize } = require('../middleware/authorization');
const {
  isEnabled,
  listCatalog,
  listInstances,
  getInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  runSelfTest,
  setDefaultSignInAdapter
} = require('../services/adapter-registry-service');

const router = express.Router();

const RESERVED_FIELDS = new Set(['_action', 'kind', 'name', 'status', 'firstFactor', 'satisfiesSecond', 'actorEmail']);

/** Everything the admin page needs, with an optional one-off test result. */
async function renderPage(res, extra = {}) {
  const [catalog, instances] = await Promise.all([Promise.resolve(listCatalog()), listInstances()]);
  res.render('pages/auth-adapters', {
    title: 'Authentication adapters',
    description: 'SAML, Kerberos and certificate adapters that front connected-app sign-in.',
    enabled: isEnabled(),
    catalog,
    instances,
    // This page also serves the organization-scoped surface at
    // /orgs/:handle/settings/adapters; the base path is what tells it where its
    // own forms post to.
    basePath: '/admin/auth-adapters',
    backHref: '/admin',
    backLabel: 'All platform settings',
    scopeLabel: 'Platform settings',
    // Designating the sign-in default decides how everybody signs in, so it is
    // offered only here.
    canSetSignInDefault: true,
    saved: null,
    errorMessage: null,
    testResult: null,
    ...extra
  });
}

/** Pull adapter config fields (everything that is not a reserved form field). */
function readConfig(body = {}) {
  const config = {};
  for (const [key, value] of Object.entries(body)) {
    if (!RESERVED_FIELDS.has(key)) {
      config[key] = value;
    }
  }
  return config;
}

router.get('/admin/auth-adapters', authorize('admin.authAdapters.manage'), async (req, res, next) => {
  try {
    await renderPage(res, { saved: req.query.saved || null, errorMessage: req.query.error || null });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/auth-adapters', authorize('admin.authAdapters.manage'), async (req, res, next) => {
  try {
    const { problems } = await createInstance({
      kind: req.body.kind,
      name: req.body.name,
      config: readConfig(req.body),
      actorEmail: req.user?.email
    });
    const flag = problems.length ? 'created-draft' : 'created';
    return res.redirect(303, `/admin/auth-adapters?saved=${flag}`);
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/admin/auth-adapters?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

router.post('/admin/auth-adapters/:id', authorize('admin.authAdapters.manage'), async (req, res, next) => {
  try {
    const action = req.body._action || 'update';
    if (action === 'delete') {
      await deleteInstance(req.params.id, { actorEmail: req.user?.email });
      return res.redirect(303, '/admin/auth-adapters?saved=deleted');
    }
    if (action === 'set-default') {
      await setDefaultSignInAdapter(req.params.id, { actorEmail: req.user?.email });
      return res.redirect(303, '/admin/auth-adapters?saved=default-set');
    }
    if (action === 'clear-default') {
      await setDefaultSignInAdapter('', { actorEmail: req.user?.email });
      return res.redirect(303, '/admin/auth-adapters?saved=default-cleared');
    }
    await updateInstance(req.params.id, {
      name: req.body.name,
      status: req.body.status,
      firstFactor: req.body.firstFactor === 'on' || req.body.firstFactor === 'true',
      satisfiesSecond: req.body.satisfiesSecond === 'on' || req.body.satisfiesSecond === 'true',
      config: Object.keys(readConfig(req.body)).length ? readConfig(req.body) : undefined,
      actorEmail: req.user?.email
    });
    return res.redirect(303, '/admin/auth-adapters?saved=updated');
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/admin/auth-adapters?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

// Self-test renders inline (rather than redirecting) so mapped claims can be
// shown without persisting any claim PII to the store.
router.post('/admin/auth-adapters/:id/test', authorize('admin.authAdapters.manage'), async (req, res, next) => {
  try {
    const instance = await getInstance(req.params.id);
    const result = await runSelfTest(req.params.id, readConfig(req.body), { actorEmail: req.user?.email });
    await renderPage(res, { testResult: { id: instance.id, name: instance.name, ...result } });
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/admin/auth-adapters?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

module.exports = router;
