// The App's gate status (policy/key-bootstrap.json gate_status) on the heads of the covered section repositories.
// Usage: node build/gate-status.mjs plan <security-home-dir> <out.json>   GH_TOKEN: read token for the covered repositories (incl. actions read)
//        node build/gate-status.mjs repos <plan.json>                     the repositories to post to, validated
//        node build/gate-status.mjs post <plan.json> <repo>               GH_TOKEN: statuses write, that one repository
//        node build/gate-status.mjs advance <plan.json> <repo>            GH_TOKEN: contents write, that one repository
// Advance (cl-6.decisions, 27 Nov 2026): agents push work/<agent> only and never dev. When a work/** head is success and a
// strict fast-forward of dev, the App moves dev to it (force false); a failure leaves dev alone and creates the tag
// gate/<agent>/<sha12>-fail, so the agent reads either outcome with git ls-remote and needs no API.
// A head that leaves .github/**, scripts/check-*.mjs and team/keys.json untouched passes; one that touches them passes
// only with cl-6.security's signed approval of that SHA (approvals/gate/<repo>/<sha>.json + .sig in its home).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gh } from './github.mjs';
import { loadPolicy, approverKey, verifySig, gateState, lastAnchor } from './key-bootstrap.mjs';

const ORG = 'PrompTugal';

// The App's own gate status on a commit (R1, cl-6.security 27 Nov): only statuses created by the App's bot account count,
// matched on login, id and type together, and the newest of those wins (N1). statuses: the list endpoint's entries.
export function appStatus(statuses, context, bot) {
  const mine = (statuses || []).filter((s) => s.context === context && s.creator && s.creator.type === 'Bot'
    && s.creator.login === bot.login && Number(s.creator.id) === Number(bot.id));
  mine.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return mine[0] || null;
}
const statusesOf = async (repo, sha) => (await gh('GET', `/repos/${ORG}/${repo}/commits/${sha}/statuses?per_page=100`)).data;

// What the App does with a work/** head once its state is known (pure, for the tests). cmp is the compare of dev...head.
export function advanceDecision({ branch, sha, state, dev, cmp }) {
  if (!branch || !branch.startsWith('work/') || !sha || !dev) return null;
  const agent = branch.slice(5);
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(agent)) return null;
  if (state === 'failure') return { kind: 'fail_tag', agent, sha, tag: `gate/${agent}/${sha.slice(0, 12)}-fail` };
  if (state !== 'success' || sha === dev) return null;
  // strict fast-forward only: dev is an ancestor of the head, and the head is not behind dev
  if (!cmp || cmp.status !== 'ahead' || cmp.behind_by !== 0 || !(cmp.ahead_by > 0)) return null;
  return { kind: 'advance', agent, sha, from: dev };
}

async function plan(home) {
  const policy = loadPolicy(), g = policy.gate_status, out = { statuses: [] };
  const ap = approverKey(policy, home);
  for (const repo of policy.repositories) {
    const br = await gh('GET', `/repos/${ORG}/${repo}/branches?per_page=100`);
    if (br.status !== 200) { out.statuses.push({ repo, error: `branches: HTTP ${br.status}` }); continue; }
    const heads = br.data.filter((x) => x.name === 'dev' || x.name.startsWith('work/'));
    const dev = heads.find((x) => x.name === 'dev')?.commit?.sha || null;
    for (const b of heads) {
      const sha = b.commit.sha;
      const posted = appStatus(await statusesOf(repo, sha), g.context, g.app_bot);
      if (posted) {
        // already judged: a work/** head may still need advancing (or its fail tag) if an earlier run posted it
        if (b.name.startsWith('work/') && ['success', 'failure'].includes(posted.state)) {
          const cmp = posted.state === 'success' ? (await gh('GET', `/repos/${ORG}/${repo}/compare/${dev}...${sha}?per_page=1`)).data : null;
          const d = advanceDecision({ branch: b.name, sha, state: posted.state, dev, cmp });
          if (d) (out.moves ||= []).push({ repo, ...d });
        }
        continue;
      }
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
      const st = { repo, branch: b.name, sha, ...gateState(files, approved, g.paths, truncated) };
      out.statuses.push(st);
      if (b.name.startsWith('work/')) { const d = advanceDecision({ branch: b.name, sha, state: st.state, dev, cmp: cmp.data }); if (d) (out.moves ||= []).push({ repo, ...d }); }
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
    for (const m of p.moves || []) console.log(`- ${m.repo} work/${m.agent} ${m.sha.slice(0, 12)}: ${m.kind === 'advance' ? 'advance dev' : `tag ${m.tag}`}`);

  } else if (cmd === 'repos') {
    // The repositories to post to, from plan.json only, each one the policy covers (B7).
    const cover = loadPolicy().repositories;
    const pj = JSON.parse(readFileSync(x, 'utf8'));
    process.stdout.write(JSON.stringify([...new Set([...pj.statuses.filter((s) => s.sha), ...(pj.moves || [])].map((s) => s.repo).filter((r) => cover.includes(r)))]));
  } else if (cmd === 'post') {
    const ctx = loadPolicy().gate_status.context;
    for (const s of JSON.parse(readFileSync(x, 'utf8')).statuses.filter((z) => z.repo === y && z.sha)) {
      const r = await gh('POST', `/repos/${ORG}/${y}/statuses/${s.sha}`, { state: s.state, context: ctx, description: s.description.slice(0, 140) });
      console.log(`${y} ${s.branch} ${s.sha.slice(0, 12)}: ${s.state} (HTTP ${r.status})`);
      if (r.status !== 201) process.exitCode = 1;
    }
  } else if (cmd === 'advance') {
    const g = loadPolicy().gate_status;
    for (const m of (JSON.parse(readFileSync(x, 'utf8')).moves || []).filter((z) => z.repo === y)) {
      if (m.kind === 'fail_tag') {
        const r = await gh('POST', `/repos/${ORG}/${y}/git/refs`, { ref: `refs/tags/${m.tag}`, sha: m.sha });
        console.log(`${y} ${m.tag}: ${r.status === 201 ? 'created' : r.status === 422 ? 'already there' : `HTTP ${r.status}`}`);
        if (![201, 422].includes(r.status)) process.exitCode = 1;
        continue;
      }
      // re-read just before moving: dev must still be where the plan saw it, and the head must still carry success
      const now = (await gh('GET', `/repos/${ORG}/${y}/branches/dev`)).data?.commit?.sha;
      const st = appStatus(await statusesOf(y, m.sha), g.context, g.app_bot)?.state;
      if (now !== m.from || st !== 'success') { console.log(`${y} work/${m.agent} ${m.sha.slice(0, 12)}: not advanced (dev moved or status not success)`); continue; }
      const r = await gh('PATCH', `/repos/${ORG}/${y}/git/refs/heads/dev`, { sha: m.sha, force: false });
      console.log(`${y} dev ${m.from.slice(0, 12)} -> ${m.sha.slice(0, 12)} (work/${m.agent}): ${r.status === 200 ? 'advanced' : `HTTP ${r.status}`}`);
      if (r.status !== 200) process.exitCode = 1;
    }
  } else { console.error('usage: plan | repos | post | advance'); process.exit(2); }
}
