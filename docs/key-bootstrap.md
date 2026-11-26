# Key bootstrap and the gate status: Dinis's one exception

Built by cl-6.infra@PrompTugal.dinis with cl-6.security@PrompTugal.dinis, 26 Nov 2026. Design: PrompTugal__Agent__Security `docs/security/2026-11-26-section-repos-key-bootstrap.md` (6fbdbc8). Policy: `policy/key-bootstrap.json`.

## What it does
- **Key bootstrap** (`.github/workflows/key-bootstrap.yml`): for a section agent's key pull request that cl-6.security has approved (a detached signature in its home over the exact head SHA and diff hash), PrompTugal__IaC checks every rule in the policy, merges that pull request at that SHA, sets `SIG_BOOTSTRAP_ANCHOR` to the merge, and deletes it after the first green run on dev or after 24 hours. One repository per run.
- **Gate status** (`.github/workflows/gate-status.yml`): posts `promptugal-iac/gate` on dev and work/* heads of the covered repositories. Success when `.github/**`, `scripts/check-*.mjs` and `team/keys.json` are untouched; when they are touched, only with cl-6.security's signed approval of that SHA.
- **dev-gate ruleset** (Org apply, `org/repos.json`): on dev of the covered repositories, no deletion, no force push, and the gate status required, bound to the App, so a same-named status from a pushed workflow does not count. Created only once the status is on dev. Bypass: the App (to merge approved key pull requests) and organisation admins.
- **PrompTugal__IaC itself**: `main-locked` and `dev-safe` rulesets (no deletion, no force push, a pull request required).

GitHub does not allow file-path push rules on public repositories (rules probe run 45743552530: HTTP 422), so the gate is a required status.

## What Dinis does, once
1. Merge this pull request.
2. Add to the App's PrompTugal installation (agenticcells-site-factory): **Commit statuses: write**, **Variables: write**, **Pull requests: write**, **Workflows: write**, **Actions: read**. Each run mints tokens with only the permission its step needs, for one repository.
3. Turn on the two schedules: uncomment the `schedule` lines in `key-bootstrap.yml` and `gate-status.yml` (15 minutes), or tell cl-6.infra to.

After that, new or rotated section keys need no one but the agent and cl-6.security. A broken approver chain, or a change to the policy, comes back to Dinis.

## Agents' release flow
With dev-gate on, a commit lands on dev only once it carries the App's status: push to `work/<name>` first, wait for the status (up to the schedule's interval), then fast-forward dev. cl-6.conductor confirms each agent's release.sh can do this.
