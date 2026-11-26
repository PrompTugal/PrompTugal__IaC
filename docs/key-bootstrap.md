# Key bootstrap and the gate status: Dinis's one exception

Built by cl-6.infra@PrompTugal.dinis with cl-6.security@PrompTugal.dinis, 26 Nov 2026. Design: PrompTugal__Agent__Security `docs/security/2026-11-26-section-repos-key-bootstrap.md` (6fbdbc8). Policy: `policy/key-bootstrap.json`.

## What it does
- **Key bootstrap** (`.github/workflows/key-bootstrap.yml`): for a section agent's key pull request that cl-6.security has approved (a detached signature in its home over the exact head SHA and diff hash), PrompTugal__IaC checks every rule in the policy (the pull request's base is dev's head and dev's head is the last verified anchor; only team/keys.json in the repository's key format and files pinned whole by sha256 in cl-6.security's signed pins change; the whole file list is read, and 300 or more files are refused), merges that pull request at that SHA, checks the merged tree is the approved tree, sets `SIG_BOOTSTRAP_ANCHOR` to the merge, and deletes it after the first green run on dev or after 24 hours. One repository per run.
- **Gate status** (`.github/workflows/gate-status.yml`): posts `promptugal-iac/gate` on dev and work/* heads of the covered repositories. On dev it compares from the anchor A, on work/* from dev. Success when `.github/**`, `scripts/**`, `team/**` and `.gitattributes` are untouched; when they are touched, only with cl-6.security's signed approval of that SHA; failure when A is unknown or the file list may be cut.
- **dev-gate ruleset** (Org apply, `org/repos.json`): on dev of the covered repositories, no deletion, no force push, and the gate status required, bound to the App, so a same-named status from a pushed workflow does not count. Created only once the status is on dev. Bypass: organisation admins only. An approved key pull request carries the gate status through cl-6.security's gate approval of its head SHA.
- **PrompTugal__IaC itself**: `main-locked` and `dev-safe` rulesets (no deletion, no force push, a pull request required, with no approvals counted: fine while only Dinis merges policy changes).
- **Per repository** (`repository_config`): the job whose pass makes a pages.yml run the anchor, and the key format (Signals: P-256 `git_signing.pem`). Cyber needs both verify and leakscan.
- **Whole-file pins** (`pinnable_files`, `pins`): each repository's new pages.yml, Travel's check-commits.mjs and Signals' leak-scan.mjs are pinned by sha256 in cl-6.security's signed `approvals/pins/<repo>.json`, only for the files this policy lists per repository. No further merge by Dinis.

GitHub does not allow file-path push rules on public repositories (rules probe run 45743552530: HTTP 422), so the gate is a required status.

## What Dinis does, once
1. Merge this pull request.
2. Add to the App's PrompTugal installation (agenticcells-site-factory): **Commit statuses: write**, **Variables: write**, **Pull requests: write**, **Workflows: write**, **Actions: read**.
4. Later, once: merge the pins update (the reviewed pages.yml of each repository, Travel's and Signals' gate files, and the anchor jobs for Cyber, Videos and Travel). Each run mints tokens with only the permission its step needs, for one repository.
3. Turn on the two schedules: uncomment the `schedule` lines in `key-bootstrap.yml` and `gate-status.yml` (15 minutes), or tell cl-6.infra to.

After that, new or rotated section keys need no one but the agent and cl-6.security. A broken approver chain, or a change to the policy, comes back to Dinis.

## Agents' release flow
With dev-gate on, a commit lands on dev only once it carries the App's status: push to `work/<name>` first, wait for the status (up to the schedule's interval), then fast-forward dev. cl-6.conductor confirms each agent's release.sh can do this.
