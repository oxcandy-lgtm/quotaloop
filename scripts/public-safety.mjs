import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const reservedHosts = new Set(["example.com", "example.org", "example.net"]);
const documentationIps = [
  /^127\./,
  /^192\.0\.2\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^::1$/,
];
const rawLogMarker = ["BEGIN", "RAW LOG"].join(" ");
const rules = [
  ["private key", /-----BEGIN\s+(?:[A-Z]+\s+)?PRIVATE KEY-----/],
  ["github token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["openai token", /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ["google token", /AIza[0-9A-Za-z_-]{20,}/],
  [
    "generic credential assignment",
    /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\s*[=:]\s*["']?[^\s"'<>{}]{12,}/i,
  ],
  ["authorization header", /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s]+/i],
  ["cookie header", /\bCookie\s*:\s*[^\s=]+=/i],
  [
    "webhook URL",
    /https?:\/\/(?:hooks\.slack\.com|discord(?:app)?\.com\/api\/webhooks)\/[^\s"']+/i,
  ],
  ["unix absolute user path", /\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/|$)/],
  ["windows absolute user path", /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\|$)/i],
  [
    "raw diagnostic log",
    new RegExp(
      `(?:${rawLogMarker}|stdout\\s*:\\s*[^<\\n]{24,}|stderr\\s*:\\s*[^<\\n]{24,})`,
      "i",
    ),
  ],
  [
    "private repository URL",
    /https?:\/\/github\.com\/(?!rust-lang\/crates\.io-index(?:[/?#"' ]|$)|oxcandy-lgtm\/quotaloop(?:[/?#"' ]|$)|example\/)[^\s/]+\/[^\s/]+/i,
  ],
];

export function scanContent(file, content) {
  const failures = [];
  for (const [name, pattern] of rules)
    if (pattern.test(content)) failures.push(`${file}: ${name}`);
  for (const match of content.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const ip = match[0];
    if (
      !documentationIps.some((pattern) => pattern.test(ip)) &&
      ip !== "0.0.0.0"
    )
      failures.push(`${file}: non-documentation IP`);
  }
  for (const match of content.matchAll(/[\w.+-]+@([\w.-]+\.[A-Za-z]{2,})/g))
    if (!reservedHosts.has(match[1].toLowerCase()))
      failures.push(`${file}: non-example email`);
  return failures;
}

export function run() {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const failures = [];
  for (const file of files) {
    if (
      file.startsWith("scripts/public-safety-fixtures/") ||
      /\.(?:png|jpg|jpeg|gif|ico|icns|woff2?)$/i.test(file)
    )
      continue;
    if (/^\.env(?:\.|$)/.test(file) && file !== ".env.example")
      failures.push(`${file}: tracked env file`);
    failures.push(...scanContent(file, readFileSync(file, "utf8")));
  }
  const privateFile = process.env.QUOTALOOP_PRIVATE_PATTERNS_FILE;
  if (privateFile) {
    const privateRules = readFileSync(privateFile, "utf8")
      .split("\n")
      .filter(Boolean);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const rule of privateRules)
        if (content.includes(rule)) failures.push(`${file}: private pattern`);
    }
    console.log(
      `Private-pattern preflight: checked ${privateRules.length} local rules (patterns withheld).`,
    );
  } else
    console.log(
      "Private-pattern preflight: not configured (no private patterns read).",
    );
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return failures;
  }
  console.log(`Public-safety scan passed for ${files.length} tracked files.`);
  return [];
}

if (process.argv[1]?.endsWith("public-safety.mjs")) run();
