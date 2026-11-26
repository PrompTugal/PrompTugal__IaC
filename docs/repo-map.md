# PrompTugal repository map (draft)

Draft by cl-6.infra@PrompTugal.dinis, 25 Nov 2026, from the 22 existing repositories, for Dinis to correct (Dinis: "go ahead and draft names from the existing repos"). The machine form is `proposed` in `org/repos.json`; nothing here is created until Dinis says yes and the entry moves into `repos`.

## The shape
- **PrompTugal__News__{Section}**: a section of PrompTugal.news (content and site). Kept as it is.
- **PrompTugal__Agent__{Name}**: the home of the agent that keeps it: key, area, state, and its site at `{name}.agent.promptugal.news`. Agents' board and state move out of the section repositories into these homes.
- **PrompTugal__App__{Platform}**: the apps. Kept as they are.
- **PrompTugal__IaC** and **PrompTugal__Agent__Infrastructure**: the organisation as code and its keeper.

## Dinis's answers (26 Nov 2026, in cl-6.infra's session)
- "one agent per section, because we need to keep it nice and separate": the Conductor and 14 section homes move into `repos` and Org apply creates them.
- "an agent per locality, so we track everything that happens there": place agents, name to agree (below).
- "forget about Storm Charles for now, because we need to refactor everything out of it"; "forget about the apps for here".
- The News website split: "start moving the stuff into each agent"; the conductor moves it, once the homes exist.
- Each agent's site is `{name}.agent.promptugal.news`.

## Homes created (15)

| Home | Works on | Site |
|---|---|---|
| PrompTugal__Agent__Conductor | PrompTugal__News__Website (its board moves out; the repository goes back to being the website) | conductor.agent.promptugal.news |
| PrompTugal__Agent__Library | News__Library | library.agent.promptugal.news |
| PrompTugal__Agent__Data | News__Data | data.agent.promptugal.news |
| PrompTugal__Agent__Bulletins | News__Bulletins | bulletins.agent.promptugal.news |
| PrompTugal__Agent__Signals | News__Signals | signals.agent.promptugal.news |
| PrompTugal__Agent__Cyber | News__Cyber | cyber.agent.promptugal.news |
| PrompTugal__Agent__Civic | News__Civic | civic.agent.promptugal.news |
| PrompTugal__Agent__Weather | News__Weather | weather.agent.promptugal.news |
| PrompTugal__Agent__Events | News__Events | events.agent.promptugal.news |
| PrompTugal__Agent__Startups | News__Startups | startups.agent.promptugal.news |
| PrompTugal__Agent__Travel | News__Travel | travel.agent.promptugal.news |
| PrompTugal__Agent__Live | News__Live | live.agent.promptugal.news |
| PrompTugal__Agent__Videos | News__Videos | videos.agent.promptugal.news |
| PrompTugal__Agent__Fringe | News__Fringe | fringe.agent.promptugal.news |
| PrompTugal__Agent__Swarm | News__Swarm, News__Swarm__Runs | swarm.agent.promptugal.news |

## Place homes (36)
Dinis, 26 Nov 2026: "an agent per locality, so we track everything that happens there"; name `PrompTugal__Agent__Place__{Name}`; "one for all places that we current support". The places are the 36 in PrompTugal__News__Website `data/by-place/places.json` (Portugal; the Algarve and its 16 municipalities, with Quarteira in Loulé; 18 cities). Names are plain ASCII from each place's id (Loulé is `PrompTugal__Agent__Place__Loule`); each entry in `org/repos.json` keeps the place's id, name, kind, parent and the agent name places.json already gives it (`place.<id>@PrompTugal.dinis`). Sites: `{id}.place.agent.promptugal.news`. London is not in places.json yet.

## Sites and DNS
The `{name}.agent.promptugal.news` records are added to `org/dns.json` only once each home's GitHub Pages site is on with that custom domain. A CNAME to promptugal.github.io with no site behind it could be claimed by someone else's Pages site, unless promptugal.news is a verified domain of the PrompTugal organisation (organisation Settings, Pages, Add a domain: GitHub gives a TXT record, which DNS apply can create).

## Role homes (26) and folds (Dinis, 26 Nov 2026)
Dinis, in cl-6.infra's session (~01:25 UTC): "yes merge #14, and fold those into existing homes". From cl-6.conductor's list (PrompTugal__News__Website board/team/conductor/proposals/2026-11-26-agent-repos.json):
- 21 role homes: Journalist, Dev, Security, Correspondent, Designer, Accountant, ABP, Ontologist, Observability, DevOps, Sherpa, Synthetic, Rights, Translator, Telemetry, Historian, Researcher, Outreach, Backup, Investors, Customers.
- 5 twin homes of roles on the partner newsroom team: Reviewer, Curator, Checker, Programme, Analyst.
- Folded, no repository of their own: place.algarve.central, place.algarve.east and place.algarve.west into PrompTugal__Agent__Place__Algarve; place.districts into PrompTugal__Agent__Place__Portugal; the six places workers into their role homes: data into Data, dev into Dev, designer into Designer (cl-6.conductor's plan, board/team/conductor/plans/2026-11-26-wire-up-the-agents.md); datasci, detective and viz "and so on", their homes for cl-6.conductor to name.
Every agent home gives promptugal-news-agents push.
