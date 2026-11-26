// Plan: compare org/repos.json with the PrompTugal organisation and write the actions needed.
// On the pattern of SovereignWebsite__IaC build/org-plan.mjs, narrowed to creating and configuring.
// Without GH_TOKEN it plans as if no repository exists (the dry plan run by Checks).
// Usage: node build/org-plan.mjs [out.json]   prints a Markdown plan, writes the plan JSON.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gh } from './github.mjs';

// Settings Org apply may set. On create: the defaults merged with the entry. On an existing repository: only the
// fields the entry itself names, so a repository is kept as it is unless its entry says otherwise.
export const SETTINGS = ['description', 'homepage', 'has_wiki', 'has_projects', 'delete_branch_on_merge', 'allow_merge_commit', 'allow_squash_merge', 'allow_rebase_merge'];
const OWN = new Set(['description', 'homepage', 'allow_merge_commit', 'allow_squash_merge', 'allow_rebase_merge', 'has_wiki', 'has_projects', 'delete_branch_on_merge']);

export const wanted = (org) => org.repos.map((r) => ({ ...org.defaults, ...r, _own: Object.keys(r) }));

export function plan(org, live) {
  const actions = [], notes = [];
  for (const r of wanted(org)) {
    const l = live[r.name];
    if (!l) {
      actions.push({ action: 'repo.create', target: r.name });
      actions.push({ action: 'branch.create_dev', target: r.name });
      actions.push({ action: 'repo.set_default_branch', target: r.name });
      if (r.pages_site) actions.push({ action: 'pages.enable', target: r.name });
      if (r.pages_site && r.site) actions.push({ action: 'pages.set_cname', target: r.name, cname: r.site });
      for (const [t, perm] of Object.entries(r.teams || {})) if (perm === 'push') actions.push({ action: 'team.grant_push', target: r.name, team: t });
      continue;
    }
    if (l.archived) { notes.push(`${r.name}: archived, left as it is`); continue; }
    if (l.visibility && l.visibility !== r.visibility) notes.push(`${r.name}: is ${l.visibility}, org/repos.json says ${r.visibility}; visibility is never changed by Org apply`);
    const diff = SETTINGS.filter((k) => OWN.has(k) && r._own.includes(k) && (l[k] ?? null) !== (r[k] ?? null));
    if (diff.length) actions.push({ action: 'repo.update_settings', target: r.name, fields: diff });
    if (r.pages_site && !l.has_pages) actions.push({ action: 'pages.enable', target: r.name });
    if (r.pages_site && r.site && (l.cname ?? null) !== r.site) actions.push({ action: 'pages.set_cname', target: r.name, cname: r.site });
    for (const [t, perm] of Object.entries(r.teams || {})) if (perm === 'push' && !['push', 'maintain', 'admin'].includes((l.teams || {})[t])) actions.push({ action: 'team.grant_push', target: r.name, team: t });
    if (l.default_branch !== 'dev') {
      if (!l.has_dev) actions.push({ action: 'branch.create_dev', target: r.name, from: l.default_branch });
      actions.push({ action: 'repo.set_default_branch', target: r.name, from: l.default_branch });
    }
  }
  const names = new Set(org.repos.map((r) => r.name));
  const unlisted = Object.keys(live).filter((n) => !names.has(n));
  return { pipeline: 'org-apply', org: org.org, actions, unlisted, notes };
}

export async function liveRepos(org) {
  const out = {};
  for (let page = 1; ; page++) {
    const r = await gh('GET', `/orgs/${org}/repos?per_page=100&page=${page}`);
    if (r.status !== 200) throw new Error(`listing repositories: HTTP ${r.status}`);
    for (const listed of r.data) {
      // The list leaves out the merge settings; the repository's own record has them.
      const full = await gh('GET', `/repos/${org}/${listed.name}`);
      const x = full.status === 200 ? { ...listed, ...full.data } : listed;
      const dev = await gh('GET', `/repos/${org}/${x.name}/branches/dev`);
      let cname = null;
      if (x.has_pages) { const pg = await gh('GET', `/repos/${org}/${x.name}/pages`); cname = pg.data?.cname ?? null; }
      const tm = await gh('GET', `/repos/${org}/${x.name}/teams`);
      const teams = Object.fromEntries((Array.isArray(tm.data) ? tm.data : []).map((t) => [t.slug, t.permission]));
      out[x.name] = { ...x, has_dev: dev.status === 200, cname, teams };
    }
    if (r.data.length < 100) break;
  }
  return out;
}

export function markdown(p) {
  const l = [`### Plan for ${p.org} (${p.actions.length} actions)`];
  for (const a of p.actions) l.push(`- \`${a.action}\` ${a.target}${a.fields ? ` (${a.fields.join(', ')})` : a.from ? ` (from ${a.from})` : a.cname ? ` (${a.cname})` : a.team ? ` (${a.team}, push)` : ''}`);
  if (!p.actions.length) l.push('- nothing to do');
  for (const n of p.notes || []) l.push(`- note: ${n}`);
  if (p.unlisted?.length) l.push(`\nNot in org/repos.json (reported, never deleted): ${p.unlisted.join(', ')}`);
  return l.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const org = JSON.parse(readFileSync('org/repos.json', 'utf8'));
  const live = process.env.GH_TOKEN ? await liveRepos(org.org) : {};
  const p = plan(org, live);
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(p, null, 2));
  console.log(markdown(p));
}
