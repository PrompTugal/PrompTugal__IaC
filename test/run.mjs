// Tests for PrompTugal__IaC. Node built-ins only. Usage: node test/run.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { load, validate, validateRepos, checkActions, glob } from '../build/abp.mjs';
import { plan } from '../build/org-plan.mjs';
import { plan as dnsPlan, validateDns } from '../build/dns-plan.mjs';
import { unclaimed } from '../build/dns-unclaimed.mjs';
import { checkKeys, checkFiles, gateState, entryKey, readPins, pemToSsh, strictFastForward } from '../build/key-bootstrap.mjs';
import { advanceDecision, appStatus } from '../build/gate-status.mjs';
const kb = JSON.parse(readFileSync('policy/key-bootstrap.json', 'utf8'));

let n = 0, failed = 0;
const t = (name, fn) => { n++; try { fn(); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); } };
const policy = load();
const org = JSON.parse(readFileSync('org/repos.json', 'utf8'));
const live = (over = {}) => Object.fromEntries(org.repos.map((r) => [r.name, { name: r.name, description: r.description, default_branch: 'dev', has_dev: true, visibility: 'public', has_pages: !!r.pages_site, cname: r.pages_site ? r.site : null, https_enforced: !!r.pages_site, rulesets: (r.rulesets || []).map((q) => q.name), teams: Object.fromEntries(Object.keys(r.teams || {}).map((t) => [t, 'push'])), ...(over[r.name] || {}) }]));

t('the policy is well formed', () => assert.deepEqual(validate(policy), []));
t('org/repos.json follows the rules', () => assert.deepEqual(validateRepos(org), []));
t('every repository has dev as its default branch', () => { for (const r of org.repos) assert.equal({ ...org.defaults, ...r }.default_branch, 'dev', r.name); });
t('no agent may push to main', () => { for (const a of Object.values(policy.agents)) assert.ok(!(a.branches || []).includes('main')); });
t('policy, .github and build need Dinis', () => { const a = policy.agents['cl-6.infra@PrompTugal.dinis']; for (const f of ['policy/abp.json', '.github/workflows/org-apply.yml', 'build/org-apply.mjs']) assert.ok(a.needs_dinis_merge.some((g) => glob(g, f)), f); });
t('org-apply never deletes, transfers, archives, renames or makes private', () => {
  const pipe = policy.pipelines['org-apply'];
  for (const x of ['repo.delete', 'repo.transfer', 'repo.archive', 'repo.make_private', 'repo.rename']) { assert.ok(pipe.refused_always.includes(x), x); assert.ok(!pipe.allowed.includes(x), x); }
});
t('refused actions are refused', () => {
  for (const action of ['repo.delete', 'repo.transfer', 'repo.archive', 'repo.make_private', 'pages.delete', 'pages.unset_cname']) assert.equal(checkActions(policy, { pipeline: 'org-apply', actions: [{ action, target: 'PrompTugal__X' }] }).length, 1, action);
});
t('an unknown pipeline is refused', () => assert.equal(checkActions(policy, { pipeline: 'aws-apply', actions: [] }).length, 1));
t('the organisation as it is needs nothing', () => { const p = plan(org, live()); assert.deepEqual(p.actions, []); assert.deepEqual(p.unlisted, []); });
t('a missing repository is created with dev as default', () => {
  const l = live(); delete l[org.repos.find((r) => !r.pages_site).name];
  assert.deepEqual(plan(org, l).actions.map((a) => a.action), ['repo.create', 'branch.create_dev', 'repo.set_default_branch']);
});
t('a repository on main gets dev, then dev as default', () => {
  const name = org.repos[0].name, p = plan(org, live({ [name]: { default_branch: 'main', has_dev: false } }));
  assert.deepEqual(p.actions.map((a) => a.action), ['branch.create_dev', 'repo.set_default_branch']);
  assert.equal(p.actions[0].from, 'main');
});
t('a repository not listed is reported, never acted on', () => {
  const l = { ...live(), PrompTugal__Stray: { name: 'PrompTugal__Stray', default_branch: 'main' } }, p = plan(org, l);
  assert.deepEqual(p.unlisted, ['PrompTugal__Stray']); assert.deepEqual(p.actions, []);
});
t('visibility is reported, never changed', () => {
  const name = org.repos[0].name, p = plan(org, live({ [name]: { visibility: 'private' } }));
  assert.deepEqual(p.actions, []); assert.equal(p.notes.length, 1);
});
t('defaults are not forced on existing repositories', () => assert.deepEqual(plan(org, live(Object.fromEntries(org.repos.map((r) => [r.name, { has_wiki: true }])))).actions, []));
t('a dry plan passes the policy', () => assert.deepEqual(checkActions(policy, plan(org, {})), []));

t('every place home names its place and agent', () => { for (const r of org.repos.filter((x) => x.name.startsWith('PrompTugal__Agent__Place__'))) { assert.ok(r.place?.id && r.place?.agent, r.name); assert.match(r.name, /^PrompTugal__Agent__Place__[A-Z][A-Za-z-]*(__[A-Z][A-Za-z-]*)?$/); assert.equal(!!r.place.topic, /^PrompTugal__Agent__Place__[A-Z][A-Za-z-]*__[A-Z]/.test(r.name), r.name); assert.equal(r.site, `${r.place.topic ? r.place.topic + '.' : ''}${r.place.id}.place.agent.promptugal.news`); } });
t('a home with a site gets Pages and its own domain', () => {
  const r = org.repos.find((x) => x.pages_site); const l = live(); l[r.name] = { ...l[r.name], has_pages: false, cname: null };
  const acts = plan(org, l).actions.filter((a) => a.target === r.name);
  assert.deepEqual(acts.map((a) => a.action), ['pages.enable', 'pages.set_cname']); assert.equal(acts[1].cname, r.site);
});
t('every site is under agent.promptugal.news', () => { for (const r of org.repos.filter((x) => x.pages_site)) assert.match(r.site, /^(([a-z0-9-]+\.)?[a-z0-9-]+\.place|[a-z0-9-]+)\.agent\.promptugal\.news$/, r.name); });
t('a home without the agents team gets push, never more', () => {
  const r = org.repos.find((x) => x.teams); const l = live(); l[r.name] = { ...l[r.name], teams: {} };
  const acts = plan(org, l).actions.filter((a) => a.target === r.name);
  assert.deepEqual(acts.map((a) => a.action), ['team.grant_push']); assert.equal(acts[0].team, 'promptugal-news-agents');
  assert.equal(checkActions(policy, { pipeline: 'org-apply', actions: [{ action: 'team.grant_admin', target: r.name }] }).length, 1);
});
t('the agents team never gets push on the News repositories Dinis set aside', () => { for (const n of ['Fringe', 'Swarm', 'Swarm__Runs', 'Storm-Charles']) assert.equal((org.repos.find((r) => r.name === `PrompTugal__News__${n}`) || {}).teams, undefined, n); });
t('every agent home gives the agents team push', () => { for (const r of org.repos.filter((x) => x.name.startsWith('PrompTugal__Agent__') && x.pages_site)) assert.equal((r.teams || {})['promptugal-news-agents'], 'push', r.name); });
t('HTTPS is enforced only once the certificate is approved or issued', () => {
  const r = org.repos.find((x) => x.pages_site); const l = live();
  l[r.name] = { ...l[r.name], https_enforced: false, cert_state: null };
  const N = { nudge: true, now: Date.parse('2026-11-27T12:00:00Z') };
  l[r.name].cname_changed_at = '2026-11-26T11:00:00Z';
  assert.deepEqual(plan(org, l, N).actions.filter((a) => a.target === r.name).map((a) => a.action), ['pages.nudge_certificate']);
  assert.deepEqual(plan(org, l).actions.filter((a) => a.target === r.name), [], 'no nudge unless asked');
  l[r.name].cname_changed_at = '2026-11-27T01:00:00Z';
  assert.deepEqual(plan(org, l, N).actions.filter((a) => a.target === r.name), [], 'no nudge within a day of the last');
  l[r.name].cname_changed_at = null;
  assert.deepEqual(plan(org, l, N).actions.filter((a) => a.target === r.name), [], 'unknown last change counts as recent');
  l[r.name].cert_state = 'authorization_pending';
  let p = plan(org, l); assert.deepEqual(p.actions.filter((a) => a.target === r.name), []); assert.ok(p.notes.some((n) => n.includes(r.site)));
  l[r.name].cert_state = 'issued'; p = plan(org, l);
  assert.deepEqual(p.actions.filter((a) => a.target === r.name).map((a) => a.action), ['pages.enforce_https']);
  assert.deepEqual(checkActions(policy, p), []);
});
t('proposed repositories are never planned', () => { const names = new Set((org.proposed || []).map((r) => r.name)); assert.ok(plan(org, live()).actions.every((a) => !names.has(a.target))); });
t('proposed names follow the rules and are not already listed', () => { const have = new Set(org.repos.map((r) => r.name)); for (const r of org.proposed || []) { assert.match(r.name, /^PrompTugal__Agent__[A-Z][A-Za-z0-9]*$/); assert.ok(!have.has(r.name), r.name); } });

const dns = JSON.parse(readFileSync('org/dns.json', 'utf8'));
const liveDns = dns.records.map((r) => ({ Name: `${r.name}.`, Type: r.type, ResourceRecords: [{ Value: r.value }] }));
t('org/dns.json follows the rules', () => assert.deepEqual(validateDns(dns), []));
t('the apex is never written', () => assert.equal(validateDns({ zone: 'promptugal.news', records: [{ name: 'promptugal.news', type: 'TXT', value: 'x' }] }).length, 1));
t('the zone as it is needs nothing', () => assert.deepEqual(dnsPlan(dns, liveDns).actions, []));
t('a missing record is created, CREATE only', () => { const p = dnsPlan(dns, liveDns.slice(1)); assert.equal(p.actions.length, 1); assert.ok(p.batch.Changes.every((c) => c.Action === 'CREATE')); });
t('a record with another value is reported, never changed', () => { const l = liveDns.map((x, i) => i ? x : { ...x, ResourceRecords: [{ Value: 'elsewhere.example' }] }); const p = dnsPlan(dns, l); assert.deepEqual(p.actions, []); assert.equal(p.notes.length, 1); });
t('dns-apply may only create', () => { const pipe = policy.pipelines['dns-apply']; assert.deepEqual(pipe.allowed, ['route53.create_record']); for (const x of ['route53.delete_record', 'route53.upsert_record']) assert.equal(checkActions(policy, { pipeline: 'dns-apply', actions: [{ action: x, target: 'a' }] }).length, 1); });
t('an unclaimed GitHub Pages name is reported, a claimed one is not', () => {
  const sets = [{ Name: 'a.promptugal.news.', Type: 'CNAME', ResourceRecords: [{ Value: 'promptugal.github.io' }] }, { Name: 'b.promptugal.news.', Type: 'CNAME', ResourceRecords: [{ Value: 'promptugal.github.io.' }] }, { Name: 'promptugal.news.', Type: 'A', ResourceRecords: [{ Value: '185.199.108.153' }] }, { Name: 'c.promptugal.news.', Type: 'CNAME', ResourceRecords: [{ Value: 'elsewhere.example' }] }];
  assert.deepEqual(unclaimed(sets, { 'a.promptugal.news': 'R' }).map((x) => x.name), ['b.promptugal.news', 'promptugal.news']);
});
t('www of a claimed apex is its pair, not unclaimed', () => {
  const sets = [{ Name: 'www.promptugal.news.', Type: 'CNAME', ResourceRecords: [{ Value: 'promptugal.github.io' }] }, { Name: 'www.other.promptugal.news.', Type: 'CNAME', ResourceRecords: [{ Value: 'promptugal.github.io' }] }];
  assert.deepEqual(unclaimed(sets, { 'promptugal.news': 'R' }).map((x) => x.name), ['www.other.promptugal.news']);
});
t('DNS apply never creates a GitHub Pages record no repository claims', () => {
  const p = dnsPlan({ zone: 'promptugal.news', records: [{ name: 'x.promptugal.news', type: 'CNAME', value: 'promptugal.github.io' }] }, [], {});
  assert.deepEqual(p.actions, []); assert.equal(p.notes.length, 1);
});
t('a dry DNS plan passes the policy', () => assert.deepEqual(checkActions(policy, dnsPlan(dns, [])), []));

const ED = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOnew';
const edPair = generateKeyPairSync('ed25519'), ecPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const EDPEM = edPair.publicKey.export({ type: 'spki', format: 'pem' }), ECPEM = ecPair.publicKey.export({ type: 'spki', format: 'pem' });
const EDSSH = pemToSsh(EDPEM), ECSSH = pemToSsh(ECPEM);
const HOME = { ssh_ed25519: EDSSH, ssh: ECSSH };
const cfgOf = (r) => kb.repository_config[`PrompTugal__News__${r}`];
const AG = 'cl-6.x@PrompTugal.dinis';
t('key bootstrap: every covered repository has a config, and pages.yml is pinnable everywhere (B2, B3)', () => {
  for (const r of kb.repositories) { const c = kb.repository_config[r]; assert.ok(c && c.anchor_job.length, r); assert.ok(c.key_path === null || ['ssh', 'pem'].includes(c.key_encoding), r); assert.ok(kb.pinnable_files[r].some((g) => g.file === '.github/workflows/pages.yml'), r); }
  assert.deepEqual(kb.repository_config.PrompTugal__News__Cyber.anchor_job, ['verify', 'leakscan']);
  assert.match(EDSSH, /^ssh-ed25519 /); assert.match(ECSSH, /^ecdsa-sha2-nistp256 /);
});
t('key bootstrap: each repository dialect accepts its own entry and refuses another', () => {
  const cases = {
    Library: [{ agent: 'x.b@PrompTugal.dinis', status: 'active', ssh_public_key: 'ssh-ed25519 AAAAold' }, (o) => ({ ...o, status: 'superseded' }), { agent: AG, session: 'S', status: 'active', ssh_public_key: EDSSH }],
    Bulletins: [{ agent: 'x.b@PrompTugal.dinis', status: 'current', git_signing: { ssh_public_key: 'ssh-ed25519 AAAAold' } }, (o) => ({ ...o, status: 'superseded' }), { agent: AG, session: 'S', status: 'current', git_signing: { ssh_public_key: EDSSH } }],
    Events: [{ agent: 'x.b@PrompTugal.dinis', ssh_signing: { public_key: 'ssh-ed25519 AAAAold' } }, (o) => ({ ...o, superseded: '2026-11-26T03:00Z' }), { agent: AG, session: 'S', ssh_signing: { public_key: EDSSH }, ssh_public_key: EDSSH }],
    Videos: [{ agent: 'x.b@PrompTugal.dinis', ssh: { public_key_pem: 'old' } }, (o) => ({ ...o, superseded: '2026-11-26T03:00Z' }), { agent: AG, session: 'S', ssh: { public_key_pem: EDPEM } }],
    Cyber: [{ agent: 'x.b@PrompTugal.dinis', status: 'active', bundle: { sign: 'old' } }, (o) => ({ ...o, status: 'superseded' }), { agent: AG, session: 'S', status: 'active', bundle: { sign: ECPEM } }],
    Data: [{ agent: 'x.b@PrompTugal.dinis', ssh: { public_key_pem: 'old', principals: ['x.b@PrompTugal.dinis'] } }, (o) => ({ ...o, superseded: '2026-11-26T03:00Z' }), { agent: AG, session: 'S', ssh: { public_key_pem: EDPEM, principals: [AG] }, ssh_signing: { public_key: EDSSH } }],
    Signals: [{ agent: 'x.b@PrompTugal.dinis', git_signing: { pem: 'old' } }, (o) => ({ ...o, superseded: '2026-11-26T03:00Z' }), { agent: AG, session: 'S', git_signing: { pem: ECPEM } }],
  };
  for (const [r, [old, retire, neu]] of Object.entries(cases)) {
    const before = JSON.stringify({ keys: [old] }), after = JSON.stringify({ keys: [retire(old), neu] });
    const ok = checkKeys(before, after, { agent: AG, session: 'S', home: HOME, cfg: cfgOf(r) });
    assert.deepEqual(ok.errors, [], r);
    const wrongStatus = JSON.stringify({ keys: [retire(old), { ...neu, status: 'something-else' }] });
    assert.ok(checkKeys(before, wrongStatus, { agent: AG, session: 'S', home: HOME, cfg: cfgOf(r) }).errors.length, `${r}: wrong status`);
    assert.ok(checkKeys(before, after, { agent: AG, session: 'S', home: { ssh_ed25519: 'ssh-ed25519 AAAAother', ssh: 'ecdsa-sha2-nistp256 AAAAother' }, cfg: cfgOf(r) }).errors.length, `${r}: other home key`);
  }
  const ev = cfgOf('Events'), mismatch = { agent: AG, ssh_signing: { public_key: EDSSH }, ssh_public_key: 'ssh-ed25519 AAAAother' };
  assert.equal(entryKey(mismatch, ev), null, 'Events: two different keys');
  assert.equal(entryKey({ agent: AG, ssh: { public_key_pem: EDPEM }, ssh_signing: { public_key: 'ssh-ed25519 AAAAother' } }, cfgOf('Data')), null, 'Data: PEM and ssh line differ');
  assert.equal(entryKey({ agent: AG, ssh: { public_key_pem: ECPEM } }, cfgOf('Data')), ECSSH, 'Data: a P-256 PEM reads as ecdsa-sha2-nistp256');
});
t('key bootstrap: more than one new entry, or one for another role, is refused', () => {
  const c = cfgOf('Library'), old = { agent: 'x.b@PrompTugal.dinis', status: 'active', ssh_public_key: 'ssh-ed25519 AAAAold' };
  const neu = { agent: AG, session: 'S', status: 'active', ssh_public_key: EDSSH };
  assert.ok(checkKeys(JSON.stringify({ keys: [old] }), JSON.stringify({ keys: [old, neu, neu] }), { agent: AG, session: 'S', home: HOME, cfg: c }).errors.length);
  const other = { ...old, agent: 'y.b@PrompTugal.dinis' };
  assert.ok(checkKeys(JSON.stringify({ keys: [other] }), JSON.stringify({ keys: [{ ...other, status: 'superseded' }, neu] }), { agent: AG, session: 'S', home: HOME, cfg: c }).errors.some((e) => e.includes('role')));
});
t('key bootstrap: only keys.json and pinned files may change, with exactly the pinned content', () => {
  const files = [{ filename: 'team/keys.json' }], pins = { '.github/workflows/pages.yml': 'a'.repeat(64) };
  assert.deepEqual(checkFiles(files, {}), []);
  assert.deepEqual(checkFiles([{ filename: 'scripts/check-commits.mjs', status: 'modified', content_sha256: 'c'.repeat(64) }], { 'scripts/check-commits.mjs': 'c'.repeat(64) }, false, false), [], 'Travel: pinned files only');
  assert.ok(checkFiles([...files, { filename: '.github/workflows/pages.yml', status: 'modified' }], {}).some((e) => e.includes('not pinned')));
  assert.deepEqual(checkFiles([...files, { filename: '.github/workflows/pages.yml', status: 'modified', content_sha256: 'a'.repeat(64) }], pins), []);
  assert.ok(checkFiles([...files, { filename: '.github/workflows/pages.yml', status: 'modified', content_sha256: 'b'.repeat(64) }], pins).length);
  assert.equal(checkFiles([...files, { filename: 'scripts/check-signatures.mjs' }], pins).length, 1);
  assert.ok(checkFiles(files, {}, true).length, 'a cut file list is refused');
  assert.ok(checkFiles([...files, { filename: 'x\naction_repo=PrompTugal__News__Cyber' }], {}).every((e) => !e.includes('\n')));
});
t('key bootstrap: pins come only from a verified pins file, limited to pinnable files', () => {
  assert.deepEqual(readPins(kb, '/nonexistent', 'PrompTugal__News__Cyber', { key: 'x', agent: 'y' }).pins, {});
});
t('gate status: untouched paths pass, touched ones need approval, a cut list fails (B4, B5)', () => {
  assert.equal(gateState(['site/index.html'], false, kb.gate_status.paths).state, 'success');
  for (const f of ['team/keys.json', '.gitattributes', 'scripts/leak-scan.mjs', 'scripts/commit-exemptions.json', 'scripts/check-signatures-trusted.sh']) assert.equal(gateState([f], false, kb.gate_status.paths).state, 'failure', f);
  assert.equal(gateState(['.github/workflows/pages.yml'], true, kb.gate_status.paths).state, 'success');
  assert.equal(gateState(['site/a'], true, kb.gate_status.paths, true).state, 'failure');
  assert.equal(gateState(Array.from({ length: 300 }, (_, i) => `site/${i}`), false, kb.gate_status.paths).state, 'failure');
});
t('dev-gate waits for the App status, and only the App can post it', () => {
  const r = org.repos.find((x) => x.rulesets?.some((q) => q.name === 'dev-gate'));
  const g = r.rulesets.find((q) => q.name === 'dev-gate');
  assert.equal(g.rules.find((q) => q.type === 'required_status_checks').parameters.required_status_checks[0].integration_id, 5777442);
  assert.ok(!g.bypass_actors.some((b) => b.actor_type === 'Integration'), 'no App bypass (B6)');
  const l = live(); l[r.name] = { ...l[r.name], rulesets: [], dev_status: null };
  assert.deepEqual(plan(org, l).actions.filter((a) => a.target === r.name), []);
  l[r.name].dev_status = 'success';
  assert.deepEqual(plan(org, l).actions.filter((a) => a.target === r.name).map((a) => a.action), ['ruleset.create']);
});

t('the App advances dev only to a green work head that is a strict fast-forward, and tags failures', () => {
  const D = 'a'.repeat(40), H = 'b'.repeat(40), ff = { status: 'ahead', ahead_by: 2, behind_by: 0 };
  assert.deepEqual(advanceDecision({ branch: 'work/cl-6.data', sha: H, state: 'success', dev: D, cmp: ff }), { kind: 'advance', agent: 'cl-6.data', sha: H, from: D });
  assert.equal(advanceDecision({ branch: 'work/cl-6.data', sha: H, state: 'success', dev: D, cmp: { status: 'diverged', ahead_by: 1, behind_by: 1 } }), null, 'diverged: never');
  assert.equal(advanceDecision({ branch: 'work/cl-6.data', sha: H, state: 'success', dev: D, cmp: { status: 'behind', ahead_by: 0, behind_by: 3 } }), null, 'behind: never');
  assert.equal(advanceDecision({ branch: 'work/cl-6.data', sha: D, state: 'success', dev: D, cmp: { status: 'identical', ahead_by: 0, behind_by: 0 } }), null, 'already dev');
  assert.equal(advanceDecision({ branch: 'work/cl-6.data', sha: H, state: 'pending', dev: D, cmp: ff }), null, 'pending: wait');
  assert.equal(advanceDecision({ branch: 'dev', sha: H, state: 'success', dev: D, cmp: ff }), null, 'only work/** heads');
  assert.equal(advanceDecision({ branch: 'work/a/../b', sha: H, state: 'success', dev: D, cmp: ff }), null, 'odd branch names refused');
  assert.equal(advanceDecision({ branch: 'work/cl-6.data', sha: H, state: 'success', dev: null, cmp: ff }), null, 'no dev: never');
  assert.deepEqual(advanceDecision({ branch: 'work/cl-6.data', sha: H, state: 'failure', dev: D, cmp: null }), { kind: 'fail_tag', agent: 'cl-6.data', sha: H, tag: `gate/cl-6.data/${H.slice(0, 12)}-fail` });
  const pol = JSON.parse(readFileSync('policy/abp.json', 'utf8')).pipelines['gate-status'];
  for (const a of ['ref.fast_forward_dev', 'tag.create_gate_fail']) assert.ok(pol.allowed.includes(a), a);
  for (const a of ['ref.force_update', 'ref.update_other_branch', 'tag.delete']) assert.ok(pol.refused_always.includes(a), a);
});

t('only the App\'s own gate status counts, and its newest wins (R1, N1)', () => {
  const g = JSON.parse(readFileSync('policy/key-bootstrap.json', 'utf8')).gate_status, bot = g.app_bot;
  const app = (state, at) => ({ context: g.context, state, created_at: at, creator: { login: bot.login, id: bot.id, type: 'Bot' } });
  const forged = [
    { context: g.context, state: 'success', created_at: '2026-11-27T03:00:00Z', creator: { login: 'the-cyber-boardroom-athena', id: 360710802, type: 'User' } },
    { context: g.context, state: 'success', created_at: '2026-11-27T03:00:00Z', creator: { login: bot.login, id: 1, type: 'Bot' } },
    { context: g.context, state: 'success', created_at: '2026-11-27T03:00:00Z', creator: { login: 'other-app[bot]', id: bot.id, type: 'Bot' } },
  ];
  assert.equal(appStatus(forged, g.context, bot), null, 'a forged success is ignored');
  const H = 'b'.repeat(40), D = 'a'.repeat(40), ff = { status: 'ahead', ahead_by: 1, behind_by: 0 };
  assert.equal(advanceDecision({ branch: 'work/cl-6.data', sha: H, state: appStatus(forged, g.context, bot)?.state, dev: D, cmp: ff }), null, 'so nothing advances');
  assert.equal(appStatus([app('success', '2026-11-27T02:00:00Z'), app('failure', '2026-11-27T02:15:00Z')], g.context, bot).state, 'failure', 'a later failure wins');
  assert.equal(appStatus([app('failure', '2026-11-27T02:15:00Z'), app('success', '2026-11-27T02:00:00Z'), ...forged], g.context, bot).state, 'failure', 'order of the list does not matter');
  assert.equal(appStatus([{ ...app('success', 'x'), context: 'other' }], g.context, bot), null, 'another context is not the gate');
});

t('a key pull request lands only as a strict fast-forward of dev, never through the merge API', () => {
  assert.equal(strictFastForward({ status: 'ahead', ahead_by: 1, behind_by: 0 }), true);
  assert.equal(strictFastForward({ status: 'diverged', ahead_by: 1, behind_by: 2 }), false, 'a non-fast-forward head is refused');
  assert.equal(strictFastForward({ status: 'behind', ahead_by: 0, behind_by: 1 }), false);
  assert.equal(strictFastForward({ status: 'identical', ahead_by: 0, behind_by: 0 }), false);
  assert.equal(strictFastForward(null), false);
  const src = readFileSync('build/key-bootstrap.mjs', 'utf8');
  assert.ok(!/pulls\/\$\{a\.pr\}\/merge/.test(src) && !/merge_method/.test(src), 'no merge API call left');
  assert.ok(/git\/refs\/heads\/dev`, \{ sha: a\.head_sha, force: false \}/.test(src), 'dev moves by PATCH force false');
  const k = JSON.parse(readFileSync('policy/abp.json', 'utf8')).pipelines['key-bootstrap'];
  assert.ok(k.allowed.includes('ref.fast_forward_dev_to_approved_head') && !k.allowed.includes('pull_request.merge_approved_head'));
  assert.ok(!/permission-pull-requests: write/.test(readFileSync('.github/workflows/key-bootstrap.yml', 'utf8')), 'no pull requests write');
});

console.log(`${n - failed} of ${n} tests passed`);
if (failed) process.exit(1);
