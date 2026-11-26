// Tests for PrompTugal__IaC. Node built-ins only. Usage: node test/run.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { load, validate, validateRepos, checkActions, glob } from '../build/abp.mjs';
import { plan } from '../build/org-plan.mjs';
import { plan as dnsPlan, validateDns } from '../build/dns-plan.mjs';
import { unclaimed } from '../build/dns-unclaimed.mjs';
import { checkKeys, checkFiles, gateState, entryKey } from '../build/key-bootstrap.mjs';
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

t('every place home names its place and agent', () => { for (const r of org.repos.filter((x) => x.name.startsWith('PrompTugal__Agent__Place__'))) { assert.ok(r.place?.id && r.place?.agent, r.name); assert.match(r.name, /^PrompTugal__Agent__Place__[A-Z][A-Za-z-]*$/); assert.equal(r.site, `${r.place.id}.place.agent.promptugal.news`); } });
t('a home with a site gets Pages and its own domain', () => {
  const r = org.repos.find((x) => x.pages_site); const l = live(); l[r.name] = { ...l[r.name], has_pages: false, cname: null };
  const acts = plan(org, l).actions.filter((a) => a.target === r.name);
  assert.deepEqual(acts.map((a) => a.action), ['pages.enable', 'pages.set_cname']); assert.equal(acts[1].cname, r.site);
});
t('every site is under agent.promptugal.news', () => { for (const r of org.repos.filter((x) => x.pages_site)) assert.match(r.site, /^[a-z0-9-]+(\.place)?\.agent\.promptugal\.news$/, r.name); });
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
  assert.deepEqual(plan(org, l).actions.filter((a) => a.target === r.name).map((a) => a.action), ['pages.nudge_certificate']);
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
t('key bootstrap: every covered repository has a config, and pages.yml is pinned whole (B2, B3)', () => {
  for (const r of kb.repositories) { assert.ok(kb.repository_config[r], r); assert.ok(['ed25519', 'p256-pem'].includes(kb.repository_config[r].key_format), r); assert.ok(kb.gate_changes[r].some((g) => g.file === '.github/workflows/pages.yml'), r); }
  assert.equal(kb.repository_config.PrompTugal__News__Signals.key_format, 'p256-pem');
});
t('key bootstrap: keys.json takes one new entry for the agent with its home key', () => {
  const before = JSON.stringify({ keys: [{ agent: 'cyber.b@PrompTugal.dinis', status: 'active', ssh_public_key: 'ssh-ed25519 AAAAold' }] });
  const ok = JSON.stringify({ keys: [{ agent: 'cyber.b@PrompTugal.dinis', status: 'superseded', superseded: '2026-11-26T03:00Z', ssh_public_key: 'ssh-ed25519 AAAAold' }, { agent: 'cl-6.cyber@PrompTugal.dinis', session: 'S', status: 'active', ssh_public_key: ED }] });
  assert.deepEqual(checkKeys(before, ok, { agent: 'cl-6.cyber@PrompTugal.dinis', session: 'S', homeKey: ED }), []);
  assert.ok(checkKeys(before, ok, { agent: 'cl-6.cyber@PrompTugal.dinis', session: 'S', homeKey: 'ssh-ed25519 AAAAother' }).length);
  assert.ok(checkKeys(before.replace('cyber.b@', 'signals.b@'), ok.replace('cyber.b@', 'signals.b@'), { agent: 'cl-6.cyber@PrompTugal.dinis', session: 'S', homeKey: ED }).some((e) => e.includes('role')));
  const two = JSON.stringify({ keys: [...JSON.parse(ok).keys, { agent: 'cl-6.cyber@PrompTugal.dinis', status: 'active', ssh_public_key: ED }] });
  assert.ok(checkKeys(before, two, { agent: 'cl-6.cyber@PrompTugal.dinis', session: 'S', homeKey: ED }).length);
});
t('key bootstrap: a superseded field alone is accepted where the file has no status (Signals style)', () => {
  const before = JSON.stringify({ keys: [{ agent: 'signals.b@PrompTugal.dinis', ssh_public_key: 'ssh-ed25519 AAAAold' }] });
  const after = JSON.stringify({ keys: [{ agent: 'signals.b@PrompTugal.dinis', ssh_public_key: 'ssh-ed25519 AAAAold', superseded: '2026-11-26T03:00Z' }, { agent: 'cl-6.signals@PrompTugal.dinis', session: 'S', ssh_public_key: ED }] });
  assert.deepEqual(checkKeys(before, after, { agent: 'cl-6.signals@PrompTugal.dinis', session: 'S', homeKey: ED }), []);
  assert.equal(entryKey({ git_signing: { pem: 'not a key' } }, 'p256-pem'), null);
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  assert.match(entryKey({ git_signing: { pem: publicKey.export({ type: 'spki', format: 'pem' }) } }, 'p256-pem'), /^ecdsa-sha2-nistp256 /);
});
t('key bootstrap: only keys.json and whole-file pins may change; unpinned files are refused', () => {
  const files = [{ filename: 'team/keys.json' }];
  assert.deepEqual(checkFiles(files, kb, 'PrompTugal__News__Cyber'), []);
  assert.ok(checkFiles([...files, { filename: '.github/workflows/pages.yml' }], kb, 'PrompTugal__News__Cyber').some((e) => e.includes('not pinned')));
  assert.equal(checkFiles([...files, { filename: 'scripts/check-signatures.mjs' }], kb, 'PrompTugal__News__Cyber').length, 1);
  assert.ok(checkFiles([...files, { filename: 'scripts/commit-exemptions.json' }], kb, 'PrompTugal__News__Travel').length);
  assert.ok(checkFiles([...files, { filename: 'x\naction_repo=PrompTugal__News__Cyber' }], kb, 'PrompTugal__News__Cyber').every((e) => !e.includes('\n')));
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

console.log(`${n - failed} of ${n} tests passed`);
if (failed) process.exit(1);
