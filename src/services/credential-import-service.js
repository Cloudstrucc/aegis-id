// Bulk credential invitations from a CSV.
//
// An organization onboarding two hundred staff does not want to fill in the
// issue form two hundred times. This takes a spreadsheet instead: validate the
// whole file first and report every problem by row and column, then issue the
// rows one at a time in the background while the administrator gets on with
// something else.
//
// Two decisions worth knowing about:
//
// - Validation is all-or-nothing and happens before anything is minted. A
//   file with one bad row in the middle is rejected whole, so the
//   administrator fixes the sheet and re-uploads rather than ending up with
//   half an org invited and a list of leftovers to reconcile.
// - The plan limit is checked up front against the row count. Credentials
//   count against the plan, so a 200-row file on a 50-credential plan fails
//   before it starts instead of at row 51.
//
// Jobs are persisted so a progress bar survives the administrator navigating
// away and back. They run in-process; a restart mid-job leaves the rows already
// issued in place and marks the job interrupted with the count, so nothing is
// double-issued and nothing is silently lost.

const crypto = require('node:crypto');
const config = require('../config');
const FileJsonStore = require('./file-json-store');
const orgAdmin = require('./org-admin-service');
const { effectiveEntitlement } = require('./plan-service');
const { parseWalletId } = require('./wallet-id');

const jobStore = new FileJsonStore(config.paths.credentialImports, []);

// Jobs this process started, so a restart's leftovers can be told apart.
const startedHere = new Set();

const MAX_ROWS = 1000;
const MAX_BYTES = 1024 * 1024;
const MAX_INVITE_TTL_DAYS = 365;

// The columns a template carries, in order. Claim columns are appended per
// organization from its own claim definitions.
const BASE_COLUMNS = [
  { key: 'email', label: 'email', hint: 'Holder email. Required unless wallet_id or phone is given.' },
  { key: 'display_name', label: 'display_name', hint: 'Optional. Derived from the email when blank.' },
  { key: 'wallet_id', label: 'wallet_id', hint: 'Optional. AEG-XXXX-XXXX-XXXX-XXXX. Strongest binding.' },
  { key: 'phone', label: 'phone', hint: 'Optional. E.164, e.g. +16135550100.' },
  { key: 'person_type', label: 'person_type', hint: 'employee | contractor | administrator. Defaults to employee.' },
  { key: 'division', label: 'division', hint: 'Division name or id. Defaults to the organization root.' },
  { key: 'roles', label: 'roles', hint: 'Role names or ids separated by ";". Defaults by person type.' },
  { key: 'invite_ttl_days', label: 'invite_ttl_days', hint: '1-365. Defaults to the organization policy.' }
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 .\-()]{6,30}$/;

// ---------------------------------------------------------------------------
// CSV

// RFC 4180, near enough: quoted fields, doubled quotes, CRLF or LF, a BOM.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing newline produces an empty last row; blank lines anywhere are
  // not data either.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function templateColumns(state) {
  return [
    ...BASE_COLUMNS,
    ...state.claimDefinitions.map((claim) => ({
      key: `claim_${claim.key}`,
      label: `claim_${claim.key}`,
      hint: `${claim.label}. Optional; defaults to "${claim.defaultValue || ''}".`,
      claimKey: claim.key
    }))
  ];
}

// The template is the header row plus one example row, so somebody opening it
// in a spreadsheet can see what each cell is supposed to hold.
async function buildTemplateCsv(workspace) {
  const state = await orgAdmin.getOrCreateState(workspace);
  const columns = templateColumns(state);
  const example = {
    email: 'jordan.smith@example.com',
    display_name: 'Jordan Smith',
    wallet_id: '',
    phone: '',
    person_type: 'employee',
    division: state.orgUnits[0]?.name || '',
    roles: state.roles.find((role) => role.id === 'role-employee')?.name || '',
    invite_ttl_days: String(state.policy.inviteTtlDays || 7)
  };
  for (const column of columns) {
    if (column.claimKey) {
      const claim = state.claimDefinitions.find((entry) => entry.key === column.claimKey);
      example[column.key] = column.claimKey === 'email' ? '' : claim?.defaultValue || '';
    }
  }
  const lines = [
    columns.map((column) => csvCell(column.label)).join(','),
    columns.map((column) => csvCell(example[column.key] ?? '')).join(',')
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// Validation

// Every problem, not the first one. Returns { rows, errors } where each error
// is { row, column, message } with `row` being the spreadsheet line number
// (header is 1) so it matches what the administrator sees in Excel.
async function validateCsv(workspace, subscription, csvText) {
  const errors = [];
  if (Buffer.byteLength(String(csvText || ''), 'utf8') > MAX_BYTES) {
    return { rows: [], errors: [{ row: 0, column: '', message: `The file is larger than ${MAX_BYTES / 1024} KB.` }] };
  }

  const state = await orgAdmin.getOrCreateState(workspace);
  const columns = templateColumns(state);
  const parsed = parseCsv(csvText);
  if (parsed.length === 0) {
    return { rows: [], errors: [{ row: 0, column: '', message: 'The file is empty.' }] };
  }

  const header = parsed[0].map((cell) => cell.trim().toLowerCase());
  const known = new Map(columns.map((column) => [column.key, column]));
  header.forEach((name, index) => {
    if (!name) {
      errors.push({ row: 1, column: columnLetter(index), message: 'Blank column heading.' });
    } else if (!known.has(name)) {
      errors.push({ row: 1, column: columnLetter(index), message: `Unknown column "${name}". Download the template for the accepted headings.` });
    }
  });
  const hasContactColumn = ['email', 'wallet_id', 'phone'].some((key) => header.includes(key));
  if (!hasContactColumn) {
    errors.push({ row: 1, column: '', message: 'The file needs an email, wallet_id or phone column.' });
  }
  if (errors.length > 0) {
    return { rows: [], errors };
  }

  const dataRows = parsed.slice(1);
  if (dataRows.length === 0) {
    return { rows: [], errors: [{ row: 2, column: '', message: 'No rows under the heading.' }] };
  }
  if (dataRows.length > MAX_ROWS) {
    return { rows: [], errors: [{ row: 0, column: '', message: `At most ${MAX_ROWS} rows per file; this one has ${dataRows.length}.` }] };
  }

  const existingEmails = new Set(state.credentials.map((credential) => credential.holderEmail).filter(Boolean));
  const existingWallets = new Set(state.credentials.map((credential) => credential.walletId).filter(Boolean));
  const seenEmails = new Map();
  const seenWallets = new Map();
  const rows = [];

  dataRows.forEach((cells, offset) => {
    const line = offset + 2;
    const record = {};
    header.forEach((name, index) => {
      record[name] = (cells[index] ?? '').trim();
    });
    const column = (key) => columnLetter(header.indexOf(key));
    const fail = (key, message) => errors.push({ row: line, column: column(key), message });

    const email = (record.email || '').toLowerCase();
    const walletIdRaw = record.wallet_id || '';
    const walletId = walletIdRaw ? parseWalletId(walletIdRaw) : null;
    const phone = record.phone || '';

    if (!email && !walletIdRaw && !phone) {
      errors.push({ row: line, column: '', message: 'Give an email, a wallet_id or a phone.' });
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      fail('email', `"${record.email}" is not an email address.`);
    }
    if (walletIdRaw && !walletId) {
      fail('wallet_id', `"${walletIdRaw}" is not a Wallet ID (AEG-XXXX-XXXX-XXXX-XXXX).`);
    }
    if (phone && !PHONE_PATTERN.test(phone)) {
      fail('phone', `"${phone}" is not a phone number.`);
    }
    if (email) {
      if (existingEmails.has(email)) {
        fail('email', `${email} already holds a credential in this organization.`);
      } else if (seenEmails.has(email)) {
        fail('email', `${email} is repeated from row ${seenEmails.get(email)}.`);
      } else {
        seenEmails.set(email, line);
      }
    }
    if (walletId) {
      if (existingWallets.has(walletId)) {
        fail('wallet_id', `${walletId} already holds a credential in this organization.`);
      } else if (seenWallets.has(walletId)) {
        fail('wallet_id', `${walletId} is repeated from row ${seenWallets.get(walletId)}.`);
      } else {
        seenWallets.set(walletId, line);
      }
    }

    const personType = (record.person_type || 'employee').toLowerCase();
    if (!orgAdmin.PERSON_TYPES.some((type) => type.id === personType)) {
      fail('person_type', `"${record.person_type}" is not one of ${orgAdmin.PERSON_TYPES.map((type) => type.id).join(', ')}.`);
    }

    let divisionId = 'unit-root';
    if (record.division) {
      const unit = state.orgUnits.find(
        (candidate) => candidate.id === record.division || candidate.name.toLowerCase() === record.division.toLowerCase()
      );
      if (unit) {
        divisionId = unit.id;
      } else {
        fail('division', `No division called "${record.division}".`);
      }
    }

    const roleIds = [];
    if (record.roles) {
      for (const token of record.roles.split(';').map((part) => part.trim()).filter(Boolean)) {
        const role = state.roles.find(
          (candidate) => candidate.id === token || candidate.name.toLowerCase() === token.toLowerCase()
        );
        if (role) {
          roleIds.push(role.id);
        } else {
          fail('roles', `No role called "${token}".`);
        }
      }
    }

    let inviteTtlDays;
    if (record.invite_ttl_days) {
      const parsedTtl = Number.parseInt(record.invite_ttl_days, 10);
      if (!Number.isInteger(parsedTtl) || parsedTtl < 1 || parsedTtl > MAX_INVITE_TTL_DAYS || String(parsedTtl) !== record.invite_ttl_days) {
        fail('invite_ttl_days', `"${record.invite_ttl_days}" must be a whole number from 1 to ${MAX_INVITE_TTL_DAYS}.`);
      } else {
        inviteTtlDays = parsedTtl;
      }
    }

    const input = {
      holderEmail: email,
      displayName: record.display_name || '',
      walletId: walletId || '',
      holderPhone: phone,
      personType,
      divisionId,
      roleIds,
      inviteTtlDays
    };
    for (const claim of state.claimDefinitions) {
      const value = record[`claim_${claim.key}`];
      if (value) {
        if (Array.isArray(claim.options) && claim.options.length > 0 && !claim.options.some((option) => option.value === value)) {
          fail(`claim_${claim.key}`, `"${value}" is not one of ${claim.options.map((option) => option.value).join(', ')}.`);
        }
        input[`claim_${claim.key}`] = value;
      }
    }
    rows.push({ line, input, label: email || walletId || phone });
  });

  // The plan, before anything is minted.
  const entitlement = effectiveEntitlement(subscription);
  const limit = entitlement.limits.maxCredentialsPerWorkspace;
  if (limit !== null) {
    const remaining = Math.max(0, limit - state.credentials.length);
    if (rows.length > remaining) {
      errors.push({
        row: 0,
        column: '',
        message: `This organization can issue ${remaining} more credential${remaining === 1 ? '' : 's'} on the ${entitlement.plan.label} plan, and the file has ${rows.length} rows.`
      });
    }
  }

  errors.sort((a, b) => a.row - b.row || a.column.localeCompare(b.column));
  return { rows: errors.length > 0 ? [] : rows, errors, total: dataRows.length };
}

function columnLetter(index) {
  if (index < 0) {
    return '';
  }
  let letters = '';
  let n = index;
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

// ---------------------------------------------------------------------------
// Jobs

async function startImport(workspace, subscription, csvText) {
  await orgAdmin.assertOrgPrivilege(workspace, subscription, 'credentials.issue');
  const active = await getActiveJob(workspace.id);
  if (active) {
    const error = new Error('An import is already running for this organization. Wait for it to finish.');
    error.status = 409;
    throw error;
  }

  const validation = await validateCsv(workspace, subscription, csvText);
  if (validation.errors.length > 0) {
    const error = new Error('The file has problems to fix before it can be imported.');
    error.status = 422;
    error.details = validation.errors;
    throw error;
  }

  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    subscriptionId: subscription.id,
    startedBy: subscription.email,
    status: 'running',
    total: validation.rows.length,
    done: 0,
    failed: 0,
    // Row-level failures during the run. Validation should have caught
    // everything, so anything here is a server-side refusal worth reading.
    failures: [],
    createdAt: now,
    updatedAt: now,
    finishedAt: null
  };
  startedHere.add(job.id);
  await saveJob(job);

  // Detached on purpose: the request returns the job id and the page polls.
  setImmediate(() => runJob(job, workspace, subscription, validation.rows).catch(() => {}));
  return job;
}

async function runJob(job, workspace, subscription, rows) {
  for (const row of rows) {
    try {
      await orgAdmin.issueCredential(workspace, subscription, row.input);
      job.done += 1;
    } catch (error) {
      job.failed += 1;
      job.failures.push({ row: row.line, label: row.label, message: error.message });
      // A plan or policy refusal will refuse every remaining row too; stop
      // rather than write the same failure a hundred times.
      if (error.status === 402 || error.status === 403) {
        job.status = 'failed';
        job.failures.push({ row: 0, label: '', message: 'Stopped: the remaining rows would be refused for the same reason.' });
        break;
      }
    }
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
  }
  if (job.status === 'running') {
    job.status = job.failed > 0 ? 'completed-with-errors' : 'completed';
  }
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  await saveJob(job);
}

async function saveJob(job) {
  const jobs = await jobStore.read();
  const index = jobs.findIndex((entry) => entry.id === job.id);
  if (index === -1) {
    jobs.push(job);
  } else {
    jobs[index] = job;
  }
  // Finished jobs are kept for a while so the page can show what happened,
  // then dropped; the credentials themselves are the record.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await jobStore.write(jobs.filter((entry) => !entry.finishedAt || Date.parse(entry.finishedAt) > cutoff));
  return job;
}

// A job still marked running that this process did not start was interrupted
// by a restart. Its issued rows are real; the rest never happened.
async function listJobs(workspaceId) {
  const jobs = await jobStore.read();
  let changed = false;
  for (const job of jobs) {
    if (job.status === 'running' && !startedHere.has(job.id)) {
      job.status = 'interrupted';
      job.finishedAt = new Date().toISOString();
      job.failures.push({
        row: 0,
        label: '',
        message: `The service restarted after ${job.done} of ${job.total} rows. Remove those rows from the file and import the rest.`
      });
      changed = true;
    }
  }
  if (changed) {
    await jobStore.write(jobs);
  }
  return jobs
    .filter((job) => job.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getActiveJob(workspaceId) {
  return (await listJobs(workspaceId)).find((job) => job.status === 'running') || null;
}

async function getJob(workspaceId, jobId) {
  return (await listJobs(workspaceId)).find((job) => job.id === jobId) || null;
}

// The most recent job is what the page shows on load: a running one gets a
// progress bar, a finished one a summary until it is dismissed.
async function getLatestJob(workspaceId) {
  return (await listJobs(workspaceId))[0] || null;
}

module.exports = {
  BASE_COLUMNS,
  MAX_ROWS,
  buildTemplateCsv,
  getActiveJob,
  getJob,
  getLatestJob,
  parseCsv,
  startImport,
  validateCsv
};
