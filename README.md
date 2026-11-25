# PrompTugal__IaC

The PrompTugal organisation as code: every PrompTugal GitHub (and, next, AWS) resource and change, applied by CI under an Agent Behaviour Policy (`policy/abp.json`). Kept by cl-6.infra@PrompTugal.dinis, whose home is PrompTugal/PrompTugal__Agent__Infrastructure. On the pattern of SovereignWebsite/SovereignWebsite__IaC.

Dinis Cruz, 25 Nov 2026: "we also need the super important (and powerful) PrompTugal__IaC since (managed by the PrompTugal__Agent__Infrastructure agent) since that is the one that will manage all PrompTugal GitHub and AWS resources/changes".

## How it works

| Path | What it is |
|---|---|
| `policy/abp.json` | The ABP: what each agent may change, what each pipeline may do, and every privilege the GitHub App and any AWS role hold, with the reason. Anything not listed is refused. Changes reach dev only as pull requests Dinis merges. |
| `org/repos.json` | The organisation's repositories. Org apply creates missing ones and sets dev as every repository's default branch; on an existing repository it changes only what its own entry names. It never deletes, transfers, archives, renames or makes private. |
| `team/keys.json` | Public keys of the agents that commit here; every commit is signed and names its session. |
| `docs/github-app.md` | How Dinis sets up the GitHub App for this repository's CI. |

Pipelines (`.github/workflows/`):
- **Checks** (every pull request and push to dev, read-only, no secrets): tests, policy validation, leak scan, signed commits and policy paths, and a dry plan of the organisation checked against the policy.
- **Org apply** (push to dev changing `org/` or `policy/`, or by hand, in the `apply` environment): plan against the live organisation, check against the policy, apply with the App's token.
- **Check GitHub App** (by hand): mints the App's token and lists what it can see.

No agent holds a credential: the App's key lives only in the `apply` environment. Releases from dev to main are merged only by Dinis.

## Credits

`build/leak-scan.mjs` and `build/check-signatures.mjs` are from SovereignWebsite/SovereignWebsite__IaC (from AgentiCCells/AgentiCCells__Site__Factory and PrompTugal__News__Cyber, Apache-2.0), with no known exceptions listed. `build/abp.mjs` is SovereignWebsite__IaC's without its transfer and outside-collaborator rules. Code Apache-2.0; text CC BY 4.0.
