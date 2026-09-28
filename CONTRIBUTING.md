# Contributing

Thanks for helping make Singapore's haze and rain data easier to reach from AI tools.

## Ground rules

- **Data stays faithful to NEA.** Never invent, smooth or "correct" a reading. If a feed is missing, return a clear error or the last cached copy marked as such.
- **Privacy by default.** No new network calls that carry user information without an opt-out. Tests must never geolocate the developer's machine (`SG_HAZE_IP_LOOKUP=off` is set in `test/smoke.mjs`; keep it).
- **Health advice is quoted, not written.** Band labels and advisories in `src/bands.ts` must match NEA's published wording. Link the source in your PR when you change them.

## Setup

```bash
git clone https://github.com/ericwang915/sg-haze-rain-mcp.git
cd sg-haze-rain-mcp
npm install        # installs and builds
npm test           # build + live smoke test
```

The smoke test hits the real data.gov.sg feeds, which rate-limit bursts. If you see HTTP 429, wait a minute and rerun.

## Making a change

1. Open an issue first for anything beyond a small fix, so we can agree on scope.
2. Branch from `main`, keep the change focused, add or extend a smoke-test case in `test/smoke.mjs` when you add a tool or input.
3. Run `npm test` on a clean build.
4. Update `README.md` **and** `README.zh-CN.md` if behaviour or configuration changed. Add a line to `CHANGELOG.md` under *Unreleased*.
5. Open a PR. CI must pass on Node 18, 20 and 22.

## Adding a tool

- Define it in `src/server.ts` with `registerTool`, reuse `locationInputs`, and return both `text` and `structuredContent` via `run()`.
- Fetchers live in `src/nea.ts`; normalise snake/camel keys there so tools see one shape.
- Keep text output bilingual through the `t(l, en, zh)` helper.

## Releasing (maintainers)

Bump `version` in `package.json`, add the CHANGELOG entry, commit, then:

```bash
git tag vX.Y.Z && git push --tags
```

Users install from GitHub, so a pushed tag is the release.
