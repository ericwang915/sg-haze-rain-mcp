# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-09-28

### Added
- Five stdio MCP tools: `weather_now`, `get_haze`, `get_rain`, `get_forecast` (2h / 24h / 4d), `locate_me`.
- `haze_check` prompt for a plain-language go / no-go on outdoor plans.
- Location resolution by explicit region, coordinates, a given IP, or the machine's public IP (ipwho.is, then ipapi.co), with a stated fallback when outside Singapore.
- NEA 24-hr PSI and 1-hr PM2.5 bands with the three-tier health advisory, in English and Chinese.
- Rainfall from NEA's 5-minute gauge network, 2-hour area forecast, 24-hour and 4-day forecasts.
- In-process cache, retry with backoff on HTTP 429 / 5xx, stale-cache fallback.
- Bilingual README, example `.mcp.json`, CI smoke test on Node 18 / 20 / 22.

[Unreleased]: https://github.com/ericwang915/sg-haze-rain-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ericwang915/sg-haze-rain-mcp/releases/tag/v0.1.0
