const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Switching organization in the Business Expenses example.
//
// `examples/business-expenses` is a separate application with its own
// dependencies, and the root `npm test` does not run it — so this reads its
// source rather than exercising it. That is a real limit: these assertions
// prove the shape of the flow, not that it works end to end. What it works
// against was verified by hand.
//
// The bug it guards: choosing an organization set a session field and
// redirected. The holder asserted which organization they were acting in and
// the app believed them — no proof, no challenge, nothing addressed to the
// organization they picked. And the sign-in challenge was addressed to
// `AEGIS_ORGANIZATION_ID`, the organization the *deployment* was configured
// with, which need not be one the holder belongs to. A challenge addressed to
// an organization whose credential the holder does not hold reaches no wallet
// at all: it does not fail, it sits at `sent` until it expires while the
// browser polls a status that will never change.

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(
  path.join(ROOT, 'examples/business-expenses/src/server.js'),
  'utf8'
);
const CHOOSER = fs.readFileSync(
  path.join(ROOT, 'examples/business-expenses/views/pages/organizations.hbs'),
  'utf8'
);

test('choosing an organization raises a challenge rather than granting it', () => {
  // The whole point. A posted organization id is a request, and the wallet
  // answering a challenge addressed to that organization is what settles it.
  assert.match(SERVER, /action: 'switch-organization'/);
  assert.match(SERVER, /req\.session\.pendingOrganizationChallengeId = challenge\.id/);

  // The challenge names the organization that was picked, not the active one
  // and not the configured one — otherwise it reaches the wrong wallet, or
  // none.
  assert.match(
    SERVER,
    /const challenge = await createAegisChallenge\(\{\s*organizationId: chosen\.id/s
  );
});

test('the session only names an organization a wallet has approved', () => {
  // Applied on acceptance and nowhere else. Set at the point of choosing, the
  // challenge would be decoration.
  assert.match(
    SERVER,
    /if \(req\.session\.pendingOrganizationChallengeId === challenge\.id\) \{\s*req\.session\.activeOrganizationId = req\.session\.pendingOrganizationId/s
  );

  // And the old behaviour is gone: nothing assigns the active organization
  // straight from the posted body.
  assert.ok(
    !/req\.session\.activeOrganizationId = chosen\.id/.test(SERVER),
    'choosing still grants the organization without a challenge'
  );
});

test('a declined or unanswered switch changes nothing', () => {
  // The pending id is what carries the choice, so a challenge that is never
  // accepted leaves the session exactly as it was.
  assert.match(SERVER, /req\.session\.pendingOrganizationId = chosen\.id/);
  assert.match(SERVER, /delete req\.session\.pendingOrganizationChallengeId/);
  assert.match(SERVER, /delete req\.session\.pendingOrganizationId/);
});

test('the pending switch’s challenge page is reachable', () => {
  // `requireKnownChallenge` gates the challenge page. Without the switch's own
  // id it would refuse the page it just redirected to.
  assert.match(
    SERVER,
    /req\.session\.pendingOrganizationChallengeId === req\.params\.challengeId/
  );
});

test('a challenge is addressed to an organization the holder actually holds', () => {
  // `activeOrganizationId` falls back to AEGIS_ORGANIZATION_ID — right for
  // addressing data, wrong for addressing a challenge, because the deployment
  // is configured with an organization the holder need not belong to.
  assert.match(SERVER, /function challengeOrganizationId\(req\)/);

  // It prefers the active organization only when the holder is in it.
  assert.match(
    SERVER,
    /if \(active && held\.some\(\(organization\) => organization\.id === active\)\) \{\s*return active;/s
  );
  // Then one they do hold.
  assert.match(SERVER, /if \(held\.length > 0\) \{\s*return held\[0\]\.id;/s);

  // Every challenge call site uses it, not the data-addressing helper.
  const challengeSites = SERVER.match(/organizationId: challengeOrganizationId\(req\)/g) || [];
  assert.ok(
    challengeSites.length >= 3,
    `only ${challengeSites.length} challenge call sites address a held organization`
  );
});

test('an undeliverable challenge fails at creation instead of sitting at sent', () => {
  // The platform accepts a challenge with nothing to address it to and reports
  // it `sent`, which looks like success. Fifteen minutes of spinner later it
  // expires. Failing here keeps the cause visible.
  assert.match(
    SERVER,
    /if \(!input\.organizationId && !config\.issuerConnectionId\) \{\s*throw new Error\(/s
  );
  assert.match(SERVER, /Cannot raise a wallet challenge: no organization to address it to/);
});

test('the chooser says what choosing will do', () => {
  // A button that silently raises a challenge on a phone in somebody's pocket
  // is a surprise. It says so, and says what a decline does.
  assert.match(CHOOSER, /Choosing raises a wallet challenge for that organization/);
  assert.match(CHOOSER, /decline it and\s*nothing changes/);
  assert.match(CHOOSER, /Continue with wallet approval/);
});

test('only an organization on the holder’s own token is selectable', () => {
  // Unchanged, and worth keeping: a posted id cannot grant access to an
  // organization the holder does not belong to, challenge or no challenge.
  assert.match(
    SERVER,
    /const chosen = organizations\.find\(\(organization\) => organization\.id === req\.body\.organizationId\)/
  );
  assert.match(SERVER, /if \(!chosen\) \{[\s\S]{0,260}return res\.redirect\(303, '\/organizations'\)/);
});
