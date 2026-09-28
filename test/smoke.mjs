// Smoke test: spawn the built server over stdio, list tools, call each tool
// with an explicit region so the test never geolocates the machine.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(here, "..", "dist", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, SG_HAZE_IP_LOOKUP: "off" },
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed++;
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  check("initialize", init.result?.serverInfo?.name === "sg-haze-rain", init.result?.serverInfo?.name);
  notify("notifications/initialized", {});

  const tools = await request("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
  check("tools/list", names.join(",") === "get_forecast,get_haze,get_rain,locate_me,weather_now", names.join(","));

  const calls = [
    ["get_haze", { region: "central" }, (r) => typeof r.psi24h === "number"],
    ["get_haze", { region: "west", lang: "zh" }, (r) => typeof r.psi24h === "number"],
    ["get_rain", { lat: 1.3521, lon: 103.8198 }, (r) => Array.isArray(r.nearestStations) && r.nearestStations.length === 3],
    ["get_forecast", { region: "east", horizon: "2h" }, (r) => r.nearestAreas?.length === 3],
    ["get_forecast", { region: "east" }, (r) => r.periods?.length >= 1],
    ["get_forecast", { horizon: "4d" }, (r) => r.days?.length >= 3],
    ["locate_me", { lat: 1.29, lon: 103.85 }, (r) => r.region === "south"],
    ["locate_me", {}, (r) => r.location?.source === "default"],
    ["weather_now", { region: "north" }, (r) => r.haze && r.rain],
  ];
  for (const [name, args, ok] of calls) {
    const res = await request("tools/call", { name, arguments: args });
    const sc = res.result?.structuredContent;
    const text = res.result?.content?.[0]?.text ?? "";
    check(`${name} ${JSON.stringify(args)}`, !res.result?.isError && sc && ok(sc), res.result?.isError ? text : "");
    if (process.env.VERBOSE) console.log(text + "\n");
  }
} catch (err) {
  check("run", false, err.message);
} finally {
  child.kill();
}
process.exit(failed ? 1 : 0);
