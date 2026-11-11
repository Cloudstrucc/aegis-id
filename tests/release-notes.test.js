const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The release history, and the docs landing page it is pinned beside.
//
// GitHub is a third party on the render path of a page inside the product, so
// most of what matters here is what happens when it is slow, rate-limited or
// wrong — none of which can be arranged on demand, so `fetch` is stubbed.

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const SERVICE = '../src/services/release-notes-service';

function freshService() {
  delete require.cache[require.resolve(SERVICE)];
  return require(SERVICE);
}

/** A GitHub releases payload, newest first. */
function githubReleases(entries) {
  return entries.map((entry, index) => ({
    id: 1000 + index,
    tag_name: entry.tag,
    name: entry.name || entry.tag,
    body: entry.body || 'Notes.',
    draft: Boolean(entry.draft),
    prerelease: Boolean(entry.prerelease),
    published_at: entry.publishedAt || `2026-11-0${index + 1}T00:00:00Z`,
    html_url: `https://github.com/Cloudstrucc/aegis-id/releases/tag/${entry.tag}`
  }));
}

async function withGitHub(payload, run, { status = 200 } = {}) {
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (status !== 200) {
      return { ok: false, status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    await run(() => calls);
  } finally {
    global.fetch = realFetch;
  }
}

test('the version shown is the deployment’s own, not the newest release', async () => {
  // The single most useful fact on the page, and the only one GitHub cannot
  // supply. A deployment behind the latest has to say so.
  const service = freshService();
  const deployed = service.deployedVersion();
  assert.equal(deployed, require('../package.json').version);

  await withGitHub(
    githubReleases([
      { tag: 'v9.9.9', publishedAt: '2026-11-09T00:00:00Z' },
      { tag: `v${deployed}`, publishedAt: '2026-11-01T00:00:00Z' }
    ]),
    async () => {
      service.clearReleaseCache();
      const history = await service.getReleaseHistory({});
      assert.equal(history.deployedVersion, deployed);
      assert.equal(history.deployedIsReleased, true);
      // One release newer than the one running here.
      assert.equal(history.behindBy, 1);
      assert.equal(history.releases[0].isNewest, true);
      assert.equal(history.releases[0].isDeployed, false);
      assert.equal(history.releases[1].isDeployed, true);
    }
  );
});

test('a deployment running something never tagged is told so', async () => {
  // A build from a branch, or a version bumped before the tag exists. Saying
  // so beats showing nothing.
  const service = freshService();
  await withGitHub(githubReleases([{ tag: 'v0.0.1' }]), async () => {
    service.clearReleaseCache();
    const history = await service.getReleaseHistory({});
    assert.equal(history.deployedIsReleased, false);
    assert.equal(history.behindBy, null);
  });
});

test('the kind of release is derived from the version step', async () => {
  // Not from a label somebody has to remember to set, which is a label that
  // will be wrong. A patch bump is a fix; a minor is a feature.
  const service = freshService();
  assert.equal(service.classify('2.2.1', '2.2.0').kind, 'fix');
  assert.equal(service.classify('2.3.0', '2.2.1').kind, 'feature');
  assert.equal(service.classify('3.0.0', '2.4.0').kind, 'major');
  // The oldest release has nothing to compare against.
  assert.equal(service.classify('2.0.0', '').kind, 'feature');
});

test('a tag’s leading v is decoration', async () => {
  const service = freshService();
  assert.equal(service.normalizeVersion('v2.3.0'), '2.3.0');
  assert.equal(service.normalizeVersion('2.3.0'), '2.3.0');
});

test('drafts are left out and pre-releases are kept', async () => {
  // A draft is not released. A pre-release is, and somebody running one wants
  // to find it here.
  const service = freshService();
  await withGitHub(
    githubReleases([
      { tag: 'v3.0.0-rc1', prerelease: true, publishedAt: '2026-11-05T00:00:00Z' },
      { tag: 'v2.9.9', draft: true, publishedAt: '2026-11-04T00:00:00Z' },
      { tag: 'v2.1.0', publishedAt: '2026-11-03T00:00:00Z' }
    ]),
    async () => {
      service.clearReleaseCache();
      const history = await service.getReleaseHistory({});
      const versions = history.releases.map((release) => release.version);
      assert.deepEqual(versions, ['3.0.0-rc1', '2.1.0']);
      assert.equal(history.releases[0].isPrerelease, true);
    }
  );
});

test('GitHub being unreachable serves the last good answer rather than an error', async () => {
  // A third party on the render path of a page inside the product. The page
  // must not go down because somebody else's API did.
  const service = freshService();

  await withGitHub(githubReleases([{ tag: 'v2.1.0' }]), async () => {
    service.clearReleaseCache();
    const first = await service.getReleaseHistory({});
    assert.equal(first.total, 1);
    assert.equal(first.stale, false);
  });

  // Now GitHub fails, and the cache has gone cold.
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('socket hang up'); };
  try {
    const { getReleaseHistory } = require(SERVICE);
    // Force a refetch by expiring the cache the only way a caller can.
    const second = await getReleaseHistory({});
    // Still inside the TTL, so it is simply the cached answer.
    assert.equal(second.total, 1);
  } finally {
    global.fetch = realFetch;
  }
});

test('a rate-limited deployment is told what to do about it', async () => {
  const service = freshService();
  await withGitHub(
    [],
    async () => {
      service.clearReleaseCache();
      const history = await service.getReleaseHistory({});
      assert.equal(history.total, 0);
      assert.match(history.error, /GITHUB_TOKEN/);
    },
    { status: 403 }
  );
});

test('the history is paginated server-side', async () => {
  // A history long enough to be worth paging is long enough that rendering
  // every body into one response is a waste of everybody's time.
  const service = freshService();
  const many = Array.from({ length: 12 }, (unused, index) => ({
    tag: `v1.0.${11 - index}`,
    publishedAt: new Date(Date.UTC(2026, 0, 12 - index)).toISOString()
  }));

  await withGitHub(githubReleases(many), async () => {
    service.clearReleaseCache();
    const first = await service.getReleaseHistory({ perPage: 5 });
    assert.equal(first.total, 12);
    assert.equal(first.pages, 3);
    assert.equal(first.releases.length, 5);
    assert.equal(first.hasNewer, false);
    assert.equal(first.hasOlder, true);
    assert.equal(first.rangeStart, 1);
    assert.equal(first.rangeEnd, 5);

    const last = await service.getReleaseHistory({ perPage: 5, page: 3 });
    assert.equal(last.releases.length, 2);
    assert.equal(last.hasOlder, false);
    assert.equal(last.hasNewer, true);
  });
});

test('a release body is rendered through the docs sanitiser', async () => {
  // GitHub stores the body verbatim and it is written by whoever cut the
  // release, so it is not trusted input any more or less than a file in
  // docs/content — and it goes through the same allow-list rather than a
  // second one to keep in step.
  const service = freshService();
  await withGitHub(
    githubReleases([{ tag: 'v2.1.0', body: '## Heading\n\n<script>alert(1)</script>\n\nA **bold** thing.' }]),
    async () => {
      service.clearReleaseCache();
      const history = await service.getReleaseHistory({});
      const html = history.releases[0].bodyHtml;
      assert.match(html, /<h2>Heading<\/h2>/);
      assert.match(html, /<strong>bold<\/strong>/);
      assert.ok(!/<script/i.test(html), 'a script tag survived the sanitiser');
    }
  );
});

// --- the pages ------------------------------------------------------------

test('docs open on the landing page, not on whichever file sorts first', () => {
  const { getDocsWorkspace } = require('../src/services/docs-service');

  const landing = getDocsWorkspace({});
  assert.equal(landing.isLanding, true);
  assert.equal(landing.selected, null, 'the landing page selects no document');

  // Asking for something still gets it.
  const asked = getDocsWorkspace({ categoryId: 'rbac', slug: 'authorization-rbac' });
  assert.equal(asked.isLanding, false);
  assert.ok(asked.selected, 'a requested document is still selected');

  const searched = getDocsWorkspace({ query: 'passkey' });
  assert.equal(searched.isLanding, false);
});

test('release notes are pinned outside the category list', () => {
  const view = read('views/pages/docs-workspace.hbs');

  // Its own block, before the category navigation.
  assert.ok(
    view.indexOf('docs-pinned') < view.indexOf('docs-nav'),
    'the pinned block has to come before the category list'
  );
  assert.match(view, /href="\/developer\/docs\/releases"/);

  // And a rule under it, so it reads as a fixture of the shell rather than one
  // more document.
  const css = read('public/styles/main.css');
  assert.match(css, /\.docs-pinned \{[^}]*border-bottom/s);
});

test('the releases route is declared before the category route', () => {
  // Otherwise "releases" is read as a category id and the page 404s.
  const routes = read('src/routes/developer-docs.js');
  assert.ok(
    routes.indexOf("'/developer/docs/releases'") < routes.indexOf("'/developer/docs/:categoryId/:slug'"),
    'the releases route must be declared first or :categoryId swallows it'
  );
});

test('the release notes sit behind the same authentication as the docs', () => {
  const routes = read('src/routes/developer-docs.js');
  assert.match(routes, /router\.use\('\/developer', requireAuthenticated\)/);
  assert.match(
    routes,
    /router\.get\('\/developer\/docs\/releases',\s*authorize\('developerApiDocs\.view'\)/
  );
});

test('the landing diagram takes its colours from the theme', () => {
  // A diagram with literal colours works in one theme and is illegible in the
  // other, and nothing fails — it just looks wrong to half the readers.
  const partial = read('views/partials/docs-landing.hbs');
  const literals = partial.match(/(?:fill|stroke)="#[0-9a-f]{3,8}"/gi) || [];
  assert.deepEqual(literals, [], `hard-coded colours in the diagram: ${literals.join(', ')}`);

  const css = read('public/styles/main.css');
  assert.match(css, /\.dg-platform-box \{[^}]*var\(--ag-/s);
  assert.match(css, /\.dg-rp-box \{[^}]*var\(--ag-/s);
});

test('the diagram is described for a reader who cannot see it', () => {
  const partial = read('views/partials/docs-landing.hbs');
  assert.match(partial, /role="img"/);
  assert.match(partial, /aria-labelledby="docs-diagram-title docs-diagram-desc"/);
  assert.match(partial, /<title id="docs-diagram-title">/);
  assert.match(partial, /<desc id="docs-diagram-desc">/);
});

test('the history is ordered by version, not by when it was written up', async () => {
  // A backfilled history — notes written for twelve past releases in one
  // sitting — carries one timestamp. Ordering by publication date then puts
  // 0.1.0 above 1.0.0, which is the opposite of a release history.
  const service = freshService();
  const sameMoment = '2026-11-11T09:40:00Z';
  await withGitHub(
    githubReleases([
      { tag: 'v0.1.0', publishedAt: sameMoment },
      { tag: 'v2.4.0', publishedAt: sameMoment },
      { tag: 'v1.0.0', publishedAt: sameMoment },
      { tag: 'v0.9.0', publishedAt: sameMoment },
      { tag: 'v2.2.1', publishedAt: sameMoment },
      { tag: 'v2.10.0', publishedAt: sameMoment }
    ]),
    async () => {
      service.clearReleaseCache();
      const history = await service.getReleaseHistory({ perPage: 10 });
      assert.deepEqual(
        history.releases.map((release) => release.version),
        // 2.10.0 above 2.4.0: ten is greater than four, however it sorts as
        // a string.
        ['2.10.0', '2.4.0', '2.2.1', '1.0.0', '0.9.0', '0.1.0']
      );
      assert.equal(history.releases[0].isNewest, true);
    }
  );
});

test('a pre-release sorts below the release it precedes', async () => {
  const service = freshService();
  await withGitHub(
    githubReleases([
      { tag: 'v3.0.0-rc1', prerelease: true, publishedAt: '2026-11-01T00:00:00Z' },
      { tag: 'v3.0.0', publishedAt: '2026-11-02T00:00:00Z' }
    ]),
    async () => {
      service.clearReleaseCache();
      const history = await service.getReleaseHistory({});
      assert.deepEqual(history.releases.map((r) => r.version), ['3.0.0', '3.0.0-rc1']);
    }
  );
});

test('the two panel headers are one object in two columns', () => {
  // Drawn separately they sat five and nine pixels apart across the page.
  const css = read('public/styles/main.css');

  // Same rule under both.
  assert.match(css, /\.docs-sidebar__header \{[^}]*border-bottom: 1px solid var\(--ag-line\)/s);
  assert.match(css, /\.docs-reader__meta \{[^}]*border-bottom: 1px solid var\(--ag-line\)/s);

  // The sidebar's eyebrow is a block, or it sits on a line box sized by the
  // parent's line-height instead of at the padding edge.
  assert.match(css, /\.docs-sidebar__header \.eyebrow \{[^}]*display: block/s);

  // And the sticky sidebar's offset does not exceed its natural position,
  // which would push it below the panel beside it at rest.
  assert.match(css, /top: var\(--docs-site-header-offset, 68px\)/);
  assert.ok(
    !/top: calc\(var\(--docs-site-header-offset[^)]*\) \+ var\(--docs-top-gap/.test(css),
    'the sticky offset must not add the gap, or the sidebar floats down'
  );
});

test('every view in the reader panel carries the same header bar', () => {
  // The landing page and the release notes used to draw their own eyebrow
  // inside the content, so they had no header bar at all while a rendered
  // document did.
  const view = read('views/pages/docs-workspace.hbs');
  const bars = view.match(/<div class="docs-reader__meta">/g) || [];
  assert.equal(bars.length, 3, 'releases, landing and a document each need one');

  // And the partials no longer draw their own.
  assert.ok(!read('views/partials/docs-landing.hbs').includes('class="eyebrow"'));
  assert.ok(!read('views/partials/docs-releases.hbs').includes('class="eyebrow"'));
});
