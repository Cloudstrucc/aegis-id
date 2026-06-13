const express = require('express');
const QRCode = require('qrcode');

const config = require('../config');
const { getPresentationPolicy } = require('../services/credential-policy-service');
const { getHomeContent } = require('../services/home-content');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/home', getHomeContent());
});

router.get('/architecture', (req, res) => {
  res.render('pages/architecture', {
    title: 'Architecture',
    description: 'Cloudstrucc Aegis ID reference architecture.',
    policy: getPresentationPolicy(),
    microsoftMode: config.verifiedId.mode
  });
});

router.get('/lab/mock-wallet/:kind/:state', async (req, res, next) => {
  try {
    const publicBaseUrl = config.app.publicBaseUrl.replace(/\/$/, '');
    const requestUrl = `${publicBaseUrl}${req.originalUrl}`;
    const qrCodeDataUrl = await QRCode.toDataURL(requestUrl, { margin: 1, width: 460 });

    res.render('pages/mock-wallet', {
      title: 'Mock wallet handoff',
      description: 'Local mock wallet handoff for demo requests.',
      kind: req.params.kind,
      state: req.params.state,
      requestUrl,
      qrCodeDataUrl
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
