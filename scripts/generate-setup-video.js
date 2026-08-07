const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const frameDir = path.join(root, 'tmp', 'setup-video-frames');
const videoDir = path.join(root, 'public', 'videos');
const posterDir = path.join(root, 'public', 'images');
const width = 1280;
const height = 720;
const fps = 24;
const sceneSeconds = 5;

// The order the product actually runs in. Two things this had wrong before and
// which matter more than the animation: the plan is chosen *before* the account
// exists, and a wallet is registered and made a root wallet before anything can
// be issued to it. An onboarding video that skips those teaches a path that
// stops working at the first enforcing deployment.
const sceneScript = [
  {
    eyebrow: 'Step 1',
    title: 'Choose A Plan',
    node: 'Plan',
    copy: 'The plan comes first. Picking Enterprise is answered on the pricing page rather than after a registration form.',
    accent: '#1769e0',
    visual: 'plans',
    laptopLabel: 'Plans'
  },
  {
    eyebrow: 'Step 2',
    title: 'Create Account',
    node: 'Account',
    copy: 'Register with a work email, then finish a second factor. A registration code can stand in for payment.',
    accent: '#00b7c7',
    visual: 'account',
    laptopLabel: 'Register'
  },
  {
    eyebrow: 'Step 3',
    title: 'Create Organization',
    node: 'Org',
    copy: 'The workspace is created with a permanent handle, and an optional domain can be proven by a DNS record.',
    accent: '#19b97a',
    visual: 'organization',
    laptopLabel: 'Organization'
  },
  {
    eyebrow: 'Step 4',
    title: 'Set Up The Wallet',
    node: 'Wallet',
    copy: 'Install the wallet on iOS or Android. First run mints a Wallet ID and shows ten recovery codes, once.',
    accent: '#f7b955',
    visual: 'walletSetup',
    laptopLabel: 'Wallet ID'
  },
  {
    eyebrow: 'Step 5',
    title: 'Add A Root Wallet',
    node: 'Root',
    copy: 'Nominate the Wallet ID, then have the holder scan the code. A nomination alone grants nothing.',
    accent: '#7b6cf6',
    visual: 'rootWallet',
    laptopLabel: 'Root wallets'
  },
  {
    eyebrow: 'Step 6',
    title: 'Then Add Two More',
    node: 'Three',
    copy: 'One root wallet is one lost device from being stranded. Three held by different people is the bar to be safe.',
    accent: '#7b6cf6',
    visual: 'rootWalletsThree',
    laptopLabel: 'Three confirmed'
  },
  {
    eyebrow: 'Step 7',
    title: 'Issue A Credential',
    node: 'Issue',
    copy: 'Choose the claims and bind the invitation to a Wallet ID, so only that wallet can accept it.',
    accent: '#19b97a',
    visual: 'issuance',
    laptopLabel: 'Issue'
  },
  {
    eyebrow: 'Step 8',
    title: 'Accept And Approve',
    node: 'Approve',
    copy: 'The holder scans and accepts. Later a connected app raises a wallet challenge, and every decision becomes evidence.',
    accent: '#00b7c7',
    visual: 'acceptApprove',
    laptopLabel: 'Challenge'
  }
];

const scenes = sceneScript.map((scene, index) => ({
  ...scene,
  start: index * sceneSeconds,
  end: (index + 1) * sceneSeconds
}));

const durationSeconds = scenes.length * sceneSeconds;
const totalFrames = fps * durationSeconds;

function main() {
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(posterDir, { recursive: true });

  for (let index = 0; index < totalFrames; index += 1) {
    const t = index / fps;
    const scene = scenes.find((candidate) => t >= candidate.start && t < candidate.end) || scenes[scenes.length - 1];
    const localT = (t - scene.start) / (scene.end - scene.start);
    const svgPath = path.join(frameDir, `frame-${String(index).padStart(4, '0')}.svg`);
    const pngPath = path.join(frameDir, `frame-${String(index).padStart(4, '0')}.png`);
    fs.writeFileSync(svgPath, renderFrame(scene, localT, t), 'utf8');
    execFileSync('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', pngPath, svgPath], {
      stdio: 'ignore'
    });
  }

  const videoPath = path.join(videoDir, 'setup-walkthrough.mp4');
  const posterPath = path.join(posterDir, 'setup-walkthrough-poster.png');

  fs.rmSync(videoPath, { force: true });
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(frameDir, 'frame-%04d.png'),
      '-vf',
      'format=yuv420p',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      videoPath
    ],
    { stdio: 'inherit' }
  );

  // Not frame zero: each scene fades its visual in, so the first frame is the
  // one frame where the thing the poster is meant to show is still washed out.
  // Take one from the middle of the opening scene instead.
  const posterFrame = Math.min(Math.round(fps * sceneSeconds * 0.6), totalFrames - 1);
  fs.copyFileSync(path.join(frameDir, `frame-${String(posterFrame).padStart(4, '0')}.png`), posterPath);
  console.log(`Created ${path.relative(root, videoPath)}`);
  console.log(`Created ${path.relative(root, posterPath)}`);
}

function renderFrame(scene, localT, t) {
  const pulse = 0.5 + Math.sin(t * 4) * 0.5;
  const slide = easeOutCubic(Math.min(localT * 1.5, 1));
  const progress = Math.min(t / durationSeconds, 1);
  const nodeOffset = Math.sin(t * 1.2) * 8;
  const cloudLift = Math.sin(t * 0.8) * 6;
  const cardX = 76 + slide * 26;
  const characterWave = Math.sin(t * 5) * 8;
  const visualReveal = easeOutCubic(localT);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#061625"/>
      <stop offset="48%" stop-color="#0d2a42"/>
      <stop offset="100%" stop-color="#08283a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" x2="1">
      <stop offset="0%" stop-color="${scene.accent}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#00111f" flood-opacity="0.35"/>
    </filter>
    <style>
      .label { font: 800 20px Inter, Segoe UI, Arial, sans-serif; letter-spacing: 0; fill: #00b7c7; text-transform: uppercase; }
      .title { font: 900 64px Inter, Segoe UI, Arial, sans-serif; letter-spacing: 0; fill: #ffffff; }
      .copy { font: 600 25px Inter, Segoe UI, Arial, sans-serif; letter-spacing: 0; fill: #cde0f5; }
      .small { font: 800 22px Inter, Segoe UI, Arial, sans-serif; fill: #173049; }
      .tiny { font: 700 17px Inter, Segoe UI, Arial, sans-serif; fill: #5f6c7b; }
      .whiteTiny { font: 800 17px Inter, Segoe UI, Arial, sans-serif; fill: #ffffff; }
    </style>
  </defs>

  <rect width="1280" height="720" fill="url(#bg)"/>
  <g opacity="0.35">
    <path d="M-50 544 C170 420 280 650 512 500 S886 410 1310 505" fill="none" stroke="#1769e0" stroke-width="4"/>
    <path d="M-30 598 C240 494 350 682 592 556 S956 470 1328 610" fill="none" stroke="#00b7c7" stroke-width="3" stroke-dasharray="8 14"/>
    <path d="M48 636 C302 590 492 648 692 568 S1020 500 1248 574" fill="none" stroke="#19b97a" stroke-width="3" stroke-dasharray="6 12"/>
  </g>

  <g transform="translate(${cardX},156)">
    <text class="label" x="0" y="0">${escapeXml(scene.eyebrow)}</text>
    <text class="title" x="0" y="76">${escapeXml(scene.title)}</text>
    ${wrapText(scene.copy, 0, 126, 590, 31, 'copy')}
    <rect x="0" y="206" width="310" height="12" rx="6" fill="#153551"/>
    <rect x="0" y="206" width="${310 * progress}" height="12" rx="6" fill="url(#accent)"/>
  </g>

  ${renderCharacter(135, 444, characterWave)}
  ${renderLaptop(250, 462, scene, pulse)}
  ${renderCloud(770, 112 + cloudLift, scene.accent)}
  ${renderSceneVisual(650, 284, scene, visualReveal, pulse)}
  ${renderJourneyNodes(520, 634 + nodeOffset, scene, scene.accent)}

  <g transform="translate(64,40)">
    <rect x="0" y="0" width="54" height="54" rx="12" fill="url(#accent)" opacity="0.95"/>
    <text x="18" y="36" class="whiteTiny">V</text>
    <text x="72" y="23" class="whiteTiny">Vanguard</text>
    <text x="72" y="48" class="tiny" fill="#d4e6f8">Aegis ID onboarding</text>
  </g>
</svg>`;
}

function renderCharacter(x, y, armWave) {
  return `<g transform="translate(${x},${y})" filter="url(#shadow)">
    <ellipse cx="48" cy="146" rx="78" ry="20" fill="#04101c" opacity="0.25"/>
    <circle cx="54" cy="28" r="26" fill="#ffd8b5"/>
    <path d="M28 26 C34 -8 82 -6 82 30 C70 22 56 22 38 28 Z" fill="#123a63"/>
    <rect x="24" y="58" width="68" height="86" rx="26" fill="#1769e0"/>
    <path d="M28 88 C5 106 4 130 30 137" fill="none" stroke="#ffd8b5" stroke-width="14" stroke-linecap="round"/>
    <path d="M88 86 C112 ${94 + armWave} 118 ${116 - armWave} 98 132" fill="none" stroke="#ffd8b5" stroke-width="14" stroke-linecap="round"/>
    <path d="M46 144 L24 186" stroke="#081c2d" stroke-width="16" stroke-linecap="round"/>
    <path d="M72 144 L100 186" stroke="#081c2d" stroke-width="16" stroke-linecap="round"/>
    <circle cx="44" cy="28" r="3" fill="#081c2d"/>
    <circle cx="66" cy="28" r="3" fill="#081c2d"/>
    <path d="M45 42 Q55 50 68 42" fill="none" stroke="#081c2d" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

function renderLaptop(x, y, scene, pulse) {
  const label = scene.laptopLabel || 'Aegis ID';
  return `<g transform="translate(${x},${y})" filter="url(#shadow)">
    <path d="M0 112 H250 L214 150 H-36 Z" fill="#d9e7f4"/>
    <rect x="22" y="0" width="208" height="126" rx="14" fill="#f8fbff"/>
    <rect x="40" y="20" width="172" height="86" rx="10" fill="#102a43"/>
    <rect x="60" y="42" width="${76 + pulse * 20}" height="14" rx="7" fill="${scene.accent}"/>
    <rect x="60" y="66" width="112" height="9" rx="5" fill="#7aa5cc"/>
    <rect x="60" y="86" width="82" height="9" rx="5" fill="#7aa5cc"/>
    <rect x="112" y="132" width="46" height="8" rx="4" fill="#abc3d8"/>
    <text class="whiteTiny" x="62" y="36">${escapeXml(label)}</text>
  </g>`;
}

function renderSceneVisual(x, y, scene, reveal, pulse) {
  const offset = Math.round((1 - reveal) * 26);
  const opacity = 0.14 + reveal * 0.86;
  const visual = {
    plans: renderPlansVisual,
    account: renderAccountVisual,
    organization: renderOrganizationVisual,
    walletSetup: renderWalletSetupVisual,
    rootWallet: renderRootWalletVisual,
    rootWalletsThree: renderRootWalletsThreeVisual,
    issuance: renderIssuanceVisual,
    acceptApprove: renderAcceptApproveVisual
  }[scene.visual] || renderOrganizationVisual;

  return `<g transform="translate(${x + offset},${y})" opacity="${opacity}" filter="url(#shadow)">
    ${visual(scene.accent, pulse)}
  </g>`;
}

function renderPlansVisual(accent, pulse) {
  const plans = [
    ['Trial', '$0', '#7aa5cc'],
    ['Basic', '$49', accent],
    ['Scale', '$199', '#7aa5cc']
  ];
  return `<rect x="0" y="0" width="440" height="282" rx="22" fill="#ffffff"/>
    <text class="small" x="30" y="48">Choose a plan first</text>
    ${plans.map(([name, price, colour], index) => {
      const x = 26 + index * 132;
      const chosen = index === 1;
      return `<g transform="translate(${x},72)">
        <rect x="0" y="0" width="118" height="130" rx="16" fill="${chosen ? '#edf6ff' : '#f5f9fd'}" stroke="${chosen ? accent : '#dbe6f2'}" stroke-width="${chosen ? 4 : 2}"/>
        <text class="small" x="18" y="40">${name}</text>
        <text class="tiny" x="18" y="70">${price} / month</text>
        ${chosen ? `<rect x="18" y="88" width="82" height="26" rx="8" fill="${colour}"/><text class="whiteTiny" x="34" y="106">Chosen</text>` : ''}
      </g>`;
    }).join('')}
    <rect x="26" y="224" width="${196 + pulse * 18}" height="34" rx="10" fill="${accent}"/>
    <text class="whiteTiny" x="44" y="247">Continue to checkout</text>`;
}

function renderAccountVisual(accent, pulse) {
  return `<rect x="0" y="0" width="430" height="282" rx="22" fill="#ffffff"/>
    <rect x="0" y="0" width="430" height="54" rx="22" fill="#edf6ff"/>
    <circle cx="34" cy="27" r="8" fill="#c9d9e8"/>
    <circle cx="60" cy="27" r="8" fill="#c9d9e8"/>
    <circle cx="86" cy="27" r="8" fill="#c9d9e8"/>
    <text class="small" x="34" y="96">Create your account</text>
    <rect x="34" y="118" width="164" height="28" rx="8" fill="#edf6ff"/>
    <rect x="218" y="118" width="164" height="28" rx="8" fill="#edf6ff"/>
    <rect x="34" y="158" width="348" height="28" rx="8" fill="#edf6ff"/>
    <rect x="34" y="196" width="216" height="26" rx="8" fill="#f5f9fd" stroke="#dbe6f2" stroke-width="2"/>
    <text class="tiny" x="46" y="214">Registration code (optional)</text>
    <rect x="34" y="234" width="${136 + pulse * 18}" height="34" rx="10" fill="${accent}"/>
    <text class="whiteTiny" x="58" y="257">Create account</text>`;
}

function renderOrganizationVisual(accent) {
  return `<rect x="0" y="0" width="440" height="282" rx="22" fill="#ffffff"/>
    <text class="small" x="30" y="46">Your organization</text>
    <rect x="28" y="66" width="384" height="70" rx="16" fill="#edf6ff"/>
    <text class="small" x="50" y="102">VCS-613</text>
    <rect x="176" y="82" width="152" height="28" rx="14" fill="${accent}"/>
    <text class="whiteTiny" x="192" y="101">vcs-613-a7f3</text>
    <text class="tiny" x="50" y="126">Handle is permanent and globally unique</text>
    <rect x="28" y="152" width="384" height="60" rx="16" fill="#e8fff4"/>
    <circle cx="58" cy="182" r="14" fill="#19b97a"/>
    <path d="M51 182 L56 188 L66 176" stroke="#ffffff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text class="small" x="84" y="178">vanguardcs.ca</text>
    <text class="tiny" x="84" y="200">Proven by a DNS TXT record</text>
    <rect x="28" y="228" width="384" height="34" rx="10" fill="#f5f9fd"/>
    <text class="tiny" x="50" y="250">Public page: /orgs/vcs-613-a7f3</text>`;
}

function renderWalletSetupVisual(accent, pulse) {
  return `<rect x="0" y="0" width="238" height="286" rx="34" fill="#091522"/>
    <rect x="16" y="26" width="206" height="228" rx="22" fill="#ffffff"/>
    <text class="small" x="38" y="64">Your Wallet ID</text>
    <rect x="34" y="80" width="180" height="30" rx="8" fill="#edf6ff"/>
    <text class="tiny" x="42" y="100">AEG-4K7P-2M9X-QT3B</text>
    <text class="tiny" x="38" y="140">Recovery codes</text>
    ${[0, 1, 2, 3].map((i) => `<rect x="${36 + (i % 2) * 86}" y="${152 + Math.floor(i / 2) * 26}" width="76" height="18" rx="5" fill="#f0f5fa"/>`).join('')}
    <rect x="36" y="212" width="${118 + pulse * 14}" height="28" rx="9" fill="${accent}"/>
    <text class="whiteTiny" x="52" y="232">Saved them</text>
    <g transform="translate(276,44)">
      <rect x="0" y="0" width="186" height="70" rx="18" fill="#050b13"/>
      <text class="whiteTiny" x="22" y="30">TestFlight</text>
      <text class="tiny" x="22" y="54" fill="#9fb4c7">iOS wallet</text>
      <rect x="0" y="92" width="186" height="70" rx="18" fill="#0d3b2e"/>
      <text class="whiteTiny" x="22" y="122">Google Play</text>
      <text class="tiny" x="22" y="146" fill="#9fd8bf">Android wallet</text>
      <text class="tiny" x="0" y="198" fill="#cde0f5">The key stays on the device</text>
    </g>`;
}

function renderRootWalletVisual(accent, pulse) {
  return `<rect x="0" y="0" width="252" height="286" rx="22" fill="#ffffff"/>
    <text class="small" x="26" y="46">Nominate a wallet</text>
    <rect x="26" y="66" width="200" height="30" rx="8" fill="#edf6ff"/>
    <text class="tiny" x="36" y="86">AEG-4K7P-2M9X-QT3B</text>
    ${renderMiniQr(26, 112, 108, accent)}
    <rect x="26" y="236" width="200" height="30" rx="9" fill="#fff4e2"/>
    <text class="tiny" x="40" y="256">Pending until scanned</text>
    <g transform="translate(276,18)">
      <rect x="0" y="0" width="164" height="250" rx="30" fill="#091522"/>
      <rect x="14" y="22" width="136" height="192" rx="18" fill="#ffffff"/>
      <text class="small" x="34" y="60">Confirm?</text>
      <text class="tiny" x="34" y="86">VCS-613 nominated</text>
      <text class="tiny" x="34" y="106">this wallet</text>
      <rect x="34" y="126" width="${94 + pulse * 12}" height="30" rx="9" fill="#19b97a"/>
      <text class="whiteTiny" x="48" y="147">Confirm</text>
      <rect x="34" y="168" width="94" height="26" rx="8" fill="#f0f5fa"/>
      <text class="tiny" x="52" y="186">Not now</text>
    </g>`;
}

function renderRootWalletsThreeVisual(accent, pulse) {
  const holders = ['Fred P.', 'Dana R.', 'Sam O.'];
  return `<rect x="0" y="0" width="440" height="286" rx="22" fill="#ffffff"/>
    <text class="small" x="30" y="46">Root wallets</text>
    <rect x="30" y="64" width="380" height="14" rx="7" fill="#e5eef8"/>
    <rect x="30" y="64" width="${380 * (0.72 + pulse * 0.28)}" height="14" rx="7" fill="#19b97a"/>
    <text class="tiny" x="30" y="100">3 of 3 confirmed</text>
    ${holders.map((name, index) => `<g transform="translate(30,${118 + index * 46})">
      <rect x="0" y="0" width="380" height="38" rx="12" fill="#f5f9fd"/>
      <circle cx="26" cy="19" r="11" fill="#19b97a"/>
      <path d="M20 19 L24 24 L33 14" stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <text class="tiny" x="52" y="24">${escapeXml(name)}</text>
      <text class="tiny" x="176" y="24">Confirmed</text>
    </g>`).join('')}
    <text class="tiny" x="30" y="276" fill="${accent}">Two of them can recover an administrator</text>`;
}

function renderIssuanceVisual(accent, pulse) {
  return `<rect x="0" y="0" width="440" height="286" rx="22" fill="#ffffff"/>
    <rect x="28" y="30" width="168" height="218" rx="18" fill="#061625"/>
    <text class="whiteTiny" x="52" y="72">Verified</text>
    <text class="whiteTiny" x="52" y="100">Employee</text>
    <rect x="52" y="134" width="96" height="12" rx="6" fill="${accent}"/>
    <rect x="52" y="162" width="118" height="10" rx="5" fill="#7aa5cc"/>
    <text class="tiny" x="52" y="206" fill="#9fb4c7">Bound to</text>
    <text class="tiny" x="52" y="226" fill="#ffffff">AEG-4K7P</text>
    <rect x="226" y="30" width="176" height="128" rx="16" fill="#f5f9fd"/>
    ${renderMiniQr(248, 48, 88, accent)}
    <rect x="226" y="178" width="176" height="28" rx="8" fill="#edf6ff"/>
    <text class="tiny" x="240" y="197">Only that wallet may accept</text>
    <rect x="226" y="218" width="${128 + pulse * 20}" height="30" rx="10" fill="${accent}"/>
    <text class="whiteTiny" x="248" y="239">Create issuance</text>`;
}

function renderAcceptApproveVisual(accent, pulse) {
  return `<rect x="0" y="0" width="228" height="286" rx="34" fill="#091522"/>
    <rect x="16" y="26" width="196" height="228" rx="22" fill="#ffffff"/>
    <text class="small" x="38" y="64">Approve?</text>
    <text class="tiny" x="38" y="90">Business Expenses</text>
    <text class="tiny" x="38" y="110">wants to sign you in</text>
    <rect x="38" y="128" width="${104 + pulse * 12}" height="32" rx="10" fill="#19b97a"/>
    <text class="whiteTiny" x="54" y="150">Approve</text>
    <rect x="38" y="172" width="104" height="30" rx="10" fill="#f0f5fa"/>
    <text class="tiny" x="62" y="192">Decline</text>
    <text class="tiny" x="38" y="228">Both answers count</text>
    <g transform="translate(266,26)">
      <rect x="0" y="0" width="238" height="234" rx="20" fill="#ffffff"/>
      <text class="small" x="24" y="44">Evidence ledger</text>
      ${[0, 1, 2].map((i) => `<g transform="translate(24,${64 + i * 52})">
        <circle cx="10" cy="14" r="9" fill="${i === 0 ? '#19b97a' : accent}"/>
        <rect x="30" y="6" width="${124 - i * 18}" height="10" rx="5" fill="#7aa5cc"/>
        <rect x="30" y="22" width="${88 - i * 12}" height="8" rx="4" fill="#c9d9e8"/>
        ${i < 2 ? '<path d="M10 26 V44" stroke="#dbe6f2" stroke-width="3"/>' : ''}
      </g>`).join('')}
      <text class="tiny" x="24" y="222">Hash-chained and append only</text>
    </g>`;
}

function renderMiniQr(x, y, size, accent) {
  const cells = [
    [0,0],[1,0],[2,0],[0,1],[2,1],[0,2],[1,2],[2,2],
    [5,0],[6,0],[7,0],[5,1],[7,1],[5,2],[6,2],[7,2],
    [0,5],[1,5],[2,5],[0,6],[2,6],[0,7],[1,7],[2,7],
    [4,4],[6,4],[3,5],[5,6],[7,6],[4,7],[6,7],[8,3],[8,8],[3,8]
  ];
  const unit = size / 10;
  return `<g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${size}" height="${size}" rx="8" fill="#ffffff" stroke="#dbe6f2" stroke-width="3"/>
    ${cells.map(([cx, cy]) => `<rect x="${8 + cx * unit}" y="${8 + cy * unit}" width="${unit * 0.72}" height="${unit * 0.72}" rx="1.5" fill="${cx > 7 || cy > 7 ? accent : '#061625'}"/>`).join('')}
  </g>`;
}

function renderCloud(x, y, accent) {
  return `<g transform="translate(${x},${y})" filter="url(#shadow)">
    <ellipse cx="116" cy="86" rx="126" ry="58" fill="#f7fbff"/>
    <circle cx="62" cy="68" r="54" fill="#f7fbff"/>
    <circle cx="128" cy="44" r="68" fill="#e7f2ff"/>
    <circle cx="196" cy="78" r="48" fill="#f7fbff"/>
    <rect x="70" y="84" width="128" height="82" rx="18" fill="#ffffff" stroke="#c9d9e8" stroke-width="4"/>
    <rect x="92" y="114" width="84" height="12" rx="6" fill="${accent}"/>
    <rect x="92" y="138" width="56" height="10" rx="5" fill="#b8ccdd"/>
    <path d="M133 84 V62" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="133" cy="54" r="13" fill="${accent}"/>
  </g>`;
}

function renderWizard(x, y, reveal, accent) {
  return `<g transform="translate(${x - reveal * 22},${y})" opacity="${0.18 + reveal * 0.82}" filter="url(#shadow)">
    <rect x="0" y="0" width="336" height="212" rx="18" fill="#ffffff"/>
    <rect x="0" y="0" width="336" height="48" rx="18" fill="#edf6ff"/>
    <circle cx="36" cy="24" r="8" fill="${accent}"/>
    <rect x="62" y="17" width="152" height="14" rx="7" fill="#7aa5cc"/>
    ${[0, 1, 2, 3].map((i) => `
      <circle cx="46" cy="${82 + i * 32}" r="13" fill="${i < 2 ? accent : '#dbe6f2'}"/>
      <rect x="76" y="${72 + i * 32}" width="${170 - i * 22}" height="12" rx="6" fill="${i < 2 ? '#173049' : '#9fb4c7'}"/>
    `).join('')}
    <rect x="218" y="158" width="84" height="28" rx="8" fill="${accent}"/>
    <text class="whiteTiny" x="238" y="178">Next</text>
  </g>`;
}

function renderWallet(x, y, reveal, accent) {
  return `<g transform="translate(${x + (1 - reveal) * 34},${y})" opacity="${0.18 + reveal * 0.82}" filter="url(#shadow)">
    <rect x="0" y="0" width="184" height="238" rx="28" fill="#173049"/>
    <rect x="16" y="24" width="152" height="174" rx="16" fill="#ffffff"/>
    <rect x="50" y="54" width="84" height="84" rx="10" fill="#f4fbff"/>
    <path d="M62 66 H82 V86 H62 Z M92 66 H122 V76 H92 Z M132 66 H142 V96 H132 Z M62 96 H102 V106 H62 Z M112 96 H142 V136 H112 Z M62 116 H92 V136 H62 Z M96 116 H106 V136 H96 Z" fill="${accent}"/>
    <rect x="48" y="156" width="88" height="12" rx="6" fill="#9fb4c7"/>
    <circle cx="92" cy="216" r="9" fill="#dbe6f2"/>
  </g>`;
}

function renderDashboard(x, y, reveal, accent) {
  return `<g transform="translate(${x},${y + (1 - reveal) * 24})" opacity="${0.18 + reveal * 0.82}" filter="url(#shadow)">
    <rect x="0" y="0" width="454" height="238" rx="20" fill="#ffffff"/>
    <rect x="28" y="28" width="146" height="70" rx="12" fill="#edf6ff"/>
    <rect x="194" y="28" width="104" height="70" rx="12" fill="#e8fff4"/>
    <rect x="318" y="28" width="108" height="70" rx="12" fill="#fff7e8"/>
    <rect x="28" y="126" width="398" height="22" rx="11" fill="#e5eef8"/>
    <rect x="28" y="126" width="300" height="22" rx="11" fill="${accent}"/>
    <rect x="28" y="170" width="112" height="38" rx="10" fill="#1769e0"/>
    <rect x="154" y="170" width="112" height="38" rx="10" fill="#00b7c7"/>
    <rect x="280" y="170" width="112" height="38" rx="10" fill="#19b97a"/>
    <text class="small" x="48" y="72">Verified ID</text>
    <text class="tiny" x="218" y="72">Okta</text>
    <text class="tiny" x="340" y="72">SAML</text>
  </g>`;
}

function renderPlatformNodes(x, y, accent) {
  const nodes = [
    ['Azure', 0, 0, '#1769e0'],
    ['DID', 160, -28, '#00b7c7'],
    ['Claims', 322, 0, '#19b97a'],
    ['OIDC', 484, -28, '#f7b955']
  ];
  return `<g transform="translate(${x},${y})">
    ${nodes.map(([label, dx, dy, color], index) => `
      <g transform="translate(${dx},${dy})">
        ${index > 0 ? `<path d="M-90 38 H-18" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.75"/>` : ''}
        <rect x="0" y="0" width="104" height="76" rx="18" fill="#ffffff" opacity="0.95"/>
        <circle cx="52" cy="28" r="13" fill="${color}"/>
        <text class="tiny" x="24" y="60">${label}</text>
      </g>
    `).join('')}
  </g>`;
}

// The strip has to hold however many steps the script has without running off
// the frame, so the spacing is derived rather than fixed — eight steps at the
// old 94px pitch ran 82px past the right edge.
function renderJourneyNodes(x, y, scene, accent) {
  const available = width - x - 40;
  const step = Math.min(94, Math.floor(available / scenes.length));
  const nodeWidth = step - 8;

  return `<g transform="translate(${x},${y})">
    ${scenes.map((item, index) => {
      const active = item === scene;
      const label = String(index + 1).padStart(2, '0');
      const title = item.node || item.title.split(' ')[0];
      return `<g transform="translate(${index * step},0)">
        ${index > 0 ? `<path d="M${nodeWidth - step + 3} 29 H-3" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.5"/>` : ''}
        <rect x="0" y="0" width="${nodeWidth}" height="58" rx="16" fill="${active ? accent : '#ffffff'}" opacity="${active ? '1' : '0.82'}"/>
        <text x="10" y="25" class="${active ? 'whiteTiny' : 'tiny'}">${label}</text>
        <text x="10" y="46" class="${active ? 'whiteTiny' : 'tiny'}">${escapeXml(title)}</text>
      </g>`;
    }).join('')}
  </g>`;
}

function wrapText(text, x, y, maxWidth, lineHeight, className) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length * 14 > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.map((line, index) => `<text class="${className}" x="${x}" y="${y + index * lineHeight}">${escapeXml(line)}</text>`).join('');
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main();
