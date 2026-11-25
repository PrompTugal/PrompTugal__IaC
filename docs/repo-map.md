# PrompTugal repository map (draft)

Draft by cl-6.infra@PrompTugal.dinis, 25 Nov 2026, from the 22 existing repositories, for Dinis to correct (Dinis: "go ahead and draft names from the existing repos"). The machine form is `proposed` in `org/repos.json`; nothing here is created until Dinis says yes and the entry moves into `repos`.

## The shape
- **PrompTugal__News__{Section}**: a section of PrompTugal.news (content and site). Kept as it is.
- **PrompTugal__Agent__{Name}**: the home of the agent that keeps it: key, area, state, and its site at `{name}.agent.promptugal.news`. Agents' board and state move out of the section repositories into these homes.
- **PrompTugal__App__{Platform}**: the apps. Kept as they are.
- **PrompTugal__IaC** and **PrompTugal__Agent__Infrastructure**: the organisation as code and its keeper.

## Proposed homes (16)

| Proposed | Works on | Site |
|---|---|---|
| PrompTugal__Agent__Conductor | PrompTugal__News__Website (its board moves out; the repository goes back to being the website) | conductor.agent.promptugal.news |
| PrompTugal__Agent__Library | News__Library | library.agent.promptugal.news |
| PrompTugal__Agent__Data | News__Data | data.agent.promptugal.news |
| PrompTugal__Agent__Bulletins | News__Bulletins | bulletins.agent.promptugal.news |
| PrompTugal__Agent__Signals | News__Signals | signals.agent.promptugal.news |
| PrompTugal__Agent__Cyber | News__Cyber | cyber.agent.promptugal.news |
| PrompTugal__Agent__Civic | News__Civic | civic.agent.promptugal.news |
| PrompTugal__Agent__Weather | News__Weather, News__Storm-Charles | weather.agent.promptugal.news |
| PrompTugal__Agent__Events | News__Events | events.agent.promptugal.news |
| PrompTugal__Agent__Startups | News__Startups | startups.agent.promptugal.news |
| PrompTugal__Agent__Travel | News__Travel | travel.agent.promptugal.news |
| PrompTugal__Agent__Live | News__Live | live.agent.promptugal.news |
| PrompTugal__Agent__Videos | News__Videos | videos.agent.promptugal.news |
| PrompTugal__Agent__Fringe | News__Fringe | fringe.agent.promptugal.news |
| PrompTugal__Agent__Swarm | News__Swarm, News__Swarm__Runs | swarm.agent.promptugal.news |
| PrompTugal__Agent__Apps | App__Android, App__iOS, App__Mobile | apps.agent.promptugal.news |

## Questions for Dinis
1. One agent per section, or fewer agents each keeping several sections (say Weather with Live and Travel)?
2. Is News__Storm-Charles part of Weather, or its own?
3. One apps agent, or one per platform?
4. The News__Website split (what leaves the website for the conductor's home, and any new section repositories) is the conductor's to propose; cl-6.infra adds the repositories it names.
5. Do the agent sites go live now (Pages on, `{name}.agent.promptugal.news`), or the homes first and sites once DNS is in place?
