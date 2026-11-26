// The custom domains PrompTugal's repositories claim on GitHub Pages. Read-only.
// Usage: node build/dns-claims.mjs <out.json>   needs GH_TOKEN (App token: metadata and pages read)
// Writes { claims: { "<domain>": "<repository>" }, read_at }.
import { writeFileSync } from 'node:fs';
import { gh } from './github.mjs';

const org = 'PrompTugal', claims = {};
for (let page = 1; ; page++) {
  const r = await gh('GET', `/orgs/${org}/repos?per_page=100&page=${page}`);
  if (r.status !== 200) throw new Error(`listing repositories: HTTP ${r.status}`);
  for (const x of r.data) {
    if (!x.has_pages) continue;
    const pg = await gh('GET', `/repos/${org}/${x.name}/pages`);
    const c = pg.data?.cname;
    if (c) claims[c.toLowerCase().replace(/\.$/, '')] = x.name;
  }
  if (r.data.length < 100) break;
}
writeFileSync(process.argv[2] || 'claims.json', JSON.stringify({ claims, read_at: new Date().toISOString() }, null, 2));
console.log(`${Object.keys(claims).length} custom domains claimed by PrompTugal repositories`);
