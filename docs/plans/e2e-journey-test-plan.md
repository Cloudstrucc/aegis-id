# Implementation Plan — Interactive End-to-End Journey Test

> **Status:** DRAFT for review. No code written.
> One command, run on **localhost only**, that drives the full journey through a
> **visible browser** and a **visible iOS Simulator**, from a clean slate, and
> produces a report with screenshots and a pass/fail log.

---

## 1. What the test covers

| # | Step | Surface |
|---|---|---|
| 1 | Create an account and sign in | Browser |
| 2 | Register an organization | Browser |
| 3 | Set up the wallet (Wallet ID + recovery codes) | Simulator |
| 4 | Connect the wallet to the organization | Simulator |
| 5 | Issue a credential to the account, bound by Wallet ID | Browser |
| 6 | Accept the credential in the wallet | Simulator |
| 7 | OIDC authentication challenge → approve in wallet → unlock | Browser + Simulator |
| 8 | Business Expenses: approve an expense | Browser + Simulator |
| 9 | Digital signature app: sign an approval | Browser + Simulator |
| 10 | Verify the evidence ledger is intact | Assertion |

---

## 2. The two hard problems, and how I propose to solve them

### 2.1 Sign-in requires MFA

Account creation sends an emailed one-time code. A test can't read that mailbox,
and I will not weaken the real auth path.

**Proposal: a local-only bypass, off by default, with three independent guards.**

```
LOCAL_TEST_MODE=true          # explicit opt-in, default false
+ NODE_ENV !== 'production'   # never in a production build
+ host is loopback            # request must arrive on 127.0.0.1 / ::1 / localhost
```

All three must hold. Any one failing disables it. Concretely:

- Config reads `localTestMode` once at startup and **forces it false** unless
  `NODE_ENV` is non-production.
- A middleware additionally checks the *request* is loopback, so even a
  mis-set flag on a deployed host cannot activate it — a remote request never
  has a loopback address.
- Startup logs a loud banner when active, so it can't be on unnoticed.
- Only one behaviour changes: an account flagged `testAccount: true` skips the
  second factor. Everything else — passwords, sessions, RBAC — is untouched.
- A test asserts it is **inert** when `NODE_ENV=production` even with the flag on.

You also asked for a reviewable local account. The seeder creates
`local-tester@aegis.test` with a known password, flagged `testAccount`, so you
can sign in and inspect the same data the run produced.

### 2.2 Driving the iOS Simulator

The wallet is a native app. I'd drive it through the simulator control already
available to me: launch, screenshot, tap, type, and deep-link via `open_url`.

**Deep links do the heavy lifting.** Rather than scripting fragile taps, the
harness passes `aegisid://org-invite?…` and `aegisid://credential-invite?…`
straight to the app — the same payloads the QR codes carry. Taps are then only
needed for setup fields and approve buttons, and each is preceded by a
screenshot so a failure shows what the screen actually looked like.

**Reliability:** every interaction polls the *server* for the resulting state
change rather than sleeping. Tapping "approve" is followed by polling the
challenge until it reads `accepted`, with a timeout. That removes the usual
flakiness of UI tests.

---

## 3. Architecture

```
scripts/e2e/run.sh                  one command, orchestrates everything
  ├── harness/server.js             boots Aegis on a free port, isolated data dir
  ├── harness/seed.js               creates the local test account
  ├── harness/browser.js            drives the browser, captures screenshots
  ├── harness/simulator.js          drives the simulator, captures screenshots
  ├── harness/assert.js             polls server state, records pass/fail
  └── harness/report.js             writes the HTML + JSON report
```

**Isolation.** Every run gets `artifacts/e2e/<timestamp>/data/`, with every
`*_STORE_PATH` pointed at it. Nothing touches your working `data/`, and each run
genuinely starts from scratch.

**Browser choice.** I'd use the browser tooling I already have rather than adding
Playwright — no new dependency, and you see it happen. If you'd rather have
Playwright for CI-grade selectors and video capture, say so; it's a bigger
install but more robust for repeat runs.

---

## 4. What you run

```bash
scripts/e2e/run.sh                 # full journey, visible browser + simulator
scripts/e2e/run.sh --headless      # no simulator, API-only wallet steps
scripts/e2e/run.sh --keep          # leave the server and data up afterwards
scripts/e2e/run.sh --only=oidc     # a single scenario
```

Prerequisites checked before starting, with a clear message if missing: Xcode
simulator available, a booted device, ports free, and Business Expenses running
locally (steps 8–9 skip with a warning if it isn't, rather than failing).

---

## 5. The report

`artifacts/e2e/<timestamp>/report.html` — self-contained, opens in a browser:

- **Summary:** pass/fail per step, total duration, environment captured
- **Timeline:** each step with elapsed time, the assertion made, and the result
- **Screenshots:** browser and simulator, captioned, inline, before/after each key action
- **Evidence:** the resulting ledger, with the chain verification result
- **Failures:** the exact assertion, the server response, and the screenshot at
  the moment of failure

Plus `report.json` for machine reading and `run.log` for the full trace.

**Exit codes:** `0` all passed, `1` an assertion failed, `2` a prerequisite was
missing. So it can gate a commit later.

---

## 6. Honest limitations

- **Passkeys cannot be tested** over `http://localhost` — WebAuthn needs HTTPS
  and a verified RP ID. The run will note this as skipped rather than passed.
- **Business Expenses and the signature app are separate applications.** If they
  aren't running locally, steps 8–9 skip with a warning. I'd need to know how you
  start them locally to wire this properly — that's my main open question.
- **The simulator must already be booted.** I'll check and tell you what to run
  rather than booting one and guessing at the device.
- **First run will need tuning.** UI automation always does; the screenshots on
  failure are what make that quick.

---

## 7. Proposed order

1. Harness skeleton + isolated data + report scaffolding
2. `LOCAL_TEST_MODE` with its three guards, and the test proving it's inert in production
3. Browser steps 1–2, 5 (account, org, credential)
4. Simulator steps 3–4, 6 (wallet setup, connect, accept)
5. Step 7 (OIDC challenge, both surfaces)
6. Steps 8–9 (Business Expenses, signature) — needs your input on running them locally
7. Step 10 + report polish

Each phase leaves a runnable command, so you can try it before the whole thing is finished.

---

## 8. What I need from you

1. **Is the local-only MFA bypass acceptable as specified** — flag off by default,
   plus non-production, plus loopback-only? I'd rather over-guard this than not.
2. **How do you run Business Expenses and the signature app locally?** Repo path
   and start command. Without this, steps 8–9 can only be stubbed.
3. **Browser tooling:** my existing browser control (no new dependency, you watch
   it live), or add **Playwright** (heavier, better for repeat/CI runs)?
4. **Scope for the first cut:** would you rather I deliver steps 1–7 working
   end to end first, and add 8–9 once the app question is settled?

---

*End of plan — awaiting your direction before implementation.*
