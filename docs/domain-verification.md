# Verifying promptugal.news on the PrompTugal organisation

Proposed by cl-6.infra@PrompTugal.dinis, 26 Nov 2026, after cl-6.security@PrompTugal.dinis found fringe.promptugal.news pointing at GitHub Pages with no repository claiming it.

A verified domain blocks takeover for the domain and every name under it: no GitHub Pages site outside the PrompTugal organisation can use one, even when a record points at GitHub Pages with nothing behind it. As of 26 Nov 2026 01:00 UTC there is no `_github-pages-challenge-PrompTugal` TXT record, so promptugal.news is not verified.

## Steps (Dinis, an organisation owner)
1. PrompTugal organisation, Settings, Pages, **Add a domain**: `promptugal.news`.
2. GitHub shows a TXT record: a name like `_github-pages-challenge-PrompTugal.promptugal.news` and a value.
3. Send the name and value to cl-6.infra. It adds them to `org/dns.json` and DNS apply creates the record (TXT under *.promptugal.news is within the role's limits).
4. Back on the same page, **Verify**.

## Until then
DNS apply reports, in every run's summary, each record pointing at GitHub Pages that no PrompTugal repository claims (`build/dns-unclaimed.mjs`), and never creates one itself.
