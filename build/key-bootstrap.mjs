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

// team/keys.json: one new entry for the agent in the repository's key format; earlier entries of its role may only be
// marked superseded. keyOf(entry) returns the entry's key as "type base64", or null.
export function entryKey(entry, format) {
  if (format === 'p256-pem') {
    const pem = entry?.git_signing?.pem; if (!pem) return null;
    const dir = mkdtempSync(join(tmpdir(), 'kbk-'));
    try { const f = join(dir, 'k.pem'); writeFileSync(f, String(pem)); return execFileSync('ssh-keygen', ['-i', '-m', 'PKCS8', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/).slice(0, 2).join(' '); }
    catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const k = String(entry?.ssh_public_key || '').trim().split(/\s+/).slice(0, 2).join(' ');
  return /^ssh-ed25519 /.test(k) ? k : null;
}
const norm = (x) => String(x || '').trim().split(/\s+/).slice(0, 2).join(' ');
export function checkKeys(before, after, { agent, session, homeKey, format = 'ed25519' }) {
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
    const strip = ({ status, superseded, ...rest }) => rest;
    const ok = JSON.stringify(strip(o)) === JSON.stringify(strip(n)) && n.superseded && (n.status === undefined || n.status === 'superseded') && (o.status === undefined || n.status !== undefined);
    if (!ok) e.push(`team/keys.json: entry ${i} changed beyond being marked superseded`);
    else if (role(o.agent) !== role(agent)) e.push(`team/keys.json: entry ${i} is not of ${agent}'s role`);
  }
  const k = ak[ak.length - 1] || {};
  if (k.agent !== agent) e.push(`team/keys.json: the new entry is for ${JSON.stringify(k.agent || null)}, not ${agent}`);
  if (k.superseded || (k.status !== undefined && k.status !== 'active')) e.push('team/keys.json: the new entry is not active');
  if (session && (k.session || k.claude_session) !== session) e.push('team/keys.json: the new entry names another session');
  const key = entryKey(k, format);
  if (!key) e.push(`team/keys.json: the new entry has no ${format === 'p256-pem' ? 'git_signing.pem (P-256)' : 'ssh-ed25519 ssh_public_key'}`);
  else if (!homeKey || key !== norm(homeKey)) e.push("team/keys.json: the new key is not the key the agent's home publishes");
  return e;
}

// The files a pull request may touch, for one repository: team/keys.json, and files pinned whole by sha256.
export function checkFiles(files, policy, repo) {
  const e = [], gate = Object.fromEntries((policy.gate_changes[repo] || []).map((g) => [g.file, g]));
  if (files.length >= 300) e.push('the pull request lists 300 or more files: refused (the API may cut the list)');
  for (const f of files) {
    if (f.filename === 'team/keys.json') continue;
    const g = gate[f.filename], q = JSON.stringify(f.filename);
    if (!g) { e.push(`${q}: not a file this policy lets the pull request change`); continue; }
    if (!g.sha256) e.push(`${q}: its whole-file sha256 is not pinned in the policy yet`);
    else if (f.content_sha256 !== g.sha256) e.push(`${q}: content does not match the pinned sha256`);
  }
  if (!files.some((f) => f.filename === 'team/keys.json')) e.push('team/keys.json: not changed; the pull request must add the key');
  return e;
}

// The gate status for a head: untouched gate paths pass; touched ones pass only with an approval of that SHA.
export function gateState(changed, approved, paths, truncated = false) {
  if (truncated || changed.length >= 300) return { state: 'failure', description: '300 or more files in the range: refused (the list may be cut)' };
  const re = paths.map((p) => new RegExp('^' + p.split('**').map((q) => q.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$'));
  const touched = changed.filter((f) => re.some((r) => r.test(f)));
  if (!touched.length) return { state: 'success', description: 'gate paths untouched' };
  return approved ? { state: 'success', description: 'gate paths changed with cl-6.security approval of this SHA' } : { state: 'failure', description: `gate paths changed without approval (${touched.length} files)` };
}

// The repository's last verified anchor, found as its pages.yml finds it: the latest pages.yml push run on dev whose
// anchor_job passed. null when the policy names no anchor_job (refused) or none is found.
export async function lastAnchor(policy, repo) {
  const job = policy.repository_config?.[repo]?.anchor_job;
  if (!job) return { sha: null, why: `the policy names no anchor_job for ${repo}` };
  const runs = (await gh('GET', `/repos/${ORG}/${repo}/actions/workflows/pages.yml/runs?branch=dev&event=push&status=success&per_page=20`)).data?.workflow_runs || [];
  for (const r of runs) {
    if (r.path !== '.github/workflows/pages.yml' || r.head_branch !== 'dev') continue;
    const jobs = (await gh('GET', `/repos/${ORG}/${repo}/actions/runs/${r.id}/jobs?per_page=50`)).data?.jobs || [];
    if (jobs.some((j) => j.name === job && j.conclusion === 'success')) return { sha: r.head_sha, run: r.id, created_at: r.created_at };
  }
  return { sha: null, why: `no pages.yml push run on dev with ${job} passed` };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
async function contentAt(repo, path, ref) {
  const r = await gh('GET', `/repos/${ORG}/${repo}/contents/${path}?ref=${ref}`);
  return r.status === 200 && r.data?.content ? Buffer.from(r.data.content, 'base64').toString('utf8') : null;
}
async function homeKeyOf(agent, format = 'ed25519') {
  // The agent's home: PrompTugal__Agent__<Role>, file site/keys/<name>.json on dev, field ssh_ed25519. Public, read without a token.
  const name = agent.split('@')[0], role = name.replace(/^cl-\d+\./, '');
  const home = `PrompTugal__Agent__${role.split(/[-.]/).map((w) => w[0].toUpperCase() + w.slice(1)).join('-')}`;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${ORG}/${home}/dev/site/keys/${name}.json`);
    const j = r.ok ? await r.json() : {};
    return { home, key: (format === 'p256-pem' ? j.ssh : j.ssh_ed25519) || null };
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
      const devHead = (await gh('GET', `/repos/${ORG}/${repo}/branches/dev`)).data?.commit?.sha;
      const A = await lastAnchor(policy, repo);
      if (pr.data.base.sha !== devHead) item.errors.push("the pull request's base is not dev's head");
      if (!A.sha) item.errors.push(`no verified anchor: ${A.why}`);
      else if (devHead !== A.sha) item.errors.push("dev's head is not the last verified anchor: commits on dev are not yet checked");
      const diff = await gh('GET', `/repos/${ORG}/${repo}/pulls/${item.pr}`, undefined, undefined, 'application/vnd.github.diff');
      if (sha256(typeof diff.data === 'string' ? diff.data : '') !== a.diff_sha256) item.errors.push('diff sha256 differs from the approved one');
      const files = (await gh('GET', `/repos/${ORG}/${repo}/pulls/${item.pr}/files?per_page=100`)).data || [];
      for (const f of files) if ((policy.gate_changes[repo] || []).some((g) => g.file === f.filename)) { const t = await contentAt(repo, f.filename, a.head_sha); f.content_sha256 = t == null ? null : sha256(t); }
      item.errors.push(...checkFiles(files, policy, repo));
      const format = policy.repository_config?.[repo]?.key_format || 'ed25519';
      const { key: homeKey, home } = await homeKeyOf(a.agent || '', format);
      item.errors.push(...checkKeys(await contentAt(repo, 'team/keys.json', pr.data.base.sha), await contentAt(repo, 'team/keys.json', a.head_sha), { agent: a.agent, session: a.session, homeKey, format }));
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
      if (!item.errors.length && !out.action) out.action = { repo, pr: item.pr, head_sha: a.head_sha, base_sha: pr.data.base.sha, agent: a.agent };
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, x, y] = process.argv.slice(2), policy = loadPolicy();
  if (cmd === 'plan') {
    const p = await plan(x); writeFileSync(y, JSON.stringify(p, null, 2));
    console.log(`### Key bootstrap plan\n- action: ${p.action ? `${p.action.repo} #${p.action.pr} at ${p.action.head_sha.slice(0, 12)}` : 'none'}`);
    // Errors are printed JSON-escaped, one per line, so no text from a pull request can forge a line of its own.
    for (const i of p.items) console.log(`- ${i.repo || ''} ${i.pr ? '#' + i.pr : ''} ${i.done || i.refused || (i.errors.length ? 'refused: ' + JSON.stringify(i.errors) : 'ready')}`);
  } else if (cmd === 'action-repo') {
    // The repository to act on, from plan.json only, and only if the policy covers it (B7).
    const a = JSON.parse(readFileSync(x, 'utf8')).action;
    const repo = a && policy.repositories.includes(a.repo) && /^PrompTugal__News__[A-Za-z0-9-]+$/.test(a.repo) ? a.repo : '';
    process.stdout.write(repo);
  } else if (cmd === 'merge') {
    const a = JSON.parse(readFileSync(x, 'utf8')).action; if (!a) process.exit(0);
    const r = await gh('PUT', `/repos/${ORG}/${a.repo}/pulls/${a.pr}/merge`, { sha: a.head_sha, merge_method: 'rebase' });
    if (r.status !== 200) { console.error(`merge ${a.repo} #${a.pr}: HTTP ${r.status} ${r.data?.message || ''}`); process.exit(1); }
    // The merged tree must be the approved head's tree, or no anchor is set (B1).
    const t1 = (await gh('GET', `/repos/${ORG}/${a.repo}/git/commits/${r.data.sha}`)).data?.tree?.sha;
    const t2 = (await gh('GET', `/repos/${ORG}/${a.repo}/git/commits/${a.head_sha}`)).data?.tree?.sha;
    const same = !!t1 && t1 === t2;
    writeFileSync(x, JSON.stringify({ ...JSON.parse(readFileSync(x, 'utf8')), merged_sha: same ? r.data.sha : null, merged_tree_mismatch: !same }, null, 2));
    if (!same) { console.error(`merged ${a.repo} #${a.pr}, but its tree is not the approved head's tree: no anchor set; escalate`); process.exit(1); }
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
    const A = await lastAnchor(policy, repo);
    const green = A.sha && new Date(A.created_at) > setAt ? { id: A.run } : null;
    const old = Date.now() - setAt.getTime() > policy.anchor.max_hours * 3600e3;
    if (!green && !old) { console.log(`${repo}: anchor ${String(cur.data.value).slice(0, 12)} kept (no green run yet, set ${setAt.toISOString()})`); process.exit(0); }
    const r = await gh('DELETE', `/repos/${ORG}/${repo}/actions/variables/${v}`);
    console.log(`${repo}: anchor ${String(cur.data.value).slice(0, 12)} deleted (HTTP ${r.status}): ${green ? `green run ${green.id}` : `${policy.anchor.max_hours} hours passed`}`);
    if (r.status !== 204) process.exitCode = 1;
  } else { console.error('usage: plan | merge | anchor | cleanup'); process.exit(2); }
}
