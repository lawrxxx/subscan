#!/usr/bin/env node
// Manage subscan's Vercel environment variables through the Vercel CLI.
//
//   npm run env:status              what's configured vs. env.manifest.json (no values shown)
//   npm run env:sync                prompt for everything missing, then offer to redeploy
//   npm run env:add -- NAME         add one variable (hidden prompt for secrets)
//   npm run env:add -- NAME --replace   overwrite an existing value (asks you to confirm)
//   npm run env:deploy              redeploy production so new values take effect
//   npm run env:verify              check the live deployment picks the values up
//
// Values are read from a hidden terminal prompt (or piped stdin) and passed to
// the CLI on stdin - never as arguments, never logged, never written to disk.
// Secrets are stored as Vercel "sensitive" variables (write-only).
// Auth: run `npx vercel login` once, or set VERCEL_TOKEN. Project: `npx vercel link`
// once (writes .vercel/, git-ignored), or set VERCEL_ORG_ID + VERCEL_PROJECT_ID.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "env.manifest.json"), "utf8"));
const CLI = ["--yes", "vercel@67.0.0"];
const ENVS = ["production", "preview", "development"];
const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const flag = (f) => args.includes(f);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

function globalArgs() {
  const g = [];
  if (process.env.VERCEL_TOKEN) g.push("--token", process.env.VERCEL_TOKEN);
  if (process.env.VERCEL_SCOPE) g.push("--scope", process.env.VERCEL_SCOPE);
  return g;
}

/** Runs the Vercel CLI. Output is captured (never echoed) unless `show` is set. */
function vercel(argv, { input, show = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn("npx", [...CLI, ...argv, ...globalArgs()], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => ((out += d), show && process.stdout.write(scrub(String(d)))));
    child.stderr.on("data", (d) => (err += d));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

// Belt and braces: never let a token reach the terminal.
const scrub = (s) => (process.env.VERCEL_TOKEN ? s.split(process.env.VERCEL_TOKEN).join("[token]") : s);

function fail(msg, detail) {
  console.error(`\n✗ ${msg}`);
  if (detail) console.error(scrub(detail).split("\n").filter((l) => l.trim()).slice(-6).join("\n"));
  if (/not linked|link/i.test(detail ?? "")) console.error("\n  Link this folder once:  npx vercel link");
  if (/credentials|login|token|not authorized|forbidden/i.test(detail ?? "")) console.error("\n  Log in once:  npx vercel login   (or set VERCEL_TOKEN)");
  process.exit(1);
}

/** Configured variables: name -> { environments, type }. Values from the CLI are discarded here. */
async function configured() {
  const r = await vercel(["env", "ls", "--json"]);
  if (r.code !== 0) fail("Couldn't list Vercel environment variables.", r.err || r.out);
  let parsed;
  try {
    parsed = JSON.parse(r.out.slice(r.out.indexOf("{")));
  } catch {
    fail("Unexpected output from `vercel env ls --json`.");
  }
  const map = new Map();
  for (const e of parsed.envs ?? []) {
    const cur = map.get(e.key) ?? { environments: new Set(), type: e.type, branches: [] };
    for (const t of [].concat(e.target ?? [])) cur.environments.add(t);
    if (e.gitBranch) cur.branches.push(e.gitBranch);
    map.set(e.key, cur);
  }
  return map;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let data = "";
      process.stdin.on("data", (d) => (data += d));
      process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
      return;
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
      else value += ch;
    };
    stdin.on("data", onData);
  });
}

function prompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolve(String(d).trim());
    });
  });
}

function spec(name) {
  const v = manifest.variables.find((x) => x.name === name);
  if (!v) fail(`${name} isn't in env.manifest.json. Add it there first (name, secret, need, environments, help).`);
  return v;
}

async function addOne(v, have, { replace = false, value } = {}) {
  if (v.need === "local-only" || !v.environments.length) fail(`${v.name} is local-only and must never be stored on Vercel.`);
  const existing = have.get(v.name)?.environments ?? new Set();
  const targets = (opt("--env")?.split(",") ?? v.environments).filter((e) => ENVS.includes(e));
  const already = targets.filter((e) => existing.has(e));
  if (already.length && !replace) {
    console.log(`  ${v.name} already set for ${already.join(", ")} - left unchanged (use --replace to overwrite).`);
  }
  const todo = replace ? targets : targets.filter((e) => !existing.has(e));
  if (!todo.length) return false;
  if (replace && already.length) {
    if (!process.stdin.isTTY) fail("Refusing to overwrite without an interactive confirmation.");
    const ok = await prompt(`  ${v.name} is already set for ${already.join(", ")}. Type the name to overwrite it: `);
    if (ok !== v.name) return console.log("  Not changed."), false;
  }

  console.log(`\n${v.name}${v.secret ? " (secret)" : ""} -> ${todo.join(", ")}\n  ${v.help}`);
  let val = value;
  if (val === undefined) {
    if (v.secret && value === undefined && opt("--value")) fail("Secrets can't be passed with --value; use the hidden prompt or stdin.");
    val = opt("--value") ?? (v.secret ? await promptHidden("  Value (hidden): ") : await prompt(`  Value${v.default ? ` [${v.default}]` : ""}: `));
    if (!val && v.default) val = v.default;
  }
  val = (val ?? "").trim();
  if (!val) return console.log("  Skipped (empty)."), false;
  if (v.pattern && !new RegExp(v.pattern).test(val)) {
    console.log(`  That doesn't look like a valid ${v.name} (expected ${v.pattern}).`);
    if (!process.stdin.isTTY || (await prompt("  Save anyway? [y/N] ")).toLowerCase() !== "y") return console.log("  Not saved."), false;
  }
  if (v.public && v.secret) fail(`${v.name} is NEXT_PUBLIC_ and would be exposed in the browser; it can't be a secret.`);

  for (const env of todo) {
    // Vercel doesn't allow sensitive variables in Development; secrets only go to production/preview.
    const sensitive = v.secret && env !== "development";
    if (v.secret && env === "development") {
      console.log("  Skipping development: secrets stay out of `vercel env pull` files.");
      continue;
    }
    const a = ["env", "add", v.name, "--environment", env, sensitive ? "--sensitive" : "--no-sensitive", "--yes"];
    if (existing.has(env)) a.push("--force");
    const r = await vercel(a, { input: val });
    if (r.code !== 0) fail(`Couldn't add ${v.name} to ${env}.`, r.err || r.out);
    console.log(`  ✓ ${env}${sensitive ? " (sensitive)" : ""}`);
  }
  return true;
}

async function status() {
  const have = await configured();
  const rows = manifest.variables.map((v) => {
    const cur = have.get(v.name);
    const cells = ENVS.map((e) => (!v.environments.includes(e) ? (cur?.environments.has(e) ? "set*" : "-") : cur?.environments.has(e) ? "set" : v.secret && e === "development" ? "-" : "MISSING"));
    return { v, cells, missing: v.environments.some((e) => !(v.secret && e === "development") && !cur?.environments.has(e)) };
  });
  const w = Math.max(...manifest.variables.map((v) => v.name.length));
  console.log(`\n${"variable".padEnd(w)}  ${ENVS.map((e) => e.slice(0, 11).padEnd(11)).join(" ")}  need`);
  for (const r of rows) console.log(`${r.v.name.padEnd(w)}  ${r.cells.map((c) => c.padEnd(11)).join(" ")}  ${r.v.need}${r.v.secret ? ", secret" : ""}`);
  const extra = [...have.keys()].filter((k) => !manifest.variables.some((v) => v.name === k));
  if (extra.length) console.log(`\nOn Vercel but not in the manifest: ${extra.join(", ")}`);
  if (rows.some((r) => r.cells.includes("set*"))) console.log("set* = present in an environment the manifest doesn't expect (check it's intended).");
  const local = rows.filter((r) => r.v.need === "local-only" && have.has(r.v.name));
  if (local.length) console.log(`\n⚠ ${local.map((r) => r.v.name).join(", ")} should not be on Vercel. Remove with: npx vercel env rm NAME`);
  const missingReq = rows.filter((r) => r.missing && r.v.need === "required").map((r) => r.v.name);
  const missingRec = rows.filter((r) => r.missing && r.v.need === "recommended").map((r) => r.v.name);
  console.log(`\nMissing required: ${missingReq.join(", ") || "none"}\nMissing recommended: ${missingRec.join(", ") || "none"}`);
  return { have, rows, missingReq, missingRec };
}

async function deploy() {
  const url = opt("--url") ?? manifest.productionUrl;
  console.log(`\nRedeploying production from ${url} so new variables take effect…`);
  const r = await vercel(["redeploy", url, "--environment", "production"], { show: false });
  if (r.code !== 0) fail("Redeploy failed.", r.err || r.out);
  const dep = (r.out.match(/https:\/\/[^\s]+\.vercel\.app/g) ?? []).pop();
  console.log(`✓ Deployed${dep ? `: ${dep}` : ""}. Production alias: ${manifest.productionUrl}`);
}

async function verify() {
  const base = opt("--url") ?? manifest.productionUrl;
  const get = async (p) => {
    try {
      const r = await fetch(base + p, { headers: { "cache-control": "no-cache" } });
      return r.ok ? (await r.json()).data : null;
    } catch {
      return null;
    }
  };
  const [s, a, ap, card] = await Promise.all([get("/api/status"), get("/api/agent"), get("/api/autopilot"), fetch(base + "/api/erc8004").then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  if (!s) fail(`Couldn't reach ${base}/api/status.`);
  const checks = [
    ["Celo mainnet RPC", s.celoRpc?.ok, s.celoRpc?.ok ? `block ${s.celoRpc.block}` : s.celoRpc?.error],
    ["Textile FX", s.textile?.ok, s.textile?.ok ? `live rate, auth: ${s.textile.auth}` : s.textile?.error],
    ["Agent", a?.engine === "rules", a?.engine === "rules" ? "rule-based, no AI model" : "unreachable"],
    ["Autopilot (AUTOPILOT_SEAL_KEY)", !!ap?.available, ap?.available ? `ready${ap.conversions ? ", conversions on" : ", conversions need TEXTILE_API_KEY"}` : "not configured"],
    ["Attribution codes", !!s.attribution?.codes?.length, s.attribution?.codes?.join(", ")],
    ["ERC-8004 agent id", !!s.erc8004AgentId, s.erc8004AgentId ? `#${s.erc8004AgentId}` : "ERC8004_AGENT_ID not set (identity can still be registered from the Wallet page)"],
    ["Agent card URL", !!card, card?.services?.[0]?.endpoint ?? card?.url ?? (card ? "served" : "unreachable")],
  ];
  console.log(`\n${base}`);
  for (const [k, ok, d] of checks) console.log(`  ${ok ? "✓" : "✗"} ${k}${d ? ` - ${d}` : ""}`);
  return checks;
}

const main = {
  status,
  verify,
  deploy,
  async add() {
    const name = args[1];
    if (!name || name.startsWith("--")) fail("Usage: npm run env:add -- NAME [--env production,preview] [--replace]");
    const have = await configured();
    const changed = await addOne(spec(name), have, { replace: flag("--replace") });
    if (changed && !flag("--no-deploy")) console.log("\nRun `npm run env:deploy` to apply it (or pass --deploy next time).");
    if (changed && flag("--deploy")) await deploy();
  },
  async sync() {
    const { have, rows } = await status();
    const todo = rows.filter((r) => r.missing && r.v.need !== "local-only" && (r.v.need !== "optional" || flag("--all")));
    if (!todo.length) console.log("\nNothing to add.");
    let changed = false;
    for (const r of todo) {
      if (r.v.need !== "required" && process.stdin.isTTY) {
        const ans = (await prompt(`\nSet ${r.v.name} now? (${r.v.need}) [y/N] `)).toLowerCase();
        if (ans !== "y") continue;
      }
      changed = (await addOne(r.v, have)) || changed;
    }
    if (changed) {
      const go = !process.stdin.isTTY || (await prompt("\nRedeploy production now? [Y/n] ")).toLowerCase() !== "n";
      if (go) await deploy();
      if (go) await verify();
    }
  },
};

if (!main[cmd]) fail(`Unknown command "${cmd}". Use status, sync, add, deploy or verify.`);
await main[cmd]();
process.exit(0);
