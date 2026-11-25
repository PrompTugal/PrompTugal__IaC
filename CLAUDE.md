# PrompTugal__IaC: for agents

- Only agents in `policy/abp.json` commit here, each signed with its key in `team/keys.json`, with `Agent:` and `Claude-Session:` trailers.
- dev only; never main. Changes to `policy/`, `.github/` and `build/` go as pull requests Dinis merges.
- Never print, commit or read a private key or token. No agent holds the App's key or an AWS credential.
- Before committing: `node test/run.mjs && node build/abp.mjs validate && node build/leak-scan.mjs`.
