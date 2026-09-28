# sg-haze-rain-mcp

**Singapore haze and rain, live from NEA, inside Claude Code, Codex and any MCP client.**

An [MCP](https://modelcontextprotocol.io) server that answers "is the haze bad right now?" and "is it raining where I am?" for Singapore. It reads the National Environment Agency's real-time feeds (24-hr PSI, 1-hr PM2.5, the 5-minute rain-gauge network and the 2-hour / 24-hour / 4-day forecasts), works out where you are from your public IP, and reports the nearest region with NEA's own health advisory attached.

```
🌫️ Singapore haze — 28 Sept 2026, 21:46 SGT
Location: Bishan, Singapore → nearest PSI region: central (located via public IP)

24-hr PSI: **108** — Unhealthy (101–200)
1-hr PM2.5: **119 µg/m³** — Elevated (Band II)
24-hr PM2.5: 63 µg/m³
24-hr PM10: 72 µg/m³

Health advisory (Unhealthy):
• General public: Reduce prolonged or strenuous outdoor physical exertion.
• Elderly, pregnant women, children: Minimise prolonged or strenuous outdoor physical exertion.
• Chronic lung / heart conditions: Avoid prolonged or strenuous outdoor physical exertion.

All regions (24-hr PSI): north 75 · south 105 · east 90 · west 101 · central 108

☀️ No rain nearby — 28 Sept 2026, 21:45 SGT
Nearest rain gauges (5-minute total):
• Macritchie Reservoir (1.9 km): 0 mm
• Lower Peirce Reservoir (2.1 km): 0 mm
• Upper Peirce Reservoir Park (2.6 km): 0 mm
2-hour forecast Bishan (2.1 km): **Cloudy** — 9.30 pm to 11.30 pm
Island-wide: 0/89 stations reporting rain
Source: NEA via data.gov.sg
```

Labels and health advice are available in English and Chinese (`lang: "zh"` or `SG_HAZE_LANG=zh`). 中文说明见文末。

---

## Tools

| Tool | What it returns |
|---|---|
| `weather_now` | One call: haze (PSI, PM2.5, advisory) + rain now + 2-hour forecast for your location. Start here. |
| `get_haze` | 24-hr PSI, 1-hr PM2.5, 24-hr PM2.5 / PM10, NEA band, three-tier health advisory, all five regions for comparison, pollutant sub-indices in `structuredContent`. |
| `get_rain` | Nearest three rain gauges with their 5-minute totals, the 2-hour forecast for the nearest area, and how many of NEA's ~90 gauges are wet island-wide. |
| `get_forecast` | `horizon: "2h"` area nowcast, `"24h"` (default) general + your region per period, `"4d"` island-wide outlook. |
| `locate_me` | Shows what location and PSI region the other tools will use, and how it was determined. |

Every tool accepts the same optional location inputs, applied in this order of preference:

1. `region` – `north` · `south` · `east` · `west` · `central` (skips geolocation entirely)
2. `lat` + `lon` – if the client already knows the coordinates
3. `ip` – geolocate a specific IP
4. nothing – geolocate the machine's own public IP

If the IP resolves outside Singapore, or lookup fails, the server falls back to the default region (`central`, configurable) and says so in the reply.

Each result carries a human-readable `text` block and a machine-readable `structuredContent` object, so agents can quote the summary or branch on the numbers.

There is also one prompt, `haze_check`, which asks the assistant for a plain-language go / no-go on an outdoor plan (`activity: "run 5 km at 6pm"`).

## Quick start

Requires Node.js 18.17 or newer (`node --version`). No account, API key or sign-up.

### Claude Code

```bash
# for every project
claude mcp add --scope user sg-haze-rain -- npx -y github:ericwang915/sg-haze-rain-mcp

# Chinese labels by default
claude mcp add --scope user --env SG_HAZE_LANG=zh sg-haze-rain -- npx -y github:ericwang915/sg-haze-rain-mcp
```

Check it with `/mcp` inside Claude Code; the server should show as connected with five tools.

Or commit a project-level `.mcp.json` (see [`.mcp.json.example`](.mcp.json.example)) so teammates get it automatically. Then just ask: *"how's the haze right now?"*, *"will it rain in the next two hours?"*, *"should I go for a run?"*.

### Codex CLI

```bash
codex mcp add sg-haze-rain -- npx -y github:ericwang915/sg-haze-rain-mcp
```

or add to `~/.codex/config.toml`:

```toml
[mcp_servers.sg_haze_rain]
command = "npx"
args = ["-y", "github:ericwang915/sg-haze-rain-mcp"]
# env = { SG_HAZE_LANG = "zh" }
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sg-haze-rain": {
      "command": "npx",
      "args": ["-y", "github:ericwang915/sg-haze-rain-mcp"]
    }
  }
}
```

### Cursor, Windsurf, Zed, Cline, …

Any client that speaks MCP over stdio works. Use the same `command` / `args` pair as above in that client's MCP config (`.cursor/mcp.json`, etc.).

### From a clone (for hacking, or if you prefer a pinned local copy)

```bash
git clone https://github.com/ericwang915/sg-haze-rain-mcp.git
cd sg-haze-rain-mcp
npm install            # also builds dist/ via the prepare script
claude mcp add sg-haze-rain -- node "$PWD/dist/index.js"
```

### Install once, globally

```bash
npm install -g github:ericwang915/sg-haze-rain-mcp
claude mcp add sg-haze-rain -- sg-haze-rain-mcp
```

`npx -y github:…` downloads and builds on first run (a few seconds), then reuses the npx cache. An npm-registry package is planned; the `github:` form will keep working.

## Data sources

All readings come from NEA, published through Singapore's open-data platform. No API key is needed.

| Feed | Endpoint | Refresh |
|---|---|---|
| 24-hr PSI, 24-hr PM2.5 / PM10, pollutant sub-indices | `api-open.data.gov.sg/v2/real-time/api/psi` | hourly |
| 1-hr PM2.5 | `…/pm25` | hourly |
| Rainfall, 5-minute totals from ~90 gauges | `…/rainfall` | every 5 min |
| 2-hour area forecast (47 areas) | `…/two-hr-forecast` | every 30 min |
| 24-hour forecast, general + 5 regions | `…/twenty-four-hr-forecast` | a few times a day |
| 4-day outlook | `…/four-day-outlook` | daily |

Responses are cached in-process for 60 seconds (`SG_HAZE_CACHE_SECONDS`) so a chatty agent does not hammer the feeds. data.gov.sg rate-limits bursts with HTTP 429; the server retries with backoff, honours `Retry-After`, and if the feed still refuses it serves the last good copy it holds rather than failing.

### Bands used

24-hr PSI, per NEA:

| PSI | Band | General public |
|---|---|---|
| 0–50 | Good | Normal activities |
| 51–100 | Moderate | Normal activities |
| 101–200 | Unhealthy | Reduce prolonged or strenuous outdoor exertion |
| 201–300 | Very Unhealthy | Avoid prolonged or strenuous outdoor exertion |
| > 300 | Hazardous | Minimise outdoor activity |

The reply also carries the stricter advice NEA gives for the elderly, pregnant women, children, and people with chronic lung or heart disease.

1-hr PM2.5 (µg/m³), NEA's indicator for the next few hours: 0–55 Normal (I) · 56–150 Elevated (II) · 151–250 High (III) · > 250 Very High (IV).

## How location works, and privacy

With no location inputs the server asks a public IP-geolocation service where the machine's public IP is. It tries [ipwho.is](https://ipwho.is) first and [ipapi.co](https://ipapi.co) second, both free and keyless, and uses only the coordinates and city name they return. The lookup is city-level at best, and a VPN or corporate egress will move you.

That request reveals your IP to the geolocation provider (they already see it, since you are calling them). If you would rather it never happened:

- set `SG_HAZE_IP_LOOKUP=off` and, optionally, `SG_HAZE_DEFAULT_REGION=west`; or
- always pass `region` or `lat`/`lon` from the client.

Nothing about you is sent to NEA / data.gov.sg; those feeds are the same for everyone.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SG_HAZE_IP_LOOKUP` | `on` | `off` disables IP geolocation entirely |
| `SG_HAZE_DEFAULT_REGION` | `central` | Region used when location is unknown or outside Singapore |
| `SG_HAZE_LANG` | `en` | `zh` for Chinese labels and advisories; per-call `lang` overrides |
| `SG_HAZE_CACHE_SECONDS` | `60` | How long a fetched NEA feed is reused |
| `SG_HAZE_API_BASE` | data.gov.sg v2 real-time URL | Override for testing or a mirror |

## Development

```bash
npm install
npm run build        # tsc → dist/
npm test             # build, then a stdio smoke test that calls every tool against the live feeds
node dist/index.js --help
```

`test/smoke.mjs` speaks raw JSON-RPC to the built server, lists the tools, and calls each one with explicit regions or coordinates. It sets `SG_HAZE_IP_LOOKUP=off` so running the tests never geolocates your machine.

Layout:

```
src/index.ts    stdio entry point, --help / --version
src/server.ts   tool + prompt definitions, text formatting (en / zh)
src/nea.ts      NEA feed client with camel/snake normalisation and a small cache
src/geo.ts      region / coords / IP resolution, haversine nearest-neighbour
src/bands.ts    PSI and PM2.5 bands and NEA health advisories
```

## Releasing (maintainers)

Bump `version` in `package.json`, commit, then:

```bash
git tag v0.1.1 && git push --tags
```

The `Release to npm` workflow builds, runs the smoke test, checks the tag matches the version, and publishes with provenance. It needs an `NPM_TOKEN` repository secret (an npm granular access token with publish rights).

## Limitations

- Not an NEA product. Readings are relayed as published; for official advisories see [haze.gov.sg](https://www.haze.gov.sg) and [nea.gov.sg](https://www.nea.gov.sg).
- PSI is reported for five regions only; "your region" is the nearest region centroid, not a street-level reading.
- IP geolocation is approximate. Pass `lat`/`lon` or `region` when it matters.
- NEA occasionally pauses a feed or rate-limits bursts. The server retries, then falls back to its last cached copy if it has one, otherwise returns a clear error.

## License

MIT. See [LICENSE](LICENSE).

---

## 中文说明

**sg-haze-rain-mcp** 是一个 MCP 服务器，把新加坡国家环境局（NEA）的实时烟霾和降雨数据接入 Claude Code、Codex 以及任何支持 MCP 的客户端。它会根据你的公网 IP 判断所在位置，选出最近的 PSI 区域，并附上 NEA 的官方健康建议。

**工具**

- `weather_now`：一次调用给出烟霾（24小时 PSI、1小时 PM2.5、健康建议）+ 附近是否在下雨 + 2小时预报。
- `get_haze`：PSI / PM2.5 / PM10、NEA 等级、三类人群的健康建议、五个区域对比。
- `get_rain`：最近三个雨量站的 5 分钟降雨量、最近区域的 2小时预报、全岛有雨站点数。
- `get_forecast`：`horizon` 取 `2h`、`24h`（默认）或 `4d`。
- `locate_me`：查看服务器会使用的位置和区域。

所有工具都接受可选的 `region`（north / south / east / west / central）、`lat` + `lon`、`ip`，以及 `lang: "zh"`。不传位置时按公网 IP 定位；IP 在新加坡以外或定位失败时退回默认区域（`central`），并在回复中说明。

**接入 Claude Code**

```bash
claude mcp add --scope user --env SG_HAZE_LANG=zh sg-haze-rain -- npx -y github:ericwang915/sg-haze-rain-mcp
```

然后在 Claude Code 里输入 `/mcp` 确认已连接，直接问「现在烟霾怎么样」「两小时内会下雨吗」即可。

**接入 Codex**

```toml
# ~/.codex/config.toml
[mcp_servers.sg_haze_rain]
command = "npx"
args = ["-y", "github:ericwang915/sg-haze-rain-mcp"]
env = { SG_HAZE_LANG = "zh" }
```

**其他客户端**：Claude Desktop、Cursor 等在各自的 MCP 配置里填 `command: "npx"`、`args: ["-y", "github:ericwang915/sg-haze-rain-mcp"]`。需要 Node.js 18.17 以上，无需任何账号或 API key。

**数据来源**：NEA 通过 data.gov.sg 发布的实时接口（PSI 与 PM2.5 每小时、降雨每 5 分钟、2小时预报每 30 分钟、24小时预报与 4天展望）。无需 API key。

**隐私**：默认会向 ipwho.is（备用 ipapi.co）查询本机公网 IP 对应的城市级位置。不希望如此可设置 `SG_HAZE_IP_LOOKUP=off`，或在调用时直接传 `region` / `lat`+`lon`。发给 NEA 的请求不包含任何个人信息。

**免责声明**：非 NEA 官方产品，官方通告请以 [haze.gov.sg](https://www.haze.gov.sg) 为准。MIT 许可证。
