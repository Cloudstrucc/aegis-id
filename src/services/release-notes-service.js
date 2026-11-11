// The release history, read from the repository that produces this platform.
//
// Releases are written once, in one place — GitHub — and read here. The
// alternative was a file in the repo that somebody has to remember to update
// at the same moment they tag, which is the kind of duplication that is
// correct for exactly one release.
//
// Three things this has to get right:
//
//   * **It must never take the page down.** GitHub is a third party on the
//     render path of a page inside the product. Every answer is cached, and a
//     failed fetch serves the last good one with the time it was taken rather
//     than an error.
//   * **"Which version am I on" is the deployment's own, not the newest
//     release.** An environment behind the latest should say so; that is the
//     single most useful fact on the page and the only one GitHub cannot
//     supply.
//   * **A release body is Markdown** and goes through the same renderer and
//     the same sanitiser as the docs, rather than a second pipeline with a
//     second allow-list to keep in step.

const { execFileSync } = require('node:child_process');
const config = require('../config');
const { renderMarkdown } = require('./docs-service');

const GITHUB_API = 'https://api.github.com';

// One page of 100 covers every release this product will have for years, and
// asking for one page keeps the unauthenticated rate limit (60/hour, shared by
// the whole deployment) out of the picture.
const PER_PAGE = 100;

let cache = { at: 0, releases: null, error: null };

function repoSlug() {
  return config.releases?.repo || 'Cloudstrucc/aegis-id';
}

function cacheTtlMs() {
  return (config.releases?.cacheSeconds || 900) * 1000;
}

/**
 * The version this deployment is running.
 *
 * From package.json, which is what the running process actually is. Not the
 * newest release — a deployment behind the latest is exactly the case worth
 * showing.
 */
function deployedVersion() {
  try {
    // eslint-disable-next-line global-require
    return String(require('../../package.json').version || '').trim();
  } catch {
    return '';
  }
}

/**
 * A date a person reads, in the product's own locale.
 *
 * An ISO timestamp is correct and unreadable; the page shows "6 Nov 2026" and
 * keeps the ISO string in the markup for anything that needs to sort.
 */
function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** `v2.3.0` and `2.3.0` are the same version; the tag's `v` is decoration. */
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function parseVersion(value) {
  const parts = normalizeVersion(value).split('.').map((part) => Number.parseInt(part, 10));
  return {
    major: Number.isFinite(parts[0]) ? parts[0] : null,
    minor: Number.isFinite(parts[1]) ? parts[1] : null,
    patch: Number.isFinite(parts[2]) ? parts[2] : null
  };
}

/**
 * What kind of release this is, from the step between it and the one before.
 *
 * Derived rather than tagged, because a label somebody has to remember to set
 * is a label that will be wrong. A patch bump is a fix; anything larger is a
 * feature release. The oldest release has nothing before it to compare with
 * and is simply a release.
 */
function classify(version, previousVersion) {
  const current = parseVersion(version);
  const previous = parseVersion(previousVersion);
  if (current.major === null) {
    return { kind: 'release', label: 'Release' };
  }
  if (!previousVersion || previous.major === null) {
    return { kind: 'feature', label: 'Release' };
  }
  if (current.major === previous.major && current.minor === previous.minor) {
    return { kind: 'fix', label: 'Fix' };
  }
  if (current.major !== previous.major) {
    return { kind: 'major', label: 'Major' };
  }
  return { kind: 'feature', label: 'Feature' };
}

async function fetchReleases() {
  const url =
    `${GITHUB_API}/repos/${repoSlug()}/releases?per_page=${PER_PAGE}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub refuses a request with no User-Agent. Named for the product, not
    // for whoever is reading the page — nothing about the viewer is sent.
    'User-Agent': 'aegis-id-release-notes'
  };
  if (config.releases?.token) {
    headers.Authorization = `Bearer ${config.releases.token}`;
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const detail = response.status === 403
      ? 'GitHub rate-limited this deployment. Set GITHUB_TOKEN to raise the limit.'
      : `GitHub answered ${response.status}.`;
    throw new Error(detail);
  }
  return response.json();
}

/**
 * Every release, newest first, decorated with what the page needs.
 *
 * Drafts are left out — they are not released. Pre-releases are kept and
 * marked, because somebody running one wants to find it here.
 */
async function loadReleases({ force = false } = {}) {
  const fresh = Date.now() - cache.at < cacheTtlMs();
  if (!force && fresh && cache.releases) {
    return { releases: cache.releases, fetchedAt: cache.at, stale: false, error: null };
  }

  try {
    const raw = await fetchReleases();
    const published = (Array.isArray(raw) ? raw : [])
      .filter((release) => !release.draft)
      .sort((left, right) => new Date(right.published_at || 0) - new Date(left.published_at || 0));

    const releases = published.map((release, index) => {
      const version = normalizeVersion(release.tag_name);
      // The one published before it, which is the next in this list.
      const previous = published[index + 1];
      const kind = classify(version, previous ? normalizeVersion(previous.tag_name) : '');
      return {
        id: String(release.id),
        version,
        tag: release.tag_name,
        name: release.name || release.tag_name,
        publishedAt: release.published_at,
        publishedLabel: formatDate(release.published_at),
        isPrerelease: Boolean(release.prerelease),
        url: release.html_url,
        kind: kind.kind,
        kindLabel: kind.label,
        bodyHtml: renderMarkdown(release.body || '_No notes were written for this release._')
      };
    });

    cache = { at: Date.now(), releases, error: null };
    return { releases, fetchedAt: cache.at, stale: false, error: null };
  } catch (error) {
    // A third party on the render path of a page inside the product. The last
    // good answer, with the time it was taken, beats an error page.
    cache.error = error.message;
    if (cache.releases) {
      return { releases: cache.releases, fetchedAt: cache.at, stale: true, error: error.message };
    }
    return { releases: [], fetchedAt: null, stale: true, error: error.message };
  }
}

/**
 * The release history as the page renders it.
 *
 * Paginated server-side: a history long enough to be worth paging is also long
 * enough that rendering every body into one response is a waste of everybody's
 * time.
 */
async function getReleaseHistory({ version, page = 1, perPage = 8 } = {}) {
  const { releases, fetchedAt, stale, error } = await loadReleases();
  const deployed = deployedVersion();

  const decorated = releases.map((release) => ({
    ...release,
    isDeployed: Boolean(deployed) && release.version === deployed,
    isNewest: false
  }));
  if (decorated.length > 0) {
    decorated[0].isNewest = true;
  }

  const total = decorated.length;
  const size = Math.min(Math.max(Number.parseInt(perPage, 10) || 8, 1), 50);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(Number.parseInt(page, 10) || 1, 1), pages);
  const start = (current - 1) * size;
  const visible = decorated.slice(start, start + size);

  // Which release the reader is looking at. A version in the URL wins; failing
  // that the one this deployment runs, so the page opens on the notes for the
  // build in front of them; failing that the newest.
  const requested = normalizeVersion(version);
  const selected =
    (requested && decorated.find((release) => release.version === requested)) ||
    (visible.find((release) => release.isDeployed)) ||
    visible[0] ||
    null;

  // A deployment can be running something that was never released — a build
  // from a branch, or a version bumped but not yet tagged. Saying so is more
  // useful than showing nothing.
  const deployedRelease = decorated.find((release) => release.isDeployed) || null;

  return {
    releases: visible.map((release) => ({
      ...release,
      isSelected: selected ? release.id === selected.id : false
    })),
    selected,
    deployedVersion: deployed,
    deployedIsReleased: Boolean(deployedRelease),
    // How far behind the deployment is, which is the question somebody opens
    // this page to answer.
    behindBy: deployedRelease
      ? decorated.findIndex((release) => release.isDeployed)
      : null,
    total,
    page: current,
    pages,
    perPage: size,
    hasNewer: current > 1,
    hasOlder: current < pages,
    newerPage: current - 1,
    olderPage: current + 1,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + size, total),
    repo: repoSlug(),
    repoUrl: `https://github.com/${repoSlug()}/releases`,
    fetchedAt: fetchedAt ? formatDate(fetchedAt) : null,
    stale,
    error
  };
}

/** Tests and the admin refresh need a way to drop the cache. */
function clearReleaseCache() {
  cache = { at: 0, releases: null, error: null };
}

module.exports = {
  classify,
  clearReleaseCache,
  deployedVersion,
  getReleaseHistory,
  normalizeVersion
};
