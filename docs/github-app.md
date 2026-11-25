# The GitHub App for PrompTugal__IaC

Status, 25 Nov 2026: PrompTugal already has the App **agenticcells-site-factory** (SovereignWebsite__IaC's), so PrompTugal__IaC uses it; no new App. Each token it mints asks only for the three permissions below.

## 1. The App
agenticcells-site-factory, on the PrompTugal organisation. Its settings page (Developer settings, GitHub Apps) shows its App ID and has "Generate a private key".

It must hold at least these repository permissions, each listed with its reason in `policy/abp.json` (privileges):
- Metadata: read
- Administration: read and write
- Contents: read and write

## 2. Its PrompTugal installation
PrompTugal Settings, GitHub Apps, agenticcells-site-factory, Configure: Repository access **All repositories** (so Org apply can create new ones and see every existing one).

## 3. The apply environment (PrompTugal__IaC, Settings, Environments)
- Name: `apply`; deployment branches: `dev` only.
- Variable `PT_IAC_APP_ID`: the App's ID.
- Secret `PT_IAC_APP_PRIVATE_KEY`: a **new** private key generated for the App, pasted there only (not SovereignWebsite__IaC's, so either can be revoked alone). It is never sent to an agent.

## 4. Check
Run **Check GitHub App** by hand: it lists the repositories the App sees (all 22). Then **Org apply** by hand: on today's organisation it plans nothing.
