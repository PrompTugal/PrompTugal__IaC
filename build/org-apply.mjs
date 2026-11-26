// Apply a plan written by org-plan.mjs, after build/abp.mjs has allowed it. Needs GH_TOKEN (the App's installation
// token, minted in CI in the apply environment). Takes only the actions below; anything else stops the run.
// Never deletes, transfers, archives, renames or changes visibility.
import { readFileSync } from 'node:fs';
import { gh } from './github.mjs';
import { load, checkActions } from './abp.mjs';
import { wanted, SETTINGS } from './org-plan.mjs';

const p = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const refused = checkActions(load(), p);
if (refused.length) { console.error(refused.join('\n')); process.exit(1); }
const org = JSON.parse(readFileSync('org/repos.json', 'utf8'));
const spec = Object.fromEntries(wanted(org).map((r) => [r.name, r]));
const pick = (r, keys) => Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
const must = (r, what, ok = [200, 201, 204]) => { if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${r.data?.message || ''}`); console.log(`done: ${what}`); };

for (const a of p.actions) {
  const r = spec[a.target], base = `/repos/${p.org}/${a.target}`;
  if (!r) throw new Error(`${a.target}: not in org/repos.json`);
  if (a.action === 'repo.create') {
    if (r.visibility !== 'public') throw new Error(`${a.target}: only public repositories are created`);
    must(await gh('POST', `/orgs/${p.org}/repos`, { name: r.name, visibility: 'public', auto_init: true, ...pick(r, SETTINGS) }), `create ${a.target}`, [201]);
  } else if (a.action === 'repo.update_settings') must(await gh('PATCH', base, pick(r, a.fields.filter((f) => SETTINGS.includes(f)))), `settings ${a.target} (${a.fields.join(', ')})`);
  else if (a.action === 'branch.create_dev') {
    const repo = await gh('GET', base); const ref = await gh('GET', `${base}/git/ref/heads/${repo.data.default_branch}`);
    must(await gh('POST', `${base}/git/refs`, { ref: 'refs/heads/dev', sha: ref.data.object.sha }), `dev branch ${a.target}`, [201, 422]);
  } else if (a.action === 'repo.set_default_branch') must(await gh('PATCH', base, { default_branch: 'dev' }), `default branch dev ${a.target}`);
  else if (a.action === 'pages.enable') must(await gh('POST', `${base}/pages`, { source: { branch: 'dev', path: '/' } }), `pages ${a.target} (from dev)`, [201, 409]);
  else if (a.action === 'pages.set_cname') {
    // Only the site its own entry names, never a domain outside the zone the policy lists.
    if (a.cname !== r.site || !/\.agent\.promptugal\.news$/.test(r.site)) throw new Error(`${a.target}: custom domain ${a.cname} is not its site`);
    must(await gh('PUT', `${base}/pages`, { cname: r.site }), `custom domain ${r.site} on ${a.target}`);
  }
  else if (a.action === 'team.grant_push') {
    // Push (write) only, and only a team its own entry names with push.
    if ((r.teams || {})[a.team] !== 'push') throw new Error(`${a.target}: team ${a.team} is not in its entry with push`);
    must(await gh('PUT', `/orgs/${p.org}/teams/${a.team}/repos/${p.org}/${a.target}`, { permission: 'push' }), `team ${a.team} push on ${a.target}`);
  }
  else throw new Error(`unknown action ${a.action}`);
}
console.log(`APPLIED ${p.actions.length} actions`);
