# notice-radar

**Turn university notice pages — which have no RSS and often sit behind anti-bot WAFs — into a subscribable, keyword-filtered feed you can push to your phone.**

Config-driven · serverless (GitHub Actions) · no login · add your school in 5 minutes

[![ci](https://github.com/OWNER/notice-radar/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/notice-radar/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Replace `OWNER` above with your GitHub username.

## Why

Chinese university notices are scattered across the registrar, the graduate school, the news site and dozens of department columns. Most offer no RSS, and many return a `202` JS-challenge page to anything that isn't a real browser. Missing a course-drop window or a scholarship deadline is expensive.

Measured on 2026-09-27 (direct fetch, no browser):

| Source | Result | Parseable |
|---|---|---|
| Registrar (important / student affairs) | 200, 25–29 KB | yes |
| News site (notices) | 200, 86 KB | yes |
| Graduate school | 200, 32 KB, JS challenge present | flaky |
| Department sites | 202, 2.4 KB challenge page | no — and we do not bypass it |
| Public RSSHub | 10.5 s timeout | no |

## Quick start

Node ≥ 22.18 required (we rely on Node's native TypeScript support — no build step).

```bash
git clone https://github.com/OWNER/notice-radar.git
cd notice-radar
npm install
npm run doctor         # health check every source
npm run run -- --dry   # print the digest, no state write, no push
SERVERCHAN_KEY=xxx npm run run
```

## Commands

| Command | Purpose |
|---|---|
| `radr doctor` | Per-source status, size, timing and parsed item count |
| `radr run` | fetch → parse → keyword filter → dedupe → digest → push → save state |
| `radr list` | List configured sources |
| `radr run --dry` | No state write, no push |

## Add your school

Most sites need only YAML (`adapter: html-list`) — see [docs/add-your-school.md](docs/add-your-school.md). If the markup is unusual, copy `src/adapters/uestc/jwc.ts` and register it in `src/adapters/index.ts`.

## Serverless by design

`.github/workflows/poll.yml` runs every 20 minutes and commits the seen-ID state back to `data/state.json`, so no server or database is needed. Add `SERVERCHAN_KEY` as a repository secret to receive pushes.

Caveats: GitHub cron is UTC, has a 5-minute minimum, and runs late; scheduled workflows are disabled after 60 days of repository inactivity.

Tests run against **recorded real HTML fixtures**, so a site redesign tells you immediately whether the parser or the network broke.

## Scope and ethics

No login-required pages, no CAPTCHA/WAF bypass, no personal data collection, no server, no telemetry. Public pages only, one request at a time with a delay, `robots.txt` respected. Not affiliated with any university.

MIT licensed.
