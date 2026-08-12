#!/usr/bin/env node

// Record the setup walkthrough by driving the real application.
//
// The animated explainer on the home page says what the steps are. This is the
// other thing a tutorial needs: the actual product, screen by screen, with the
// forms being filled in. Everything here is the real app against the seeded
// demo environment — no mockups, no re-created screens that can drift from what
// ships.
//
// It records the browser legs. The wallet legs are a phone, which a browser
// cannot drive, so those become titled gaps of a known length with their
// timestamps written into chapters.txt — drop the phone footage into the gap
// and the chapter markers still line up.
//
// Playwright is not a dependency of this project. Installing it would put a
// browser download on the deployment path for the sake of a tool nobody runs in
// production, so it is installed on demand:
//
//   npm install --no-save playwright
//   npx playwright install chromium
//   node scripts/seed-demo-environment.js --reset
//   node scripts/record-walkthrough.js
//
// Output lands in artifacts/walkthrough/:
//   walkthrough.mp4   1280x720, ready to cut
//   chapters.txt      YouTube chapter markers, including the phone gaps
//   shots.json        every step with its timestamp, for the editor

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

if (flag('help')) {
  console.log(`
Record the setup walkthrough against the seeded demo environment.

  --dir <path>    demo stores to record against (default: data/demo)
  --port <n>      port to serve on (default: 3400)
  --speed <n>     1 = normal, 2 = twice as fast (default: 1)
  --keep-webm     keep Playwright's raw webm as well as the mp4
  --help          this
`);
  process.exit(0);
}

const rootDir = path.resolve(__dirname, '..');
const demoDir = path.resolve(rootDir, value('dir', 'data/demo'));
const outDir = path.join(rootDir, 'artifacts', 'walkthrough');
const port = Number.parseInt(value('port', '3400'), 10);
const speed = Number.parseFloat(value('speed', '1')) || 1;
const baseUrl = `http://localhost:${port}`;

const WIDTH = 1280;
const HEIGHT = 720;

// Point every store at the demo directory before config resolves them, the
// same way the seeder does. A single one left on `data/` would record against
// development data instead, which is the failure that looks like it worked.
for (const [name, fallback] of declaredStorePaths()) {
  process.env[name] = path.join(demoDir, path.basename(fallback));
}
process.env.MAIL_DROP_PATH = path.join(demoDir, 'mail');
process.env.PORT = String(port);
process.env.PUBLIC_BASE_URL = baseUrl;

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

function requirePlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    console.error(
      'Playwright is not installed. It is deliberately not a dependency of this\n' +
        'project — installing it would put a browser download on the deployment\n' +
        'path for a tool only used to make videos. Install it just for this:\n\n' +
        '  npm install --no-save playwright\n' +
        '  npx playwright install chromium\n'
    );
    process.exit(1);
  }
}

// --- the script ------------------------------------------------------------
//
// Each entry is a chapter. `run` drives the browser; `gap` marks a stretch that
// has to be filmed on a phone and only holds a card on screen for that long.

const ACCOUNT = {
  name: 'Frederick Pearson',
  email: 'fpearson@vanguardcs.ca',
  password: 'Aegis!Walkthrough2026',
  organization: 'Vanguard Cloud Services',
  domain: 'vanguardcs.ca'
};

const chapters = [];
const shots = [];
let startedAt = 0;

async function main() {
  const { chromium } = requirePlaywright();

  if (!fs.existsSync(path.join(demoDir, 'users.json'))) {
    console.error(
      `No seeded environment in ${path.relative(rootDir, demoDir)}/.\n` +
        'Run: node scripts/seed-demo-environment.js --reset'
    );
    process.exit(1);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const { createApp } = require('../src/app');
  const server = createApp().listen(port);
  await new Promise((resolve) => server.once('listening', resolve));
  console.log(`Serving ${path.relative(rootDir, demoDir)}/ on ${baseUrl}\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    recordVideo: { dir: outDir, size: { width: WIDTH, height: HEIGHT } }
  });
  const page = await context.newPage();
  await installCursor(page);

  startedAt = Date.now();

  try {
    await chapterIntro(page);
    await chapterPlan(page);
    await chapterAccount(page);
    await chapterOrganization(page);
    await gap(page, 'Set up the wallet', 'Film the phone: install, register, save recovery codes.', 90);
    const ids = await chapterRootWallet(page);
    await chapterThreeRootWallets(page, ids);
    await chapterCredential(page);
    await chapterEvidence(page);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    server.close();

    if (video) {
      const webm = await video.path();
      await finish(webm);
    }
  }
}

// --- chapters --------------------------------------------------------------

async function chapterIntro(page) {
  await chapter(page, 'What Aegis ID is');
  await page.goto(baseUrl);
  await settle(page, 1500);
  await page.evaluate(() => document.getElementById('architecture')?.scrollIntoView({ behavior: 'smooth' }));
  await settle(page, 4000);
}

async function chapterPlan(page) {
  await chapter(page, 'Choose a plan');
  await page.goto(`${baseUrl}/plans`);
  await settle(page, 2500);

  const basic = page.locator('form[action="/plans"] button[value="basic"], button[name="planId"][value="basic"]').first();
  if (await basic.count()) {
    await moveTo(page, basic);
    await settle(page, 600);
    await basic.click();
  }
  await settle(page, 2500);
}

async function chapterAccount(page) {
  await chapter(page, 'Create the account');
  await page.goto(`${baseUrl}/auth/register`);
  await settle(page, 1200);
  await focusOn(page, 'form [name="displayName"]', 1600);

  await typeInto(page, '#displayName, [name="displayName"]', ACCOUNT.name);
  await typeInto(page, '#email, [name="email"]', ACCOUNT.email);
  await typeInto(page, '#password, [name="password"]', ACCOUNT.password);
  await typeInto(page, '#confirmPassword, [name="confirmPassword"]', ACCOUNT.password);

  const org = page.locator('[name="organization"]').first();
  if (await org.count()) {
    await typeInto(page, '[name="organization"]', ACCOUNT.organization);
  }

  await settle(page, 800);
  await submit(page, 'button[type="submit"]');
  await settle(page, 2000);

  // The code is never in the response — it is delivered. On this environment
  // that means a file, which is exactly what the narration says happens.
  const code = await waitForDeliveredCode();
  if (code && (await page.locator('[name="code"]').count())) {
    await typeInto(page, '[name="code"]', code, 160);
    await settle(page, 600);
    await submit(page, 'button[type="submit"]');
  }
  await settle(page, 2500);
}

async function chapterOrganization(page) {
  await chapter(page, 'Create the organization');
  await page.goto(`${baseUrl}/subscribe`);
  await settle(page, 1500);
  await focusOn(page, 'form[action="/subscribe"]', 1600);

  if (await page.locator('[name="organization"]').count()) {
    await typeInto(page, '[name="organization"]', ACCOUNT.organization);
    await choose(page, '[name="role"]', 1);
    const consent = page.locator('[name="consent"]').first();
    if (await consent.count()) {
      await moveTo(page, consent);
      await consent.check().catch(() => {});
    }
    await settle(page, 700);
    await submit(page, 'form[action="/subscribe"] button[type="submit"]');
    await settle(page, 2500);
  }

  const { subscriptionId, workspaceId } = parseIds(page.url());
  if (subscriptionId && workspaceId) {
    await page.goto(`${baseUrl}/organizations/${subscriptionId}/${workspaceId}/domain`);
    await settle(page, 1500);
    await focusOn(page, '[name="domain"]', 1500);
    if (await page.locator('[name="domain"]').count()) {
      await typeInto(page, '[name="domain"]', ACCOUNT.domain);
      await settle(page, 600);
      await submit(page, 'form[action*="/domain"] button[type="submit"]');
      await settle(page, 3000);
    }
  }
}

async function chapterRootWallet(page) {
  await chapter(page, 'Confirm the first root wallet');

  const ids = await currentWorkspace(page);
  await page.goto(`${baseUrl}/organizations/${ids.subscriptionId}/${ids.workspaceId}/root-wallets`);
  await settle(page, 2500);
  await focusOn(page, 'form[action*="root-wallets"] [name="walletId"]', 1600);

  const nominees = seededNominees();
  await typeInto(page, '[name="walletId"]', nominees[0].walletId, 60);
  const label = page.locator('[name="label"]').first();
  if (await label.count()) {
    await typeInto(page, '[name="label"]', nominees[0].name);
  }
  await settle(page, 700);
  await submit(page, 'form[action*="root-wallets"] button[type="submit"]');
  await settle(page, 3000);

  // The QR is on screen and the row says Pending. That is the whole point of
  // the step, so hold on it before the phone leg.
  await gap(page, 'The holder scans the code', 'Film the phone confirming the nomination.', 35);

  await confirmRootWalletOutOfBand(nominees[0].walletId);
  await page.reload();
  await settle(page, 1200);
  // Hold on the row that just changed — pending to confirmed is the beat the
  // whole chapter exists for.
  await focusOn(page, '.data-table', 2600);
  return ids;
}

async function chapterThreeRootWallets(page, ids) {
  await chapter(page, 'Get to three root wallets');
  const nominees = seededNominees().slice(1, 3);

  for (const nominee of nominees) {
    await focusOn(page, 'form[action*="root-wallets"] [name="walletId"]', 900);
    await typeInto(page, '[name="walletId"]', nominee.walletId, 45);
    const label = page.locator('[name="label"]').first();
    if (await label.count()) {
      await typeInto(page, '[name="label"]', nominee.name);
    }
    await settle(page, 500);
    await submit(page, 'form[action*="root-wallets"] button[type="submit"]');
    await settle(page, 2000);
    await confirmRootWalletOutOfBand(nominee.walletId);
    await page.reload();
    await settle(page, 2000);
  }

  // End on the meter reading three of three.
  await focusOn(page, '.meter', 4000);
  return ids;
}

async function chapterCredential(page) {
  await chapter(page, 'Issue a credential');
  const ids = await currentWorkspace(page);
  await page.goto(`${baseUrl}/dashboard/${ids.subscriptionId}/orgs/${ids.workspaceId}/admin/credentials`);
  await settle(page, 3000);
  await page.evaluate(() => window.scrollBy({ top: 320, behavior: 'smooth' }));
  await settle(page, 3000);
  await gap(page, 'The holder accepts', 'Film the phone scanning the credential invite.', 35);
}

async function chapterEvidence(page) {
  await chapter(page, 'The evidence chain');
  const ids = await currentWorkspace(page);
  await page.goto(`${baseUrl}/dashboard/${ids.subscriptionId}/orgs/${ids.workspaceId}`);
  await settle(page, 3500);
  await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
  await settle(page, 3500);
}

// --- helpers ---------------------------------------------------------------

function elapsed() {
  return (Date.now() - startedAt) / 1000;
}

function timestamp(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

async function chapter(page, title) {
  const at = elapsed();
  chapters.push({ at, title });
  shots.push({ at, kind: 'chapter', title });
  console.log(`${timestamp(at)}  ${title}`);
  await card(page, title, '', 2200);
}

/**
 * A stretch the browser cannot record, held on screen for as long as the phone
 * footage is expected to run so the timeline does not have to be re-cut.
 */
async function gap(page, title, instruction, seconds) {
  const at = elapsed();
  chapters.push({ at, title });
  shots.push({ at, kind: 'gap', title, instruction, seconds });
  console.log(`${timestamp(at)}  [GAP ${seconds}s] ${title} — ${instruction}`);
  await card(page, title, `Drop the phone footage here — about ${seconds} seconds.`, (seconds * 1000) / speed);
}

async function card(page, title, subtitle, ms) {
  await page.evaluate(
    ({ title, subtitle }) => {
      const existing = document.getElementById('__aegis_card');
      existing?.remove();
      const node = document.createElement('div');
      node.id = '__aegis_card';
      node.style.cssText = [
        'position:fixed;inset:0;z-index:2147483646',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px',
        'background:linear-gradient(135deg,#061625,#0d2a42)',
        'font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#fff;text-align:center',
        'opacity:0;transition:opacity .35s ease'
      ].join(';');
      // Individual properties, not the `font:` shorthand — a shorthand whose
      // family is `inherit` is invalid and the whole declaration gets dropped,
      // which is how the title ended up at the browser default size.
      const heading = 'font-size:46px;font-weight:900;line-height:1.15;max-width:70%';
      const sub = 'font-size:20px;font-weight:600;line-height:1.5;color:#9fc4e6;max-width:60%';
      node.innerHTML =
        `<div style="${heading}">${title}</div>` +
        (subtitle ? `<div style="${sub}">${subtitle}</div>` : '');
      document.body.appendChild(node);
      requestAnimationFrame(() => {
        node.style.opacity = '1';
      });
    },
    { title, subtitle }
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    const node = document.getElementById('__aegis_card');
    if (!node) return;
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 400);
  });
  await page.waitForTimeout(450);
}

/**
 * A cursor the recording can actually see. Playwright moves a real mouse but
 * the pointer is not painted into the video, so without this every click looks
 * like the page changing on its own.
 */
async function installCursor(page) {
  await page.addInitScript(() => {
    const draw = () => {
      if (document.getElementById('__aegis_cursor')) return;
      const dot = document.createElement('div');
      dot.id = '__aegis_cursor';
      dot.style.cssText = [
        'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none',
        'width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%',
        'background:rgba(23,105,224,.35);border:2px solid #1769e0',
        'transition:transform .06s linear'
      ].join(';');
      document.documentElement.appendChild(dot);
      document.addEventListener('mousemove', (event) => {
        dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      });
      document.addEventListener('mousedown', (event) => {
        const ring = document.createElement('div');
        ring.style.cssText = [
          'position:fixed;z-index:2147483647;pointer-events:none',
          `top:${event.clientY}px;left:${event.clientX}px`,
          'width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%',
          'border:3px solid #00b7c7;opacity:.9',
          'transition:transform .45s ease-out, opacity .45s ease-out'
        ].join(';');
        document.documentElement.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.transform = 'scale(3.4)';
          ring.style.opacity = '0';
        });
        setTimeout(() => ring.remove(), 500);
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', draw);
    } else {
      draw();
    }
  });
}

/**
 * Bring the part of the page that is about to be used into the middle of the
 * frame, and hold there.
 *
 * Every page here opens on a tall hero, so landing on one and starting to type
 * puts the form off-screen for the first second of every chapter. Scrolling to
 * it deliberately, before anything happens, is the difference between a
 * recording that follows the work and one that jumps.
 */
async function focusOn(page, selector, ms = 1200) {
  const target = page.locator(selector).locator('visible=true').first();
  if (!(await target.count())) return;
  await target.evaluate((node) => node.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await page.waitForTimeout(ms / speed);
}

async function moveTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
}

async function typeInto(page, selector, text, delay = 90) {
  const field = page.locator(selector).locator('visible=true').first();
  if (!(await field.count())) return;
  await field.scrollIntoViewIfNeeded();
  await moveTo(page, field);
  await field.click();
  await page.waitForTimeout(220 / speed);
  await field.fill('');
  await field.type(text, { delay: delay / speed });
  await page.waitForTimeout(280 / speed);
}

/**
 * Pick from a `<select>`. Separate from typeInto because a select is not
 * fillable, and because the cursor has to visit it or the value appears to
 * change on its own.
 */
async function choose(page, selector, index) {
  const field = page.locator(selector).locator('visible=true').first();
  if (!(await field.count())) return;
  await field.scrollIntoViewIfNeeded();
  await moveTo(page, field);
  await page.waitForTimeout(260 / speed);
  await field.selectOption({ index }).catch(() => {});
  await page.waitForTimeout(260 / speed);
}

async function submit(page, selector) {
  // Visible only. Several pages carry a submit button inside a collapsed panel
  // or a modal, and the first match in the DOM is not always the one on screen
  // — scrolling to a hidden element just times out.
  const button = page.locator(selector).locator('visible=true').first();
  if (!(await button.count())) return;
  await button.scrollIntoViewIfNeeded();
  await moveTo(page, button);
  await page.waitForTimeout(300 / speed);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    button.click().catch(() => {})
  ]);
}

async function settle(page, ms) {
  await page.waitForTimeout(ms / speed);
}

function parseIds(url) {
  const match = /\/(?:organizations|dashboard)\/([0-9a-f-]{36})(?:\/orgs)?\/([0-9a-f-]{36})/.exec(url);
  return match ? { subscriptionId: match[1], workspaceId: match[2] } : {};
}

/** The workspace this recording created, read back from the store. */
async function currentWorkspace(page) {
  const fromUrl = parseIds(page.url());
  if (fromUrl.subscriptionId) return fromUrl;

  const subscriptions = readStore('subscriptions.json');
  const workspaces = readStore('subscriber-workspaces.json');
  const subscription = subscriptions.find((entry) => entry.email === ACCOUNT.email);
  const workspace = workspaces.find((entry) => entry.subscriptionId === subscription?.id);
  return { subscriptionId: subscription?.id, workspaceId: workspace?.id };
}

function readStore(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(demoDir, name), 'utf8'));
  } catch {
    return [];
  }
}

function seededNominees() {
  const wallets = readStore('wallets.json');
  const roots = readStore('root-wallets.json').map((entry) => entry.walletId);
  return wallets
    .filter((wallet) => /@vanguardcs\.ca$/.test(wallet.email || '') && !roots.includes(wallet.walletId))
    .map((wallet) => ({
      walletId: wallet.walletId,
      name: (wallet.email || '').split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    }));
}

/** Wait for the delivery service to write the sign-in code. */
async function waitForDeliveredCode() {
  const mailDir = path.join(demoDir, 'mail');
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const files = fs.existsSync(mailDir)
      ? fs
          .readdirSync(mailDir)
          .filter((name) => name.endsWith('.txt'))
          .map((name) => ({ name, at: fs.statSync(path.join(mailDir, name)).mtimeMs }))
          .sort((left, right) => right.at - left.at)
      : [];
    if (files.length) {
      const body = fs.readFileSync(path.join(mailDir, files[0].name), 'utf8');
      const match = /\b(\d{6})\b/.exec(body);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * Confirm a nomination the way the wallet would.
 *
 * The wallet leg is filmed separately, but the recording still has to end up in
 * the confirmed state or the next chapter would show a screen the tutorial says
 * you should not be seeing. This calls the same endpoint the wallet calls, with
 * the token the QR carried.
 */
async function confirmRootWalletOutOfBand(walletId) {
  const records = readStore('root-wallets.json');
  const record = records.find((entry) => entry.walletId === walletId && entry.status === 'pending');
  if (!record?.confirmationToken) return;

  const url =
    `${baseUrl}/api/root-wallets/confirm` +
    `?wallet_id=${encodeURIComponent(walletId)}&token=${encodeURIComponent(record.confirmationToken)}`;
  await fetch(url, { headers: { Accept: 'application/json' } }).catch(() => {});
}

// --- output ----------------------------------------------------------------

async function finish(webmPath) {
  const mp4 = path.join(outDir, 'walkthrough.mp4');
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', mp4],
      { stdio: 'ignore' }
    );
    if (!flag('keep-webm')) {
      fs.rmSync(webmPath, { force: true });
    }
  } catch {
    console.log('ffmpeg not found — keeping the raw webm instead of an mp4.');
  }

  const chapterFile = path.join(outDir, 'chapters.txt');
  fs.writeFileSync(
    chapterFile,
    ['00:00 Introduction', ...chapters.map((entry) => `${timestamp(entry.at)} ${entry.title}`)].join('\n') + '\n'
  );
  fs.writeFileSync(path.join(outDir, 'shots.json'), `${JSON.stringify(shots, null, 2)}\n`);

  console.log(`\nWrote ${path.relative(rootDir, outDir)}/`);
  console.log('  walkthrough.mp4   the browser legs, chaptered');
  console.log('  chapters.txt      paste into the YouTube description');
  console.log('  shots.json        gap timestamps for the editor');
  console.log('\nGaps to fill with phone footage:');
  for (const shot of shots.filter((entry) => entry.kind === 'gap')) {
    console.log(`  ${timestamp(shot.at)}  ${shot.title} (${shot.seconds}s) — ${shot.instruction}`);
  }
}

main().catch((error) => {
  console.error('\nRecording failed:', error.message);
  process.exit(1);
});
