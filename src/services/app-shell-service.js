// What the authenticated application chrome holds on a given page.
//
// One sidebar across the whole product, rather than a different navigation on
// each surface. Before this, the dashboard carried its own icon rail and menu
// blade, the organization settings pages carried a breadcrumb and a back link,
// and the platform pages carried nothing at all — which is how two of them
// shipped reachable only by typing the URL (AGENTS.md records both).
//
// The three groups are the three scopes the product actually has, named so the
// reader can tell what a setting applies to:
//
//   Workspace     — this organization's day-to-day surfaces. On the dashboard
//                   these are its own in-page blades, so the items are the
//                   hash links the blade script already understands.
//   Organization  — settings for the organization, keyed on its handle.
//   Platform      — deployment-wide settings. Only for a subscriber who
//                   administers their own organization; `isGlobalAdmin` is the
//                   same gate the header's Platform link uses, which
//                   admin-access-service has already filtered portal accounts
//                   out of.
//
// Nothing here grants anything. Every route still enforces its own privilege
// server-side; this decides what to draw a link to.

const { iconSvg } = require('../lib/app-icons');

// Only the application surfaces get the shell. The anonymous pages, the
// sign-in and recovery flows, checkout and the rendered documents keep the
// plain single-column layout — a sidebar of organization settings on a sign-in
// page would be navigation to somewhere the reader cannot go yet.
const SHELL_PREFIXES = ['/dashboard', '/admin', '/organizations', '/account', '/testing'];

// The signed-in landing page. Not a prefix, because every path starts with
// "/" — it is the one exact path that takes the shell.
const SHELL_EXACT_PATHS = ['/'];

/** The icon for each dashboard blade, by the blade key the service emits. */
const BLADE_ICONS = {
  dashboard: 'grid',
  people: 'people',
  credentials: 'badge',
  roles: 'shield',
  claims: 'tag',
  'org-structure': 'sitemap',
  branding: 'palette',
  'connected-apps': 'plug',
  platforms: 'link',
  'issuer-orgs': 'building',
  'wallet-recovery': 'lifebuoy',
  'wallet-events': 'activity',
  ledger: 'chain',
  'admin-verification': 'idcheck',
  settings: 'gear'
};

const PLATFORM_ITEMS = [
  { key: 'admin', href: '/admin', label: 'Administration', icon: 'sliders' },
  { key: 'admin-sign-in', href: '/admin/sign-in-methods', label: 'Sign-in methods', icon: 'key' },
  { key: 'admin-adapters', href: '/admin/auth-adapters', label: 'Authentication adapters', icon: 'plug' },
  { key: 'admin-notifications', href: '/admin/notifications', label: 'Notification delivery', icon: 'bell' },
  { key: 'admin-wallets', href: '/admin/wallets', label: 'Registered wallets', icon: 'phone' },
  { key: 'admin-domains', href: '/admin/domains', label: 'Organization domains', icon: 'globe' },
  { key: 'admin-codes', href: '/admin/registration-codes', label: 'Registration codes', icon: 'ticket' },
  { key: 'admin-break-glass', href: '/admin/break-glass', label: 'Break-glass recovery', icon: 'alert' },
  { key: 'admin-recovery', href: '/admin/account-recovery', label: 'Account recovery', icon: 'rotate' }
];

/**
 * The shell for one render, or null for a page that does not take one.
 *
 * Built from the merged locals of the response rather than from the request
 * alone, because the useful parts are what the route looked up: the blade
 * navigation the dashboard already computes for the viewer, and the dashboard
 * path that names the subscription and the workspace.
 */
function buildAppShell(locals = {}) {
  const currentPath = String(locals.currentPath || '');
  if (!locals.isAuthenticated) {
    return null;
  }
  const isOrgSettings = /^\/orgs\/[^/]+\/settings/.test(currentPath);
  const isShellPath =
    SHELL_EXACT_PATHS.includes(currentPath) ||
    SHELL_PREFIXES.some((prefix) => currentPath === prefix || currentPath.startsWith(`${prefix}/`));
  if (!isOrgSettings && !isShellPath) {
    return null;
  }

  const sections = [
    ...workspaceSections(locals),
    ...organizationSection(locals, currentPath),
    ...platformSection(locals, currentPath)
  ].filter((section) => section.items.length > 0);

  // The blade links are in-page anchors, so the active one is decided by the
  // blade script once it knows the hash. Marking one here as well would show
  // two active rows for the first frame.
  const hasBlades = sections.some((section) => section.items.some((item) => item.isBlade));

  return {
    sections,
    hasBlades,
    crumbs: buildCrumbs(locals, currentPath),
    organization: locals.currentTenant
      ? {
          name: locals.currentTenant.organization,
          initials: locals.currentTenant.initials,
          logoDataUrl: locals.currentTenant.logoDataUrl || '',
          logoScale: locals.currentTenant.logoScale || 82,
          primaryColor: locals.currentTenant.primaryColor || '',
          accentColor: locals.currentTenant.accentColor || '',
          handle: locals.currentTenant.handle,
          href: locals.currentTenant.settingsPath || locals.currentTenant.publicPath || '/organizations'
        }
      : null,
    viewer: locals.headerProfile
      ? {
          name: locals.headerProfile.displayName,
          initials: locals.headerProfile.initials,
          roleLabel: locals.currentTenant?.roleLabel || 'Credential holder'
        }
      : null,
    advice: locals.orgAdmin?.viewer?.nextActionAdvice || ''
  };
}

/**
 * The dashboard's own blades, as the sidebar's first groups.
 *
 * Taken from the view the dashboard route already built for this viewer, so
 * the sidebar shows exactly the blades that exist on the page — one list, one
 * set of privilege checks, no second copy to fall out of step. Off the
 * dashboard there are no blades to link to, and the group becomes a single
 * entry pointing at the workspace itself.
 */
function workspaceSections(locals) {
  const bladeSections = Array.isArray(locals.orgAdmin?.bladeNavSections) ? locals.orgAdmin.bladeNavSections : [];
  if (bladeSections.length) {
    return bladeSections.map((section) => ({
      label: section.label,
      items: (section.items || []).map((item) => ({
        key: item.key,
        href: item.href,
        label: item.label,
        iconName: BLADE_ICONS[item.key] || 'grid',
        isBlade: true,
        statusTone: item.statusTone || '',
        statusLabel: item.statusLabel || ''
      }))
    }));
  }

  const items = [];
  if (locals.dashboardBasePath) {
    items.push({ key: 'dashboard', href: locals.dashboardBasePath, label: 'Workspace dashboard', iconName: 'grid' });
  }
  if (locals.organizationsPath) {
    items.push({ key: 'organizations', href: locals.organizationsPath, label: 'Organizations', iconName: 'building' });
  }
  items.push({ key: 'account', href: '/account', label: 'Your account', iconName: 'user' });
  return [{ label: 'Workspace', items }];
}

/**
 * Settings for the organization in scope.
 *
 * Keyed on the handle rather than on the subscription that pays for it, so an
 * administrator who was invited to the organization gets the same addresses as
 * the subscriber who created it. Shown to any administrator of it; the domain
 * and root-wallet pages still live behind the settings index, which is where
 * the subscription-scoped paths they need are resolved.
 */
function organizationSection(locals, currentPath) {
  const tenant = locals.currentTenant;
  if (!tenant?.handle || !locals.canAdministerTenant || !tenant.settingsPath) {
    return [];
  }
  const base = `/orgs/${tenant.handle}/settings`;
  const items = [
    { key: 'org-settings', href: base, label: 'Organization settings', iconName: 'gear' },
    { key: 'org-adapters', href: `${base}/adapters`, label: 'Authentication adapters', iconName: 'plug' },
    { key: 'org-wallets', href: `${base}/wallets`, label: 'Registered wallets', iconName: 'phone' }
  ];
  return [{ label: 'Organization', items: items.map((item) => markActive(item, currentPath)) }];
}

function platformSection(locals, currentPath) {
  if (!locals.isGlobalAdmin) {
    return [];
  }
  return [
    {
      label: 'Platform',
      items: PLATFORM_ITEMS.map((item) => markActive({ ...item, iconName: item.icon }, currentPath))
    }
  ];
}

/**
 * Exact match only.
 *
 * A prefix match would light up "Administration" on every page under /admin,
 * so the sidebar would claim the reader is on the index while they are on
 * Sign-in methods. The index is a page in its own right here, not a parent.
 */
function markActive(item, currentPath) {
  return { ...item, isActive: item.href === currentPath };
}

/**
 * Where the reader is, in the shape "scope / page".
 *
 * The organization pages were the only ones that had a breadcrumb, built into
 * each template. Doing it here puts the same trail on every application page,
 * and lets the organization templates drop their own.
 */
function buildCrumbs(locals, currentPath) {
  const scopeHref = locals.currentTenant?.settingsPath || '/organizations';

  if (currentPath.startsWith('/admin')) {
    const current = PLATFORM_ITEMS.find((item) => item.href === currentPath);
    const crumbs = [{ label: 'Platform', href: '/admin' }];
    if (current && current.href !== '/admin') {
      crumbs.push({ label: current.label });
    } else {
      crumbs.push({ label: 'Administration' });
    }
    return crumbs;
  }

  if (/^\/orgs\/[^/]+\/settings/.test(currentPath)) {
    const crumbs = [
      { label: locals.currentTenant?.organization || 'Organization', href: scopeHref },
      { label: locals.title || 'Settings' }
    ];
    return currentPath.endsWith('/settings') ? [crumbs[0], { label: 'Settings' }] : crumbs;
  }

  if (currentPath.startsWith('/dashboard')) {
    return [
      { label: locals.workspace?.organization || locals.currentTenant?.organization || 'Workspace', href: scopeHref },
      { label: locals.title === 'Subscriber Dashboard' ? 'Dashboard' : locals.title || 'Dashboard' }
    ];
  }

  if (currentPath.startsWith('/organizations')) {
    return [{ label: 'Workspace', href: scopeHref }, { label: 'Organizations' }];
  }

  if (currentPath === '/account') {
    return [{ label: 'Workspace', href: scopeHref }, { label: 'Your account' }];
  }

  if (currentPath.startsWith('/testing')) {
    return [{ label: 'Workspace', href: scopeHref }, { label: 'Testing' }];
  }

  return [{ label: locals.title || 'Aegis ID' }];
}

module.exports = { buildAppShell, iconSvg, SHELL_EXACT_PATHS, SHELL_PREFIXES, PLATFORM_ITEMS, BLADE_ICONS };
