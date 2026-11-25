// DNS plan: compare org/dns.json with the zone's records and write the changes needed. CREATE only.
// Usage: node build/dns-plan.mjs <live.json|-> <out.json>
//   live.json is `aws route53 list-resource-record-sets` output; "-" plans as if the zone were empty (the dry plan).
// Writes { pipeline, zone, actions, notes, batch } where batch is a Route 53 ChangeBatch of CREATE changes only.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fqdn = (n) => (n.endsWith('.') ? n : `${n}.`).toLowerCase();

export function validateDns(d) {
  const e = [], seen = new Set();
  for (const r of d.records || []) {
    const n = fqdn(r.name || '');
    if (!n.endsWith(`.${d.zone}.`)) e.push(`${r.name}: must be under ${d.zone} (the apex is never written)`);
    if (!['A', 'AAAA', 'CNAME', 'TXT'].includes(r.type)) e.push(`${r.name}: type ${r.type} not allowed`);
    if (!r.value) e.push(`${r.name}: value missing`);
    const k = `${n} ${r.type}`; if (seen.has(k)) e.push(`${k}: listed twice`); seen.add(k);
  }
  return e;
}

export function plan(d, live) {
  const actions = [], notes = [], changes = [];
  const have = new Map((live || []).map((s) => [`${fqdn(s.Name)} ${s.Type}`, (s.ResourceRecords || []).map((x) => x.Value.replace(/\.$/, ''))]));
  const cnameAt = new Set((live || []).filter((s) => s.Type === 'CNAME').map((s) => fqdn(s.Name)));
  for (const r of d.records) {
    const n = fqdn(r.name), want = String(r.value).replace(/\.$/, ''), got = have.get(`${n} ${r.type}`);
    if (got) { if (!(got.length === 1 && got[0].toLowerCase() === want.toLowerCase())) notes.push(`${r.name} ${r.type} is ${got.join(', ')}, org/dns.json says ${want}: never changed by DNS apply`); continue; }
    if (r.type === 'CNAME' && [...have.keys()].some((k) => k.startsWith(`${n} `))) { notes.push(`${r.name}: other records exist there, a CNAME cannot be added`); continue; }
    if (r.type !== 'CNAME' && cnameAt.has(n)) { notes.push(`${r.name}: a CNAME exists there`); continue; }
    actions.push({ action: 'route53.create_record', target: `${r.name} ${r.type}`, value: want });
    changes.push({ Action: 'CREATE', ResourceRecordSet: { Name: n, Type: r.type, TTL: r.ttl || 300, ResourceRecords: [{ Value: r.type === 'TXT' ? `"${want}"` : want }] } });
  }
  return { pipeline: 'dns-apply', zone: d.zone, actions, notes, batch: { Comment: 'PrompTugal__IaC dns-apply (CREATE only)', Changes: changes } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const d = JSON.parse(readFileSync('org/dns.json', 'utf8'));
  const errs = validateDns(d); if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  const src = process.argv[2];
  const live = src && src !== '-' ? JSON.parse(readFileSync(src, 'utf8')).ResourceRecordSets : [];
  const p = plan(d, live);
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(p, null, 2));
  console.log(`### DNS plan for ${p.zone} (${p.actions.length} records to create)${src === '-' || !src ? ', dry: as if the zone were empty' : ''}`);
  for (const a of p.actions) console.log(`- create ${a.target} ${a.value}`);
  if (!p.actions.length) console.log('- nothing to do');
  for (const n of p.notes) console.log(`- note: ${n}`);
}
