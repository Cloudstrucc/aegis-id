'use strict';

// Step runner, logging, screenshots and the HTML report for the end-to-end
// journey. Kept free of journey specifics so the steps read as a narrative.

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

const ICONS = { pass: '✓', fail: '✗', skip: '–', info: '·' };
const COLOURS = { pass: '\x1b[32m', fail: '\x1b[31m', skip: '\x1b[33m', info: '\x1b[90m', reset: '\x1b[0m' };

class Runner {
  constructor({ artifactsDir, log = console.log }) {
    this.artifactsDir = artifactsDir;
    this.shotsDir = path.join(artifactsDir, 'screenshots');
    this.steps = [];
    this.lines = [];
    this.startedAt = Date.now();
    this.log = log;
  }

  async init() {
    await fs.mkdir(this.shotsDir, { recursive: true });
  }

  write(level, message) {
    const stamp = new Date().toISOString().slice(11, 23);
    this.lines.push(`${stamp} [${level}] ${message}`);
    const colour = COLOURS[level] || COLOURS.info;
    this.log(`${colour}${ICONS[level] || ICONS.info} ${message}${COLOURS.reset}`);
  }

  info(message) {
    this.write('info', message);
  }

  /**
   * Run one named step. A thrown error fails the step and the journey continues,
   * so the report shows everything that worked as well as the first thing that
   * did not.
   */
  async step(name, fn, { optional = false } = {}) {
    const started = Date.now();
    const record = { name, status: 'pass', detail: '', ms: 0, screenshots: [] };
    this.steps.push(record);

    try {
      const detail = await fn(record);
      record.detail = typeof detail === 'string' ? detail : record.detail;
      record.ms = Date.now() - started;
      this.write('pass', `${name}${record.detail ? ` — ${record.detail}` : ''}`);
      return true;
    } catch (error) {
      record.ms = Date.now() - started;
      record.status = optional ? 'skip' : 'fail';
      record.detail = error.message;
      record.stack = error.stack;
      this.write(record.status, `${name} — ${error.message}`);
      return false;
    }
  }

  /** Capture the simulator screen. Never fails the journey on its own. */
  async simulatorShot(record, label) {
    const file = path.join(this.shotsDir, `sim-${this.steps.length}-${slug(label)}.png`);
    try {
      await run('xcrun', ['simctl', 'io', 'booted', 'screenshot', file]);
      record?.screenshots.push({ kind: 'simulator', label, file: path.relative(this.artifactsDir, file) });
    } catch (error) {
      this.info(`simulator screenshot skipped (${error.message.split('\n')[0]})`);
    }
  }

  /** Save a page's HTML so the report can show what the browser received. */
  async pageSnapshot(record, label, html) {
    const file = path.join(this.shotsDir, `page-${this.steps.length}-${slug(label)}.html`);
    await fs.writeFile(file, html, 'utf8');
    record?.screenshots.push({ kind: 'page', label, file: path.relative(this.artifactsDir, file) });
  }

  get summary() {
    const counts = { pass: 0, fail: 0, skip: 0 };
    for (const step of this.steps) {
      counts[step.status] += 1;
    }
    return { ...counts, total: this.steps.length, ms: Date.now() - this.startedAt };
  }

  async finish(context = {}) {
    const summary = this.summary;
    await fs.writeFile(path.join(this.artifactsDir, 'run.log'), this.lines.join('\n') + '\n', 'utf8');
    await fs.writeFile(
      path.join(this.artifactsDir, 'report.json'),
      JSON.stringify({ summary, context, steps: this.steps }, null, 2),
      'utf8'
    );
    await fs.writeFile(path.join(this.artifactsDir, 'report.html'), renderReport(summary, context, this.steps), 'utf8');
    return summary;
  }
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderReport(summary, context, steps) {
  const rows = steps
    .map((step, index) => {
      const shots = step.screenshots
        .map((shot) =>
          shot.kind === 'simulator'
            ? `<figure><img src="${escapeHtml(shot.file)}" alt="${escapeHtml(shot.label)}"><figcaption>${escapeHtml(shot.label)}</figcaption></figure>`
            : `<p class="doc"><a href="${escapeHtml(shot.file)}">${escapeHtml(shot.label)} (captured page)</a></p>`
        )
        .join('');
      return `<tr class="${step.status}">
        <td class="n">${index + 1}</td>
        <td><strong>${escapeHtml(step.name)}</strong>${step.detail ? `<div class="detail">${escapeHtml(step.detail)}</div>` : ''}${shots ? `<div class="shots">${shots}</div>` : ''}</td>
        <td class="s">${step.status.toUpperCase()}</td>
        <td class="ms">${step.ms} ms</td>
      </tr>`;
    })
    .join('');

  const verdict = summary.fail > 0 ? 'FAILED' : 'PASSED';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aegis ID — end-to-end journey report</title>
<style>
  :root{--ink:#17273a;--muted:#5f7185;--line:#dce7f2;--pass:#1a7f4b;--fail:#b3261e;--skip:#8a6d00}
  *{box-sizing:border-box} body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#f6f9fc}
  header{background:#0d2136;color:#fff;padding:28px 6%}
  header h1{margin:0 0 6px;font-size:24px}
  header p{margin:0;color:#a9c0d8;font-size:14px}
  .verdict{display:inline-block;margin-top:14px;padding:6px 14px;border-radius:999px;font-weight:700;font-size:13px;letter-spacing:.06em}
  .PASSED{background:#1a7f4b;color:#fff}.FAILED{background:#b3261e;color:#fff}
  main{padding:24px 6% 64px;max-width:1100px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:0 0 24px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .card b{display:block;font-size:24px;line-height:1.1}
  .card span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
  th{background:#eef4fa;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  td.n,td.ms{width:1%;white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
  td.s{width:1%;white-space:nowrap;font-weight:700;font-size:12px}
  tr.pass td.s{color:var(--pass)} tr.fail td.s{color:var(--fail)} tr.skip td.s{color:var(--skip)}
  tr.fail{background:#fdf3f2}
  .detail{color:var(--muted);font-size:13.5px;margin-top:4px;white-space:pre-wrap}
  .shots{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
  figure{margin:0;width:200px} figure img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
  figcaption{font-size:11.5px;color:var(--muted);margin-top:4px}
  .doc{margin:8px 0 0;font-size:13px}
  dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin:24px 0 0;font-size:13.5px}
  dt{color:var(--muted)} dd{margin:0;font-family:ui-monospace,monospace;word-break:break-all}
</style></head><body>
<header>
  <h1>Aegis ID — end-to-end journey</h1>
  <p>${escapeHtml(new Date().toISOString())} · ${(summary.ms / 1000).toFixed(1)}s</p>
  <span class="verdict ${verdict}">${verdict}</span>
</header>
<main>
  <div class="cards">
    <div class="card"><b>${summary.total}</b><span>Steps</span></div>
    <div class="card"><b style="color:var(--pass)">${summary.pass}</b><span>Passed</span></div>
    <div class="card"><b style="color:var(--fail)">${summary.fail}</b><span>Failed</span></div>
    <div class="card"><b style="color:var(--skip)">${summary.skip}</b><span>Skipped</span></div>
  </div>
  <table><thead><tr><th>#</th><th>Step</th><th>Result</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
  <dl>${Object.entries(context).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
</main></body></html>`;
}

module.exports = { Runner };
