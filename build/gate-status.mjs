// The App's gate status (policy/key-bootstrap.json gate_status) on the heads of the covered section repositories.
// Usage: node build/gate-status.mjs plan <security-home-dir> <out.json>   GH_TOKEN: read token for the covered repositories
//        node build/gate-status.mjs post <plan.json> <repo>               GH_TOKEN: statuses write, that one repository
// A head that leaves .github/**, scripts/check-*.mjs and team/keys.json untouched passes; one that touches them passes
// only with cl-6.security's signed approval of that SHA (approvals/gate/<repo>/<sha>.json + .sig in its home).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gh } from './github.mjs';
import { loadPolicy, approverKey, verifySig, gateState } from './key-bootstrap.mjs';

const ORG = 'PrompTugal';

async function plan(home) {
  const policy = loadPolicy(), g = policy.gate_status, out = { statuses: [] };
  const ap = approverKey(policy, home);
  for (const repo of policy.repositories) {
    const br = await gh('GET', `/repos/${ORG}/${repo}/branches?per_page=100`);
    if (br.status !== 200) { out.statuses.push({ repo, error: `branches: HTTP ${br.status}` }); continue; }
    for (const b of br.data.filter((x) => x.name === 'dev' || x.name.startsWith('work/'))) {
      const sha = b.commit.sha;
      const have = await gh('GET', `/repos/${ORG}/${repo}/commits/${sha}/status`);
      if ((have.data?.statuses || []).some((s) => s.context === g.context)) continue;
      // Files the head adds over dev (for dev itself: its own commit).
      const cmp = b.name === 'dev' ? await gh('GET', `/repos/${ORG}/${repo}/commits/${sha}`) : await gh('GET', `/repos/${ORG}/${repo}/compare/dev...${sha}`);
      const files = (cmp.data?.files || []).map((f) => f.filename);
      const f = join(home, 'approvals', 'gate', repo, `${sha}.json`);
      const approved = !ap.error && verifySig(f, `${f}.sig`, ap.agent, ap.key, policy.approver.namespace) && JSON.parse(readFileSync(f, 'utf8')).head_sha === sha;
      out.statuses.push({ repo, branch: b.name, sha, ...gateState(files, approved, g.paths) });
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, x, y] = process.argv.slice(2);
  if (cmd === 'plan') {
    const p = await plan(x); writeFileSync(y, JSON.stringify(p, null, 2));
    console.log(`### Gate status plan (${p.statuses.length} heads without a status)`);
    for (const s of p.statuses) console.log(`- ${s.repo} ${s.branch || ''} ${s.sha ? s.sha.slice(0, 12) : ''} ${s.error || `${s.state}: ${s.description}`}`);
    console.log(`repos=${[...new Set(p.statuses.filter((s) => s.sha).map((s) => s.repo))].join(',')}`);
  } else if (cmd === 'post') {
    const ctx = loadPolicy().gate_status.context;
    for (const s of JSON.parse(readFileSync(x, 'utf8')).statuses.filter((z) => z.repo === y && z.sha)) {
      const r = await gh('POST', `/repos/${ORG}/${y}/statuses/${s.sha}`, { state: s.state, context: ctx, description: s.description.slice(0, 140) });
      console.log(`${y} ${s.branch} ${s.sha.slice(0, 12)}: ${s.state} (HTTP ${r.status})`);
      if (r.status !== 201) process.exitCode = 1;
    }
  } else { console.error('usage: plan | post'); process.exit(2); }
}
