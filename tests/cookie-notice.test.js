const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The cookie notice and the page behind it.
//
// Two properties matter and neither is obvious from reading the diff.
//
// The first is that both reach somebody who is not signed in. The notice bar
// is on every page including the public ones, and the person most likely to
// follow it has no account — a 401 or a redirect to sign-in would make the
// notice point at a page its reader cannot open, and nothing in the suite
// would have noticed.
//
// The second is that the notice does not ask for consent. What this
// deployment stores is strictly necessary, so there is nothing to accept or
// refuse; an Accept/Decline pair whose Decline switches nothing off asks for
// a decision that does not exist. If somebody later adds those buttons
// without also adding the gate behind them, this test is what says so.

async function withApp(run) {
  for (const cached of Object.keys(require.cache)) {
    if (cached.includes(`${path.sep}src${path.sep}`)) {
      delete require.cache[cached];
    }
  }
  const { createApp } = require('../src/app');

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('/cookies sends an anonymous reader to the cookie section', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/cookies`, { redirect: 'manual' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/privacy#cookies');
  });
});

test('the cookie section renders to an anonymous visitor, naming every stored thing', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/privacy`, { redirect: 'manual' });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /id="cookies"/);

    // Each of these is genuinely set, so each has to be disclosed. A row
    // quietly dropped from the table is the failure this guards against.
    for (const name of ['aegis.sid', 'ARRAffinity', 'aegis-theme', 'aegis.cookie-notice']) {
      assert.ok(body.includes(name), `the cookie table does not mention ${name}`);
    }
  });
});

test('the notice bar is on a public page, hidden until the script has read storage', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /data-cookie-notice="v1"/);
    // Rendered hidden on purpose: revealing it from script means somebody who
    // has already dismissed it never sees it flash in and out.
    assert.match(body, /class="cookie-notice"[^>]*hidden/);
    assert.match(body, /href="\/privacy#cookies"/);
  });
});

test('the notice informs rather than asking for consent', () => {
  const partial = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'partials', 'cookie-notice.hbs'),
    'utf8'
  );

  assert.ok(
    !/data-cookie-(accept|decline)|>\s*(Accept|Decline)\s*</i.test(partial),
    'the notice offers a consent choice, but nothing non-essential is gated behind one'
  );
  assert.match(partial, /data-cookie-dismiss/);
});

test('nothing non-essential is loaded, which is what makes the notice truthful', () => {
  const roots = [
    path.join(__dirname, '..', 'views'),
    path.join(__dirname, '..', 'public', 'scripts')
  ];

  // The claim on the page is "no analytics, no tracking, no advertising".
  // That is only true while it is true, and it is the kind of thing a single
  // pasted snippet quietly falsifies.
  const trackers = /googletagmanager|google-analytics|gtag\(|segment\.(com|io)|hotjar|mixpanel|clarity\.ms|connect\.facebook\.net|doubleclick|plausible\.io|matomo/i;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(hbs|js)$/.test(entry.name)) {
        continue;
      }
      const source = fs.readFileSync(full, 'utf8');
      assert.ok(
        !trackers.test(source),
        `${path.relative(path.join(__dirname, '..'), full)} loads a third-party tracker, so the cookie notice is now wrong`
      );
    }
  };

  roots.forEach(walk);
});
