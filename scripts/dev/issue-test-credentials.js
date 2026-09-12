// Issue a batch of test credential invitations from the browser console.
//
// Not a product surface. This drives the same dashboard form an administrator
// fills in by hand, using the session already signed in to the tab, so it can
// only do what that administrator could do — and it counts against the plan
// like any other issuance. For a real bulk onboarding use "Import CSV" on the
// people directory instead; this exists for quick test fixtures.
//
// Usage:
//   1. Sign in and open an organization dashboard you administer:
//        /dashboard/<subscriptionId>/orgs/<workspaceId>
//   2. Paste this whole file into the browser console.
//   3. Run, for example:
//        await issueTestCredentials({ count: 3 })
//        await issueTestCredentials({ count: 4, prefix: 'appreview', ttlDays: 365 })
//
// Each call prints a table of the addresses issued and their aegisid://
// invitation links, and returns the same as an array.
//
// Options:
//   count     how many to issue                          (default 3)
//   prefix    local part of the address, numbered        (default 'test')
//   domain    address domain                             (default 'example.com')
//   ttlDays   invitation window, 1-365                   (default 30)
//   personType 'employee' | 'contractor' | 'administrator' (default 'employee')
//   unique    add a timestamp so the addresses never collide (default true;
//             set false for stable names like appreview1@example.com)

// eslint-disable-next-line no-unused-vars
async function issueTestCredentials(options = {}) {
  const {
    count = 3,
    prefix = 'test',
    domain = 'example.com',
    ttlDays = 30,
    personType = 'employee',
    unique = true
  } = options;

  const match = window.location.pathname.match(/^(\/dashboard\/[^/]+\/orgs\/[^/]+)/);
  if (!match) {
    throw new Error('Open an organization dashboard (/dashboard/<subscription>/orgs/<workspace>) first.');
  }
  const base = match[1];
  const stamp = unique ? `-${Date.now().toString(36)}` : '';
  const issued = [];

  for (let n = 1; n <= count; n += 1) {
    const email = `${prefix}${n}${stamp}@${domain}`.toLowerCase();
    const body = new URLSearchParams();
    body.append('holderEmail', email);
    body.append('displayName', `${capitalize(prefix)} ${n}`);
    body.append('personType', personType);
    body.append('inviteTtlDays', String(ttlDays));
    body.append('claim_displayName', `${capitalize(prefix)} ${n}`);
    body.append('claim_email', email);
    body.append('claim_employeeId', `${prefix.toUpperCase()}-${n}`);

    const response = await fetch(`${base}/admin/credentials`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    // The form route redirects on success; anything else is a page with the
    // refusal in its description.
    if (response.type !== 'opaqueredirect' && !response.ok) {
      const html = await response.text();
      const reason = html.match(/name="description" content="([^"]*)"/)?.[1] || `HTTP ${response.status}`;
      console.error(`Stopped at ${email}: ${reason}`);
      break;
    }
    issued.push({ email });
  }

  // Read the links back from the people directory: they are built from the
  // credential id, so the page is the simplest place to get them.
  if (issued.length > 0) {
    const page = await fetch(`${base}?blade=people&peopleStatus=invited`, { credentials: 'include' });
    const doc = new DOMParser().parseFromString(await page.text(), 'text/html');
    for (const viewer of doc.querySelectorAll('[data-invite-poll]')) {
      const json = viewer.querySelector('pre')?.textContent;
      if (!json) {
        continue;
      }
      try {
        const invite = JSON.parse(json);
        const entry = issued.find((item) => item.email === String(invite.holderEmail || '').toLowerCase());
        if (entry) {
          entry.credentialId = invite.credentialId;
          entry.expiresAt = invite.expiresAt;
          entry.inviteUrl = invite.inviteUrl;
        }
      } catch (error) {
        // Not an invite payload; skip it.
      }
    }
  }

  console.table(issued);
  return issued;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
