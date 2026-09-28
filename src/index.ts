#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION, createServer } from "./server.js";

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  console.log(`${SERVER_NAME} ${SERVER_VERSION}`);
  process.exit(0);
}
if (arg === "--help" || arg === "-h") {
  console.log(`${SERVER_NAME} ${SERVER_VERSION}
MCP server (stdio) for Singapore haze and rain, data from NEA via data.gov.sg.

Usage: sg-haze-rain-mcp            start the server on stdio (what MCP clients run)
       sg-haze-rain-mcp --version

Environment:
  SG_HAZE_IP_LOOKUP=off        never call an IP geolocation service; use the default region
  SG_HAZE_DEFAULT_REGION=west  region used when location is unknown (default: central)
  SG_HAZE_LANG=zh              default language for labels and advice (en | zh)
  SG_HAZE_CACHE_SECONDS=60     how long to reuse a fetched NEA feed`);
  process.exit(0);
}

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
