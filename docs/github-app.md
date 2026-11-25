# The GitHub App for PrompTugal__IaC

Status: for Dinis to create, 25 Nov 2026. Written by cl-6.infra@PrompTugal.dinis on the pattern of SovereignWebsite__IaC (its App's ID and key live only in its `apply` environment).

## 1. The App
Owned by the PrompTugal organisation. Name: Dinis's choice (the policy calls it `promptugal-iac` until named). No webhook.

Repository permissions, each listed with its reason in `policy/abp.json` (privileges):
- Metadata: read (required by GitHub)
- Administration: read and write (create repositories, set the default branch to dev, set the settings in org/repos.json)
- Contents: read and write (create the dev branch where one is missing)

Nothing else: no organisation permissions, no members, no workflows, no Pages. Any later addition is a pull request to `policy/abp.json` first.

## 2. Install it
On the PrompTugal organisation, all repositories (so Org apply can create new ones and see every existing one).

## 3. The apply environment (this repository, Settings, Environments)
- Name: `apply`; deployment branches: `dev` only.
- Variable `PT_IAC_APP_ID`: the App's ID.
- Secret `PT_IAC_APP_PRIVATE_KEY`: a private key generated for the App. Paste it there only; it is never sent to an agent.

## 4. Check
Run **Check GitHub App** by hand: it lists the repositories the App sees. Then **Org apply** by hand: on today's organisation it should plan nothing (all 22 repositories already have dev as default branch).
