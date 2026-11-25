// The Agent Behaviour Policy check. Node built-ins only.
// From SovereignWebsite/SovereignWebsite__IaC build/abp.mjs (Apache-2.0), without its transfer and outside-collaborator rules.
// Usage:
//   node build/abp.mjs validate                 the policy file is well formed
//   node build/abp.mjs actions <plan.json>      every action in a plan is allowed for its pipeline
//   node build/abp.mjs paths <base> <head>      every commit in base..head changes only paths its Agent: may change
// Exit 1 on any refusal, with the reason. Prints no secret.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const load = (file = 'policy/abp.json') => JSON.parse(readFileSync(file, 'utf8'));

export function glob(pattern, path) {
  const re = new RegExp('^' + pattern.split('**').map((p) => p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
  return re.test(path);
}

export function validate(p) {
  const e = [];
  if (p.version !== 1) e.push('version must be 1');
  if (!p.agents || typeof p.agents !== 'object') e.push('agents missing');
  for (const [a, v] of Object.entries(p.agents || {})) {
    if (!/^[a-z0-9.-]+@[A-Za-z0-9.-]+$/.test(a)) e.push(`agent name ${a} is not agent@Project.owner`);
    if (!Array.isArray(v.may_change) || !v.may_change.length) e.push(`${a}: may_change missing`);
    if ((v.branches || []).includes('main')) e.push(`${a}: no agent may push to main`);
  }
  for (const [n, v] of Object.entries(p.pipelines || {})) {
    if (!Array.isArray(v.allowed)) e.push(`pipeline ${n}: allowed missing`);
    const both = (v.allowed || []).filter((x) => (v.refused_always || []).includes(x));
    if (both.length) e.push(`pipeline ${n}: ${both.join(', ')} both allowed and refused`);
  }
  for (const pr of p.privileges || []) if (!pr.holder || !pr.permission || !pr.why) e.push('each privilege needs holder, permission and why');
  return e;
}

export function checkActions(p, plan) {
  const e = [], pipe = p.pipelines?.[plan.pipeline];
  if (!pipe) return [`pipeline ${plan.pipeline} is not in the policy`];
  for (const a of plan.actions || []) {
    if ((pipe.refused_always || []).includes(a.action)) e.push(`${a.action} on ${a.target}: refused always for ${plan.pipeline}`);
    else if (!pipe.allowed.includes(a.action)) e.push(`${a.action} on ${a.target}: not allowed for ${plan.pipeline}`);
  }
  return e;
}

export function checkPaths(p, { base, head = 'HEAD', cwd = process.cwd() }) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  const e = [];
  const commits = git('rev-list', '--no-merges', `${base}..${head}`).split('\n').filter(Boolean);
  for (const c of commits) {
    const agent = git('log', '-1', '--format=%(trailers:key=Agent,valueonly)', c).split('\n').map((s) => s.trim()).filter(Boolean)[0];
    const rule = agent && p.agents[agent];
    const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', c).split('\n').filter(Boolean);
    // team/keys.json follows the keys rule (keysChange), whoever the agent is: an agent publishes its own key when it starts.
    if (files.includes('team/keys.json')) {
      const session = git('log', '-1', '--format=%(trailers:key=Claude-Session,valueonly)', c).split('\n').map((s) => s.trim()).filter(Boolean)[0];
      const canRetireOthers = !!rule && rule.may_change.some((g) => glob(g, 'team/keys.json'));
      for (const x of keysChange({ agent, session, before: show(git, `${c}^`, 'team/keys.json'), after: show(git, c, 'team/keys.json'), canRetireOthers }).errors) e.push(`${c.slice(0, 7)}: ${x}`);
    }
    const rest = files.filter((f) => f !== 'team/keys.json');
    if (!rule) { if (rest.length || !agent) e.push(`${c.slice(0, 7)}: Agent ${agent || 'none'} is not in the policy`); continue; }
    for (const f of rest)
      if (!rule.may_change.some((g) => glob(g, f))) e.push(`${c.slice(0, 7)}: ${agent} may not change ${f}`);
  }
  return { errors: e, checked: commits.length };
}

const show = (git, rev, f) => { try { return git('show', `${rev}:${f}`); } catch { return '{}'; } };

// The keys rule (policy/abp.json keys_rule). What one commit, made by `agent` in `session`, may change in team/keys.json:
//   - add exactly one entry: its own (agent and session as the commit's trailers), active, with a signing key, and only when
//     no live entry already has that agent name (one live key per name; a second session of a role takes its own name);
//   - retire its own entry (status to "retired", optionally adding "retired" and "retired_note"); an agent whose policy
//     entry lists team/keys.json (a conductor) may also retire another agent's entry the same way;
//   - nothing else: no entry removed, no key, name or session edited, no other agent's key added, the rest of the file unchanged.
// Returns { errors, added }: added is the new entry, which build/check-signatures.mjs then verifies the commit against.
const LIVE = (k) => k.status !== 'superseded' && k.status !== 'retired';
const RETIRE_FIELDS = new Set(['status', 'retired', 'retired_note']);
export function keysChange({ agent, session, before, after, canRetireOthers = false }) {
  const parse = (t) => { try { const d = JSON.parse(t); return Array.isArray(d) ? { keys: d } : d; } catch { return null; } };
  const b = parse(before) || { keys: [] }, a = parse(after);
  if (!a) return { errors: ['team/keys.json is not valid JSON'], added: null };
  const e = [], bk = b.keys || [], ak = a.keys || [];
  const id = (k) => k.id || `${k.agent}#${k.signing_fingerprint || k.fingerprint}`;
  const { keys: _b, ...bRest } = b, { keys: _a, ...aRest } = a;
  if (JSON.stringify(bRest) !== JSON.stringify(aRest)) e.push('team/keys.json: only its keys may change');
  const ids = ak.map(id);
  if (new Set(ids).size !== ids.length) e.push('team/keys.json: two entries share an id');
  const bm = new Map(bk.map((k) => [id(k), k])), am = new Map(ak.map((k) => [id(k), k]));
  for (const [i, k] of bm) if (!am.has(i)) e.push(`team/keys.json: ${i} (${k.agent}) removed; entries are retired, never removed`);
  for (const [i, k] of bm) {
    const n = am.get(i);
    if (!n || JSON.stringify(n) === JSON.stringify(k)) continue;
    const keysOf = (o) => Object.keys(o).filter((x) => !RETIRE_FIELDS.has(x));
    const same = keysOf(k).length === keysOf(n).length && keysOf(k).every((x) => JSON.stringify(k[x]) === JSON.stringify(n[x]));
    const retire = same && LIVE(k) && n.status === 'retired';
    if (!retire) e.push(`team/keys.json: ${i} (${k.agent}) changed; the only change allowed is retiring it`);
    else if (k.agent !== agent && !canRetireOthers) e.push(`team/keys.json: ${agent} may not retire ${k.agent}'s key (its own, or a conductor's call)`);
  }
  const added = ak.filter((k) => !bm.has(id(k)));
  if (added.length > 1) e.push(`team/keys.json: ${added.length} keys added; a commit adds at most one, its own`);
  for (const k of added) {
    if (k.agent !== agent) { e.push(`team/keys.json: adds a key for ${k.agent}; each agent publishes its own (Agent: ${agent || 'none'})`); continue; }
    if (!session || k.session !== session) e.push(`team/keys.json: ${agent}'s new key names session ${k.session || 'none'}, the commit says ${session || 'none'}`);
    if (k.status !== 'active') e.push(`team/keys.json: ${agent}'s new key must be active`);
    if (!(k.bundle?.sign || k.public_key?.sign)) e.push(`team/keys.json: ${agent}'s new key has no signing key (bundle.sign)`);
    if (bk.some((x) => x.agent === agent && LIVE(x))) e.push(`team/keys.json: ${agent} already has a live key; a second session of a role takes its own name (<role>.<label>.<account>@...)`);
  }
  return { errors: e, added: added.length === 1 && added[0].agent === agent ? added[0] : null };
}

// org/repos.json against the rules: every repository public with dev as default branch, no name twice.
export function validateRepos(org) {
  const e = [], seen = new Set();
  if (org.defaults?.default_branch !== "dev") e.push("defaults.default_branch must be dev");
  for (const r of org.repos || []) {
    const w = { ...org.defaults, ...r };
    if (!/^PrompTugal__[A-Za-z0-9_.-]+$/.test(r.name || "")) e.push(`${r.name}: name must start PrompTugal__`);
    if (seen.has(r.name)) e.push(`${r.name}: listed twice`); seen.add(r.name);
    if (w.default_branch !== "dev") e.push(`${r.name}: default branch must be dev`);
    if (w.visibility !== "public") e.push(`${r.name}: visibility must be public (making private is refused)`);
  }
  return e;
}

export function needsDinis(p, files) {
  const pats = new Set(Object.values(p.agents).flatMap((a) => a.needs_dinis_merge || []));
  return files.filter((f) => [...pats].some((g) => glob(g, f)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, x, y] = process.argv.slice(2), p = load();
  let errs = validate(p);
  if (!errs.length && (!cmd || cmd === "validate")) errs = validateRepos(JSON.parse(readFileSync("org/repos.json", "utf8")));
  if (!errs.length && cmd === 'actions') errs = checkActions(p, JSON.parse(readFileSync(x, 'utf8')));
  if (!errs.length && cmd === 'paths') errs = checkPaths(p, { base: x, head: y || 'HEAD' }).errors;
  if (errs.length) { console.error(errs.join('\n')); console.error(`ABP REFUSED (${errs.length})`); process.exit(1); }
  console.log(`ABP OK (${cmd || 'validate'})`);
}
