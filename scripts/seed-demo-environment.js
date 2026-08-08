#!/usr/bin/env node

// Seed a demo environment worth recording against.
//
// An empty deployment undersells the product: a dashboard with no credentials
// and an organization with no history looks like a prototype, and every screen
// in a tutorial ends up showing zeroes. This fills in the world *around* the
// walkthrough without doing the walkthrough itself.
//
// What it deliberately does NOT create:
//
//   * the account and organization you create on camera — those are the first
//     three steps of the tutorial, so seeding them would leave nothing to show
//   * the third root wallet — you confirm that one live, which is the shot that
//     makes "nominating is not confirming" land
//   * the credential you issue on camera
//
// What it does create:
//
//   * a mature second organization, so the platform looks lived-in and any
//     deployment-wide screen has real rows in it
//   * registered wallets for the people you will nominate live, so the Wallet
//     IDs you paste on camera resolve to something
//   * a registration code, so the paid-plan path can be shown without a card
//
// Local only, and it says which files it is about to write before it writes
// them. Hosted state lives on the /home mount of the App Service, which a
// laptop cannot reach, so pointing this at dev or prod would only ever write to
// the wrong place.
//
//   node scripts/seed-demo-environment.js
//   node scripts/seed-demo-environment.js --reset
//   node scripts/seed-demo-environment.js --org "Northwind Logistics"

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

if (flag('help')) {
  console.log(`
Seed a demo environment for recording.

  --dir <path>       where the demo stores live (default: data/demo)
  --run              start the app against the demo stores instead of seeding
  --reset            delete the seeded stores first
  --org <name>       name of the mature organization (default: Northwind Logistics)
  --holders <n>      credential holders to issue to (default: 6)
  --root-wallets <n> confirmed root wallets on the mature org (default: 3)
  --help             this
`);
  process.exit(0);
}

const rootDir = path.resolve(__dirname, '..');
const demoDir = path.resolve(rootDir, value('dir', 'data/demo'));

// Every store goes in its own directory, so seeding can never overwrite the
// data you have been developing against. The names are read out of the config
// module rather than listed here, so a store added later is picked up instead
// of quietly staying in `data/` and surviving a --reset.
//
// Set before requiring config, because config resolves its paths once at
// require time and dotenv does not override a variable that is already set.
for (const [name, fallback] of declaredStorePaths()) {
  process.env[name] = path.join(demoDir, path.basename(fallback));
}
process.env.MAIL_DROP_PATH = process.env.MAIL_DROP_PATH || path.join(demoDir, 'mail');
fs.mkdirSync(demoDir, { recursive: true });

function declaredStorePaths() {
  const source = fs.readFileSync(path.join(rootDir, 'src/config/index.js'), 'utf8');
  const pattern = /process\.env\.(\w+_STORE_PATH),\s*'([^']+)'/g;
  const found = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    found.push([match[1], match[2]]);
  }
  return found;
}

// The config module reads .env.local at require time, so the guard has to come
// after it is loaded but before anything writes.
const config = require('../src/config');

if (config.app.deployEnv !== 'local') {
  console.error(
    `Refusing to run against "${config.app.deployEnv}".\n` +
      'This writes JSON stores on the local filesystem. A hosted environment keeps\n' +
      'its state on the App Service /home mount, which is not reachable from here,\n' +
      'so this would only write files nothing will ever read.'
  );
  process.exit(1);
}

const { registerUser } = require('../src/services/auth-service');
const { createSubscription } = require('../src/services/subscription-service');
const { registerWorkspaceForSubscription } = require('../src/services/platform-service');
const { registerWallet } = require('../src/services/wallet-registry-service');
const {
  confirmRootWallet,
  nominateRootWallet,
  summarizeRootWallets
} = require('../src/services/root-wallet-service');
const {
  createClaimDefinition,
  createOrgUnit,
  issueCredential,
  markCredentialAccepted,
  revokeCredential,
  getOrgAdminView
} = require('../src/services/org-admin-service');
const { createRegistrationCode } = require('../src/services/registration-code-service');
const {
  acceptOrganizationInvitation,
  createIssuerOrganizationInvitation
} = require('../src/services/issuer-organization-service');

const MATURE_ORG = value('org', 'Northwind Logistics');
const HOLDER_COUNT = Number.parseInt(value('holders', '6'), 10);
const ROOT_WALLET_COUNT = Number.parseInt(value('root-wallets', '3'), 10);

// The people you will nominate on camera. Their wallets are registered here so
// the Wallet ID you paste resolves — nominating an unregistered ID is refused,
// which is correct behaviour and a bad thing to discover mid-take.
const NOMINEES = [
  { name: 'Dana Reyes', email: 'dana.reyes@vanguardcs.ca', phone: '' },
  { name: 'Sam Okonkwo', email: 'sam.okonkwo@vanguardcs.ca', phone: '' },
  { name: 'Priya Nair', email: 'priya.nair@vanguardcs.ca', phone: '' }
];

const HOLDERS = [
  { name: 'Alex Chen', email: 'alex.chen@northwind.example', title: 'Logistics Coordinator', unit: 'Operations' },
  { name: 'Maria Santos', email: 'maria.santos@northwind.example', title: 'Fleet Supervisor', unit: 'Operations' },
  { name: 'Tom Whitfield', email: 'tom.whitfield@northwind.example', title: 'Warehouse Lead', unit: 'Operations' },
  { name: 'Nadia Haddad', email: 'nadia.haddad@northwind.example', title: 'Finance Analyst', unit: 'Finance' },
  { name: 'Ben Osei', email: 'ben.osei@northwind.example', title: 'Contract Driver', unit: 'Field' },
  { name: 'Ivy Lindqvist', email: 'ivy.lindqvist@northwind.example', title: 'Compliance Officer', unit: 'Finance' },
  { name: 'Rafael Duarte', email: 'rafael.duarte@northwind.example', title: 'Depot Manager', unit: 'Operations' },
  { name: 'Grace Kim', email: 'grace.kim@northwind.example', title: 'Safety Inspector', unit: 'Field' }
];

async function main() {
  // Starting the app is part of this script rather than a documented list of
  // exports, because the store paths have to match exactly and a single one
  // left pointing at `data/` sends the app to your development data instead.
  if (flag('run')) {
    console.log(`Starting Aegis ID against ${path.relative(rootDir, demoDir)}/`);
    console.log(`  ${config.app.publicBaseUrl}\n`);
    require('../src/server');
    return;
  }

  console.log(`Seeding a demo environment in ${path.relative(rootDir, demoDir)}/\n`);

  const existing = fs.readdirSync(demoDir).filter((name) => name.endsWith('.json'));
  if (existing.length && !flag('reset')) {
    console.error(
      `${path.relative(rootDir, demoDir)}/ already holds ${existing.length} store(s).\n` +
        'Seeding on top of them would stack a second organization onto the first.\n' +
        'Re-run with --reset to start clean, or --dir to seed somewhere else.'
    );
    process.exit(1);
  }

  if (flag('reset')) {
    for (const name of existing) {
      fs.rmSync(path.join(demoDir, name), { force: true });
    }
    console.log(`Reset: ${existing.length} store(s) deleted.\n`);
  }

  const admin = await seedMatureOrganization();
  const nominees = await seedNominees();
  const code = await seedRegistrationCode(admin);

  printRecordingCard({ admin, nominees, code });
}

/**
 * A second organization with a history. Nothing in the tutorial touches it —
 * it exists so the deployment does not look like it was installed this morning.
 */
async function seedMatureOrganization() {
  const password = 'Northwind!Demo2026';
  const owner = await registerUser({
    displayName: 'Helen Marsh',
    email: 'helen.marsh@northwind.example',
    phone: '',
    password,
    confirmPassword: password,
    preferredMfa: 'email'
  });

  const subscription = await createSubscription(
    {
      email: owner.email,
      organization: MATURE_ORG,
      plan: 'pro',
      role: 'administrator',
      interest: 'both',
      consent: 'on',
      notes: 'Seeded for the setup walkthrough recording.'
    },
    owner,
    // Comped rather than left unpaid. A paid plan with nothing settling it
    // entitles Trial limits by design, which would cap this organization at a
    // handful of credentials and make the seeded dashboard look thinner than
    // the plan it claims to be on.
    { via: 'code' }
  );

  const workspace = await registerWorkspaceForSubscription(subscription, { organization: MATURE_ORG });
  console.log(`Organization: ${MATURE_ORG}`);

  for (const name of ['Operations', 'Finance', 'Field']) {
    await createOrgUnit(workspace, subscription, { name });
  }

  await createClaimDefinition(workspace, subscription, {
    key: 'jobTitle',
    label: 'Job title',
    type: 'text',
    required: 'on'
  });
  await createClaimDefinition(workspace, subscription, {
    key: 'depot',
    label: 'Home depot',
    type: 'text'
  });

  // Root wallets first: issuance is blocked without them wherever the policy is
  // enforced, so seeding credentials before this would fail on a realistic
  // configuration rather than a permissive one.
  const rootWallets = [];
  for (let index = 0; index < ROOT_WALLET_COUNT; index += 1) {
    const holder = `ops.lead${index + 1}@northwind.example`;
    const wallet = await registerWallet({
      email: holder,
      phone: '',
      devicePublicKey: `seed-northwind-root-${index}`
    });
    const { confirmationToken } = await nominateRootWallet(workspace.id, wallet.walletId, {
      actorEmail: owner.email,
      label: `Operations lead ${index + 1}`
    });
    await confirmRootWallet(wallet.walletId, confirmationToken);
    rootWallets.push(wallet.walletId);
  }
  const summary = await summarizeRootWallets(workspace.id);
  console.log(`  root wallets: ${summary.confirmedCount} confirmed`);

  // The administrator's own wallet joined to the organization. Without a
  // connected wallet the dashboard redirects to onboarding, so a "mature"
  // organization that skipped this would open on a setup screen — the one
  // screen a seeded org should never be showing.
  const invitation = await createIssuerOrganizationInvitation(subscription, workspace);
  await acceptOrganizationInvitation(invitation.id, { walletId: rootWallets[0] });

  const state = await getOrgAdminView(workspace, subscription);
  const employeeRole = state.roles.find((role) => role.name === 'Employee');
  const contractorRole = state.roles.find((role) => role.name === 'Contractor');

  // A mix of states, because a list where every row says the same thing reads
  // as fake: most accepted, a couple still pending, one revoked.
  let issued = 0;
  for (const person of HOLDERS.slice(0, Math.min(HOLDER_COUNT, HOLDERS.length))) {
    const wallet = await registerWallet({
      email: person.email,
      phone: '',
      devicePublicKey: `seed-northwind-holder-${issued}`
    });

    const credential = await issueCredential(workspace, subscription, {
      holderEmail: person.email,
      walletId: wallet.walletId,
      displayName: person.name,
      jobTitle: person.title,
      depot: person.unit,
      roleIds: [person.unit === 'Field' ? contractorRole?.id : employeeRole?.id].filter(Boolean)
    });

    if (issued < HOLDER_COUNT - 2) {
      await markCredentialAccepted(workspace, subscription, credential.id);
    }
    if (issued === HOLDER_COUNT - 1) {
      await revokeCredential(workspace, subscription, credential.id, 'Left the organization');
    }
    issued += 1;
  }
  console.log(`  credentials: ${issued} issued`);

  return { owner, password, subscription, workspace };
}

/**
 * Wallets for the people nominated on camera. Registering them here is the
 * difference between "paste this ID" working on the first take and being
 * refused with "no wallet is registered with that ID".
 */
async function seedNominees() {
  const created = [];
  for (const [index, person] of NOMINEES.entries()) {
    const wallet = await registerWallet({
      email: person.email,
      phone: person.phone,
      devicePublicKey: `seed-nominee-${index}`
    });
    created.push({ ...person, walletId: wallet.walletId });
  }
  console.log(`Nominee wallets: ${created.length} registered\n`);
  return created;
}

/**
 * A code that grants a paid plan without payment, so the tutorial can show a
 * paid tier without a card on screen.
 */
async function seedRegistrationCode({ owner }) {
  try {
    const result = await createRegistrationCode({
      planId: 'basic',
      environments: ['local'],
      maxRedemptions: 25,
      expiresInDays: 90,
      note: 'Setup walkthrough recording',
      actorEmail: owner.email
    });
    return result.code;
  } catch (error) {
    // Not fatal: the walkthrough works on the trial plan without one.
    console.log(`(registration code skipped: ${error.message})`);
    return null;
  }
}

function printRecordingCard({ admin, nominees, code }) {
  const base = config.app.publicBaseUrl.replace(/\/$/, '');
  const line = '─'.repeat(64);

  console.log(line);
  console.log('RECORDING CARD — keep this open in a second window');
  console.log(line);
  console.log('');
  console.log('Wallet IDs to paste when nominating root wallets on camera:');
  for (const nominee of nominees) {
    console.log(`  ${nominee.walletId}   ${nominee.name} <${nominee.email}>`);
  }
  console.log('');
  console.log('Mature organization, for any shot that needs a populated screen:');
  console.log(`  ${MATURE_ORG}`);
  console.log(`  sign in: ${admin.owner.email} / ${admin.password}`);
  console.log(`  dashboard: ${base}/dashboard/${admin.subscription.id}/orgs/${admin.workspace.id}`);
  console.log(`  root wallets: ${base}/organizations/${admin.subscription.id}/${admin.workspace.id}/root-wallets`);
  console.log('');
  if (code) {
    console.log(`Registration code (grants Basic without payment): ${code}`);
    console.log('  Shown once. Re-run with --reset to mint another.');
    console.log('');
  }
  console.log('Wallet deep links on this environment use:');
  console.log(`  ${config.app.walletUrlScheme}://…`);
  console.log('  The wallet build on the device has to register that scheme.');
  console.log('');
  console.log('Sign-in codes and links are written to:');
  console.log(`  ${path.relative(rootDir, config.paths.mailDrop)}/`);
  console.log('');
  console.log('Start the app against this data — plain `npm start` reads your');
  console.log('own development stores and will not see any of the above:');
  console.log('');
  console.log(`  node scripts/seed-demo-environment.js --run`);
  console.log('');
  console.log(line);
}

main().catch((error) => {
  console.error('\nSeeding failed:', error.message);
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exit(1);
});
