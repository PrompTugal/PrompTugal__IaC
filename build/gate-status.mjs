// The App's gate status (policy/key-bootstrap.json gate_status) on the heads of the covered section repositories.
// Usage: node build/gate-status.mjs plan <security-home-dir> <out.json>   GH_TOKEN: read token for the covered repositories (incl. actions read)
//        node build/gate-status.mjs repos <plan.json>                     the repositories to post to, validated
//        node build/gate-status.mjs post <plan.json> <repo>               GH_TOKEN: statuses write, that one repository
// A head that leaves .github/**, scripts/check-*.mjs and team/keys.json untouched passes; one that touches them passes
// only with cl-6.security's signed approval of that SHA (approvals/gate/<repo>/<sha>.json + .sig in its home).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gh } from './github.mjs';
import { loadPolicy, approverKey, verifySig, gateState, lastAnchor } from './key-bootstrap.mjs';

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
      // dev: every commit from the repository's anchor A to the head; work/*: from dev to the head. Fail closed when A is
      // unknown or the list may be cut (B5).
      let base = 'dev';
      if (b.name === 'dev') {
        const A = await lastAnchor(policy, repo);
        if (!A.sha) { out.statuses.push({ repo, branch: b.name, sha, state: 'failure', description: `no verified anchor: ${A.why}`.slice(0, 140) }); continue; }
        if (A.sha === sha) { out.statuses.push({ repo, branch: b.name, sha, state: 'success', description: 'dev head is the verified anchor' }); continue; }
        base = A.sha;
      }
      const cmp = await gh('GET', `/repos/${ORG}/${repo}/compare/${base}...${sha}?per_page=100`);
      if (cmp.status !== 200) { out.statuses.push({ repo, branch: b.name, sha, state: 'failure', description: `compare: HTTP ${cmp.status}` }); continue; }
      const files = (cmp.data.files || []).map((f) => f.filename);
      const truncated = files.length >= 300 || (cmp.data.total_commits || 0) > (cmp.data.commits || []).length;
      const f = join(home, 'approvals', 'gate', repo, `${sha}.json`);
      const approved = !ap.error && verifySig(f, `${f}.sig`, ap.agent, ap.key, policy.approver.namespace) && JSON.parse(readFileSync(f, 'utf8')).head_sha === sha;
      out.statuses.push({ repo, branch: b.name, sha, ...gateState(files, approved, g.paths, truncated) });
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

  } else if (cmd === 'repos') {
    // The repositories to post to, from plan.json only, each one the policy covers (B7).
    const cover = loadPolicy().repositories;
    process.stdout.write(JSON.stringify([...new Set(JSON.parse(readFileSync(x, 'utf8')).statuses.filter((s) => s.sha && cover.includes(s.repo)).map((s) => s.repo))]));
  } else if (cmd === 'post') {
    const ctx = loadPolicy().gate_status.context;
    for (const s of JSON.parse(readFileSync(x, 'utf8')).statuses.filter((z) => z.repo === y && z.sha)) {
      const r = await gh('POST', `/repos/${ORG}/${y}/statuses/${s.sha}`, { state: s.state, context: ctx, description: s.description.slice(0, 140) });
      console.log(`${y} ${s.branch} ${s.sha.slice(0, 12)}: ${s.state} (HTTP ${r.status})`);
      if (r.status !== 201) process.exitCode = 1;
    }
  } else { console.error('usage: plan | post'); process.exit(2); }
}
