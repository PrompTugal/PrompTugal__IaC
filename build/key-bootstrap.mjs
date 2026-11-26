// Key bootstrap for the section repositories (policy/key-bootstrap.json). Node built-ins, git and ssh-keygen only.
// Usage (in the key-bootstrap workflow):
//   node build/key-bootstrap.mjs plan <security-home-dir> <out.json>    read-only; GH_TOKEN: read token
//   node build/key-bootstrap.mjs merge <plan.json>                       GH_TOKEN: pull requests, contents, workflows write, one repository
//   node build/key-bootstrap.mjs anchor <plan.json>                      GH_TOKEN: variables write, one repository
//   node build/key-bootstrap.mjs cleanup <repo>                          GH_TOKEN: actions read + variables write, that one repository
// Acts on at most one repository per run. Every refusal names its reason. Prints no secret.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gh } from './github.mjs';

export const loadPolicy = (f = 'policy/key-bootstrap.json') => JSON.parse(readFileSync(f, 'utf8'));
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const ORG = 'PrompTugal';

// A detached SSH signature over a file, checked against one key and the policy's namespace.
export function verifySig(file, sig, principal, pubkey, namespace) {
  if (!existsSync(file) || !existsSync(sig)) return false;
  const dir = mkdtempSync(join(tmpdir(), 'kb-'));
  try {
    const allowed = join(dir, 'allowed'); writeFileSync(allowed, `${principal} namespaces="${namespace}" ${pubkey}\n`);
    const r = spawnSync('ssh-keygen', ['-Y', 'verify', '-f', allowed, '-I', principal, '-n', namespace, '-s', sig], { input: readFileSync(file) });
    return r.status === 0;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The approver key in force: the pinned key, then each successor statement signed by the key before it.
export function approverKey(policy, home) {
  let key = policy.approver.ssh_public_key, agent = policy.approver.agent;
  for (let n = 1; ; n++) {
    const f = join(home, 'successors', `${n}.json`);
    if (!existsSync(f)) break;
    if (!verifySig(f, `${f}.sig`, agent, key, policy.approver.namespace)) return { error: `successor ${n} is not signed by the approver key in force; the chain stops at ${n - 1}`, key, agent };
    const s = JSON.parse(readFileSync(f, 'utf8'));
    if (!s.ssh_public_key || !s.agent) return { error: `successor ${n} names no key or agent`, key, agent };
    key = s.ssh_public_key; agent = s.agent;
  }
  return { key, agent };
}

// pages.yml: only the pinned lines added, nothing removed.
export function checkPagesPatch(patch, block) {
  const e = [], added = [], removed = [];
  for (const l of String(patch || '').split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) added.push(l.slice(1).trim()); else if (l.startsWith('-')) removed.push(l.slice(1));
  }
  if (removed.length) e.push(`pages.yml: ${removed.length} line(s) removed; only the pinned block may be added`);
  const want = block.lines.map((x) => x.trim());
  if (added.length !== want.length || added.some((x, i) => x !== want[i])) e.push('pages.yml: the added lines are not exactly the pinned block');
  return e;
}

// team/keys.json: one new active entry for the agent, with its home key; earlier entries of its role may only be superseded.
export function checkKeys(before, after, { agent, session, homeKey }) {
  const e = [], parse = (t) => { const d = JSON.parse(t || '{"keys":[]}'); return Array.isArray(d) ? { keys: d } : d; };
  let b, a; try { b = parse(before); a = parse(after); } catch { return ['team/keys.json is not valid JSON']; }
  const { keys: bk = [], ...bRest } = b, { keys: ak = [], ...aRest } = a;
  if (JSON.stringify(bRest) !== JSON.stringify(aRest)) e.push('team/keys.json: only its keys may change');
  const role = (x) => String(x || '').split('@')[0].replace(/^cl-\d+\./, '').replace(/\.[a-z]$/, '');
  if (ak.length !== bk.length + 1) e.push(`team/keys.json: ${ak.length - bk.length} entries added; exactly one`);
  for (let i = 0; i < bk.length; i++) {
    const o = bk[i], n = ak[i];
    if (!n) { e.push('team/keys.json: an entry was removed'); continue; }
    if (JSON.stringify(o) === JSON.stringify(n)) continue;
    const { status: _s, superseded: _t, ...oRest } = o, { status: ns, superseded: nt, ...nRest } = n;
    if (JSON.stringify(oRest) !== JSON.stringify(nRest) || ns !== 'superseded' || !nt) e.push(`team/keys.json: entry ${i} changed beyond status superseded with a time`);
    else if (role(o.agent) !== role(agent)) e.push(`team/keys.json: entry ${i} (${o.agent}) is not of ${agent}'s role`);
  }
  const k = ak[ak.length - 1] || {};
  if (k.agent !== agent) e.push(`team/keys.json: the new entry is for ${k.agent || 'nobody'}, not ${agent}`);
  if (k.status !== 'active') e.push('team/keys.json: the new entry is not active');
  if (session && (k.session || k.claude_session) !== session) e.push('team/keys.json: the new entry names another session');
  const norm = (x) => String(x || '').trim().split(/\s+/).slice(0, 2).join(' ');
  if (!homeKey || norm(k.ssh_public_key) !== norm(homeKey)) e.push("team/keys.json: the new key is not the ssh_ed25519 the agent's home publishes");
  if (!/^ssh-ed25519 /.test(norm(k.ssh_public_key))) e.push('team/keys.json: the new key is not ssh-ed25519');
  return e;
}

// The files a pull request may touch, for one repository.
export function checkFiles(files, policy, repo) {
  const e = [], gate = Object.fromEntries((policy.gate_changes[repo] || []).map((g) => [g.file, g]));
  for (const f of files) {
    if (f.filename === 'team/keys.json') continue;
    if (f.filename === policy.pages_block.file) { e.push(...checkPagesPatch(f.patch, policy.pages_block)); continue; }
    const g = gate[f.filename];
    if (!g) { e.push(`${f.filename}: not a file this policy lets the pull request change`); continue; }
    if (!g.sha256) e.push(`${f.filename}: its pinned sha256 is not set yet in the policy`);
    else if (f.content_sha256 !== g.sha256) e.push(`${f.filename}: content does not match the pinned sha256`);
  }
  if (!files.some((f) => f.filename === 'team/keys.json')) e.push('team/keys.json: not changed; the pull request must add the key');
  return e;
}

// The gate status for a head: untouched gate paths pass; touched ones pass only with an approval of that SHA.
export function gateState(changed, approved, paths) {
  const re = paths.map((p) => new RegExp('^' + p.split('**').map((q) => q.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$'));
  const touched = changed.filter((f) => re.some((r) => r.test(f)));
  if (!touched.length) return { state: 'success', description: 'gate paths untouched' };
  return approved ? { state: 'success', description: 'gate paths changed with cl-6.security approval of this SHA' } : { state: 'failure', description: `gate paths changed without approval: ${touched.slice(0, 3).join(', ')}` };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
async function contentAt(repo, path, ref) {
  const r = await gh('GET', `/repos/${ORG}/${repo}/contents/${path}?ref=${ref}`);
  return r.status === 200 && r.data?.content ? Buffer.from(r.data.content, 'base64').toString('utf8') : null;
}
async function homeKeyOf(agent) {
  // The agent's home: PrompTugal__Agent__<Role>, file site/keys/<name>.json on dev, field ssh_ed25519. Public, read without a token.
  const name = agent.split('@')[0], role = name.replace(/^cl-\d+\./, '');
  const home = `PrompTugal__Agent__${role.split(/[-.]/).map((w) => w[0].toUpperCase() + w.slice(1)).join('-')}`;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${ORG}/${home}/dev/site/keys/${name}.json`);
    return { home, key: r.ok ? (await r.json()).ssh_ed25519 || null : null };
  } catch { return { home, key: null }; }
}

async function plan(homeDir) {
  const policy = loadPolicy(), out = { pipeline: 'key-bootstrap', items: [], action: null };
  const ap = approverKey(policy, homeDir);
  if (ap.error) { out.items.push({ refused: ap.error }); return out; }
  for (const repo of policy.repositories) {
    const dir = join(homeDir, 'approvals', 'key-bootstrap', repo);
    if (!existsSync(dir)) continue;
    for (const name of execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter((n) => /^\d+\.json$/.test(n))) {
      const file = join(dir, name), item = { repo, pr: Number(name.replace('.json', '')), errors: [] };
      out.items.push(item);
      if (!verifySig(file, `${file}.sig`, ap.agent, ap.key, policy.approver.namespace)) { item.errors.push('approval signature does not verify against the approver key in force'); continue; }
      const a = JSON.parse(readFileSync(file, 'utf8'));
      if (a.repository !== repo || Number(a.pull_request) !== item.pr) item.errors.push('approval names another repository or pull request');
      const pr = await gh('GET', `/repos/${ORG}/${repo}/pulls/${item.pr}`);
      if (pr.status !== 200) { item.errors.push(`pull request: HTTP ${pr.status}`); continue; }
      if (pr.data.merged) { item.done = 'already merged'; continue; }
      if (pr.data.state !== 'open') item.errors.push('pull request is not open');
      if (pr.data.base.ref !== 'dev') item.errors.push('pull request is not into dev');
      if (pr.data.head.sha !== a.head_sha) item.errors.push('head SHA differs from the approved one (a push after approval voids it)');
      const diff = await gh('GET', `/repos/${ORG}/${repo}/pulls/${item.pr}`, undefined, undefined, 'application/vnd.github.diff');
      if (sha256(typeof diff.data === 'string' ? diff.data : '') !== a.diff_sha256) item.errors.push('diff sha256 differs from the approved one');
      const files = (await gh('GET', `/repos/${ORG}/${repo}/pulls/${item.pr}/files?per_page=100`)).data || [];
      for (const f of files) if ((policy.gate_changes[repo] || []).some((g) => g.file === f.filename)) { const t = await contentAt(repo, f.filename, a.head_sha); f.content_sha256 = t == null ? null : sha256(t); }
      item.errors.push(...checkFiles(files, policy, repo));
      const { key: homeKey, home } = await homeKeyOf(a.agent || '');
      item.errors.push(...checkKeys(await contentAt(repo, 'team/keys.json', pr.data.base.sha), await contentAt(repo, 'team/keys.json', a.head_sha), { agent: a.agent, session: a.session, homeKey }));
      // The head commit: signed by the new key, with the agent's trailers.
      const w = mkdtempSync(join(tmpdir(), 'kbc-'));
      try {
        git(w, 'init', '-q'); git(w, 'fetch', '-q', '--depth=1', `https://github.com/${ORG}/${repo}.git`, a.head_sha);
        const allowed = join(w, 'allowed'); writeFileSync(allowed, `${a.agent} namespaces="git" ${homeKey || 'none'}\n`);
        const v = spawnSync('git', ['-c', 'gpg.format=ssh', '-c', `gpg.ssh.allowedSignersFile=${allowed}`, 'verify-commit', a.head_sha], { cwd: w, encoding: 'utf8' });
        if (v.status !== 0) item.errors.push(`head commit is not signed by ${a.agent}'s key from ${home}`);
        const tr = (k) => git(w, 'log', '-1', `--format=%(trailers:key=${k},valueonly)`, a.head_sha).split('\n').filter(Boolean);
        if (tr('Agent').join() !== a.agent) item.errors.push('head commit Agent: trailer is not the agent');
        if (a.session && tr('Claude-Session').join() !== a.session) item.errors.push('head commit Claude-Session: trailer is not the session');
      } catch (x) { item.errors.push(`head commit could not be read: ${x.message.split('\n')[0]}`); } finally { rmSync(w, { recursive: true, force: true }); }
      if (!item.errors.length && !out.action) out.action = { repo, pr: item.pr, head_sha: a.head_sha, agent: a.agent };
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, x, y] = process.argv.slice(2), policy = loadPolicy();
  if (cmd === 'plan') {
    const p = await plan(x); writeFileSync(y, JSON.stringify(p, null, 2));
    console.log(`### Key bootstrap plan\n- action: ${p.action ? `${p.action.repo} #${p.action.pr} at ${p.action.head_sha.slice(0, 12)}` : 'none'}`);
    for (const i of p.items) console.log(`- ${i.repo || ''} ${i.pr ? '#' + i.pr : ''} ${i.done || i.refused || (i.errors.length ? 'refused: ' + i.errors.join('; ') : 'ready')}`);
    console.log(`action_repo=${p.action?.repo || ''}`);
  } else if (cmd === 'merge') {
    const a = JSON.parse(readFileSync(x, 'utf8')).action; if (!a) process.exit(0);
    const r = await gh('PUT', `/repos/${ORG}/${a.repo}/pulls/${a.pr}/merge`, { sha: a.head_sha, merge_method: 'rebase' });
    if (r.status !== 200) { console.error(`merge ${a.repo} #${a.pr}: HTTP ${r.status} ${r.data?.message || ''}`); process.exit(1); }
    writeFileSync(x, JSON.stringify({ ...JSON.parse(readFileSync(x, 'utf8')), merged_sha: r.data.sha }, null, 2));
    console.log(`merged ${a.repo} #${a.pr} at ${a.head_sha.slice(0, 12)} as ${r.data.sha.slice(0, 12)}`);
  } else if (cmd === 'anchor') {
    const p = JSON.parse(readFileSync(x, 'utf8')); if (!p.merged_sha) process.exit(0);
    const v = policy.anchor.variable, body = { name: v, value: p.merged_sha };
    let r = await gh('POST', `/repos/${ORG}/${p.action.repo}/actions/variables`, body);
    if (r.status === 409) r = await gh('PATCH', `/repos/${ORG}/${p.action.repo}/actions/variables/${v}`, body);
    if (![201, 204].includes(r.status)) { console.error(`anchor ${p.action.repo}: HTTP ${r.status}`); process.exit(1); }
    console.log(`${v} set on ${p.action.repo} to ${p.merged_sha.slice(0, 12)}`);
  } else if (cmd === 'cleanup') {
    // One repository: delete the anchor after the first green push run on dev after it was set, or after max_hours.
    const repo = x, v = policy.anchor.variable;
    if (!policy.repositories.includes(repo)) { console.error(`${repo} is not covered`); process.exit(1); }
    const cur = await gh('GET', `/repos/${ORG}/${repo}/actions/variables/${v}`);
    if (cur.status === 404) { console.log(`${repo}: no anchor set`); process.exit(0); }
    if (cur.status !== 200) { console.error(`${repo}: reading ${v}: HTTP ${cur.status}`); process.exit(1); }
    const setAt = new Date(cur.data.updated_at || cur.data.created_at);
    const runs = (await gh('GET', `/repos/${ORG}/${repo}/actions/runs?branch=dev&event=push&per_page=20`)).data?.workflow_runs || [];
    const green = runs.find((r) => r.conclusion === 'success' && new Date(r.created_at) > setAt);
    const old = Date.now() - setAt.getTime() > policy.anchor.max_hours * 3600e3;
    if (!green && !old) { console.log(`${repo}: anchor ${String(cur.data.value).slice(0, 12)} kept (no green run yet, set ${setAt.toISOString()})`); process.exit(0); }
    const r = await gh('DELETE', `/repos/${ORG}/${repo}/actions/variables/${v}`);
    console.log(`${repo}: anchor ${String(cur.data.value).slice(0, 12)} deleted (HTTP ${r.status}): ${green ? `green run ${green.id}` : `${policy.anchor.max_hours} hours passed`}`);
    if (r.status !== 204) process.exitCode = 1;
  } else { console.error('usage: plan | merge | anchor | cleanup'); process.exit(2); }
}
