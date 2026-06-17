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
const durationSeconds = 30;
const totalFrames = fps * durationSeconds;

const scenes = [
  {
    start: 0,
    end: 5,
    eyebrow: 'Step 1',
    title: 'Create Account',
    copy: 'A new subscriber opens the Vanguard Aegis ID website and creates a secure user account.',
    accent: '#00b7c7',
    visual: 'account',
    laptopLabel: 'Website'
  },
  {
    start: 5,
    end: 10,
    eyebrow: 'Step 2',
    title: 'Create Workspace',
    copy: 'After sign-in, the subscriber registers an organization workspace and becomes the first administrator.',
    accent: '#1769e0',
    visual: 'workspace',
    laptopLabel: 'Workspace'
  },
  {
    start: 10,
    end: 15,
    eyebrow: 'Step 3',
    title: 'Issue Credential',
    copy: 'The administrator creates an issuance invitation with selected claims, roles, and an acceptance QR code.',
    accent: '#19b97a',
    visual: 'issuance',
    laptopLabel: 'Issue'
  },
  {
    start: 15,
    end: 20,
    eyebrow: 'Step 4',
    title: 'Download iOS App',
    copy: 'The credential holder installs the Vanguard Aegis ID iOS wallet and opens the scanner.',
    accent: '#f7b955',
    visual: 'ios',
    laptopLabel: 'Mobile'
  },
  {
    start: 20,
    end: 25,
    eyebrow: 'Step 5',
    title: 'Scan And Accept',
    copy: 'The user scans the QR code, reviews the issuer details, and accepts the organization invitation.',
    accent: '#00b7c7',
    visual: 'scan',
    laptopLabel: 'QR invite'
  },
  {
    start: 25,
    end: 30,
    eyebrow: 'Step 6',
    title: 'Test OIDC Challenge',
    copy: 'A protected app redirects through Aegis ID, sends a wallet challenge, and records the accepted action in the ledger.',
    accent: '#1769e0',
    visual: 'oidc',
    laptopLabel: 'OIDC'
  }
];

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

  fs.copyFileSync(path.join(frameDir, 'frame-0000.png'), posterPath);
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

  <g transform="translate(${cardX},112)">
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
  ${renderJourneyNodes(610, 594 + nodeOffset, scene, scene.accent)}

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
    account: renderAccountVisual,
    workspace: renderWorkspaceVisual,
    issuance: renderIssuanceVisual,
    ios: renderIosDownloadVisual,
    scan: renderScanVisual,
    oidc: renderOidcVisual
  }[scene.visual] || renderWorkspaceVisual;

  return `<g transform="translate(${x + offset},${y})" opacity="${opacity}" filter="url(#shadow)">
    ${visual(scene.accent, pulse)}
  </g>`;
}

function renderAccountVisual(accent, pulse) {
  return `<rect x="0" y="0" width="430" height="270" rx="22" fill="#ffffff"/>
    <rect x="0" y="0" width="430" height="54" rx="22" fill="#edf6ff"/>
    <circle cx="34" cy="27" r="8" fill="#c9d9e8"/>
    <circle cx="60" cy="27" r="8" fill="#c9d9e8"/>
    <circle cx="86" cy="27" r="8" fill="#c9d9e8"/>
    <text class="small" x="34" y="96">Create your account</text>
    <rect x="34" y="124" width="164" height="28" rx="8" fill="#edf6ff"/>
    <rect x="218" y="124" width="164" height="28" rx="8" fill="#edf6ff"/>
    <rect x="34" y="170" width="348" height="28" rx="8" fill="#edf6ff"/>
    <rect x="34" y="218" width="${136 + pulse * 18}" height="34" rx="10" fill="${accent}"/>
    <text class="whiteTiny" x="58" y="241">Create account</text>`;
}

function renderWorkspaceVisual(accent) {
  return `<rect x="0" y="0" width="440" height="280" rx="22" fill="#ffffff"/>
    <rect x="30" y="30" width="160" height="84" rx="16" fill="#edf6ff"/>
    <text class="small" x="52" y="68">Organization</text>
    <text class="tiny" x="52" y="96">Admin workspace</text>
    <rect x="220" y="30" width="190" height="84" rx="16" fill="#e8fff4"/>
    <text class="small" x="244" y="68">First admin</text>
    <text class="tiny" x="244" y="96">Subscriber owner</text>
    <path d="M95 154 H315" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="95" cy="154" r="26" fill="${accent}"/>
    <circle cx="205" cy="154" r="22" fill="#00b7c7"/>
    <circle cx="315" cy="154" r="22" fill="#19b97a"/>
    <rect x="42" y="204" width="356" height="44" rx="12" fill="#f5f9fd"/>
    <text class="tiny" x="64" y="232">Workspace ready for credentials</text>`;
}

function renderIssuanceVisual(accent, pulse) {
  return `<rect x="0" y="0" width="440" height="286" rx="22" fill="#ffffff"/>
    <rect x="28" y="30" width="168" height="218" rx="18" fill="#061625"/>
    <text class="whiteTiny" x="52" y="72">Verified</text>
    <text class="whiteTiny" x="52" y="100">Employee</text>
    <rect x="52" y="134" width="96" height="12" rx="6" fill="${accent}"/>
    <rect x="52" y="162" width="118" height="10" rx="5" fill="#7aa5cc"/>
    <rect x="226" y="30" width="176" height="128" rx="16" fill="#f5f9fd"/>
    ${renderMiniQr(248, 48, 88, accent)}
    <rect x="226" y="178" width="176" height="28" rx="8" fill="#edf6ff"/>
    <rect x="226" y="218" width="${128 + pulse * 20}" height="30" rx="10" fill="${accent}"/>
    <text class="whiteTiny" x="248" y="239">Create issuance</text>`;
}

function renderIosDownloadVisual(accent) {
  return `<rect x="12" y="0" width="196" height="286" rx="34" fill="#091522"/>
    <rect x="28" y="24" width="164" height="222" rx="22" fill="#ffffff"/>
    <rect x="70" y="40" width="80" height="10" rx="5" fill="#091522"/>
    <rect x="54" y="78" width="112" height="112" rx="24" fill="url(#accent)"/>
    <text class="whiteTiny" x="86" y="144">Aegis</text>
    <text class="small" x="48" y="222">Install wallet</text>
    <g transform="translate(248,62)">
      <rect x="0" y="0" width="170" height="62" rx="16" fill="#050b13"/>
      <text class="whiteTiny" x="22" y="27">Download beta</text>
      <text class="whiteTiny" x="22" y="50">on iOS</text>
      <path d="M86 108 V172 M62 148 L86 172 L110 148" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
}

function renderScanVisual(accent, pulse) {
  return `<rect x="0" y="0" width="206" height="278" rx="34" fill="#091522"/>
    <rect x="16" y="24" width="174" height="218" rx="22" fill="#ffffff"/>
    <text class="small" x="42" y="72">Scan QR</text>
    ${renderMiniQr(52, 96, 88, accent)}
    <rect x="36" y="${196 + pulse * 8}" width="134" height="6" rx="3" fill="${accent}" opacity="0.9"/>
    <g transform="translate(250,28)">
      <rect x="0" y="0" width="188" height="220" rx="20" fill="#ffffff"/>
      <text class="small" x="24" y="48">Issuer</text>
      <text class="tiny" x="24" y="78">Vanguard Aegis ID</text>
      <rect x="24" y="112" width="140" height="38" rx="10" fill="${accent}"/>
      <text class="whiteTiny" x="52" y="137">Accept invite</text>
    </g>`;
}

function renderOidcVisual(accent) {
  return `<rect x="0" y="0" width="440" height="276" rx="22" fill="#ffffff"/>
    <rect x="0" y="0" width="440" height="52" rx="22" fill="#edf6ff"/>
    <text class="small" x="30" y="94">Business Expenses</text>
    <rect x="30" y="126" width="180" height="38" rx="10" fill="${accent}"/>
    <text class="whiteTiny" x="56" y="151">Sign in with Aegis ID</text>
    <rect x="236" y="84" width="168" height="150" rx="18" fill="#061625"/>
    <text class="whiteTiny" x="260" y="122">Wallet challenge</text>
    <text class="whiteTiny" x="260" y="154">Approve sign-in</text>
    <rect x="260" y="184" width="112" height="32" rx="10" fill="#19b97a"/>
    <text class="whiteTiny" x="286" y="206">Accept</text>`;
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

function renderJourneyNodes(x, y, scene, accent) {
  const nodes = scenes.map((item, index) => ({
    label: String(index + 1).padStart(2, '0'),
    title: item.title.split(' ')[0],
    active: item === scene
  }));
  return `<g transform="translate(${x},${y})">
    ${nodes.map((node, index) => {
      const dx = index * 94;
      return `<g transform="translate(${dx},0)">
        ${index > 0 ? `<path d="M-46 24 H-12" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.5"/>` : ''}
        <rect x="0" y="0" width="72" height="58" rx="16" fill="${node.active ? accent : '#ffffff'}" opacity="${node.active ? '1' : '0.82'}"/>
        <text x="22" y="25" class="${node.active ? 'whiteTiny' : 'tiny'}">${node.label}</text>
        <text x="12" y="46" class="${node.active ? 'whiteTiny' : 'tiny'}">${escapeXml(node.title)}</text>
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
