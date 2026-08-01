const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { buildAccountLanding } = require('../services/account-landing-service');

const router = express.Router();

// Kept so existing links and bookmarks resolve. The signed-in landing page is
// "/", which renders the same view.
router.get('/account', requireAuthenticated, authorize('account.view'), async (req, res, next) => {
  try {
    const landing = await buildAccountLanding(req.user);
    if (landing.redirectTo) {
      return res.redirect(303, landing.redirectTo);
    }
    res.render('pages/account', landing.view);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
