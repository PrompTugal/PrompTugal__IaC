// Every record in the zone that points at GitHub Pages, checked against the domains PrompTugal repositories claim.
// Read-only. Usage: node build/dns-unclaimed.mjs <live.json> <claims.json>
// A name pointing at GitHub Pages that no PrompTugal repository claims can be taken over by anyone's Pages site.
// Exit 1 when one is found, so the run shows red.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PAGES_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const bare = (n) => n.toLowerCase().replace(/\.$/, '');

export function unclaimed(sets, claims) {
  const out = [];
  for (const s of sets) {
    const vals = (s.ResourceRecords || []).map((x) => bare(x.Value));
    const pages = (s.Type === 'CNAME' && vals.some((v) => v.endsWith('.github.io'))) || (['A', 'AAAA'].includes(s.Type) && vals.some((v) => PAGES_IPS.includes(v) || v.startsWith('2606:50c0:800')));
    // www.<domain> is GitHub Pages' own pair of a claimed apex (it redirects there), so it counts as claimed.
    const n = bare(s.Name), pair = n.startsWith('www.') && claims[n.slice(4)];
    if (pages && !claims[n] && !pair) out.push({ name: bare(s.Name), type: s.Type, value: vals.join(', ') });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sets = JSON.parse(readFileSync(process.argv[2], 'utf8')).ResourceRecordSets;
  const { claims } = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const pagesSets = sets.filter((s) => unclaimed([s], {}).length);
  const u = unclaimed(sets, claims);
  console.log(`### DNS claims for promptugal.news\n- ${sets.length} records in the zone; ${pagesSets.length} point at GitHub Pages; ${Object.keys(claims).length} domains claimed by PrompTugal repositories`);
  if (!u.length) console.log('- every name pointing at GitHub Pages is claimed by a PrompTugal repository');
  for (const x of u) console.log(`- UNCLAIMED: ${x.name} ${x.type} ${x.value}`);
  if (u.length) process.exit(1);
}
