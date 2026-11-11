const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { buildAccountLanding } = require('../services/account-landing-service');
const { setUserLocale } = require('../services/auth-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();

// Kept so existing links and bookmarks resolve. The signed-in landing page is
// "/", which renders the same view.
router.get('/account', requireAuthenticated, authorize('account.view'), async (req, res, next) => {
  try {
    const landing = await buildAccountLanding(req.user, { session: req.session });
    res.render('pages/account', landing.view);
  } catch (error) {
    next(error);
  }
});

/**
 * Change the language this account is written to in.
 *
 * A preference about the person's own account, so it needs no privilege
 * beyond being signed in — `account.view` is the same gate the page itself
 * uses. The value is validated against the supported list by the service;
 * anything else clears the preference rather than being stored.
 *
 * Redirects back to where the form was submitted from, because the control
 * lives in the profile modal and that is on every page.
 */
router.post('/account/language', requireAuthenticated, authorize('account.view'), async (req, res, next) => {
  try {
    const locale = String(req.body.locale || '');
    const updated = await setUserLocale(req.user.id, locale);
    await writeAuditEvent('account.locale.changed', {
      userId: req.user.id,
      locale: updated.locale || 'default'
    });
    // Same-origin only: a returnTo from the form is attacker-controllable,
    // so anything that is not a local path falls back to the account page.
    const back = String(req.body.returnTo || '');
    const safe = /^\/(?!\/)/.test(back) ? back : '/account';
    res.redirect(303, safe);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
