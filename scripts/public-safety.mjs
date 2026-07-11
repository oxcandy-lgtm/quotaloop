import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["bearer token", /Bearer\s+[A-Za-z0-9._~-]{16,}/i],
  ["credential assignment", /(?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*[^\s<{][^\s]{7,}/i],
  ["local absolute path", /\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
];
const failures = [];
for (const file of files) {
  if (/\.(?:png|jpg|jpeg|gif|ico|icns|woff2?)$/i.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const [name, pattern] of rules) if (pattern.test(content)) failures.push(`${file}: ${name}`);
}
const privateFile = process.env.QUOTALOOP_PRIVATE_PATTERNS_FILE;
if (privateFile) {
  const privateRules = readFileSync(privateFile, "utf8").split("\n").filter(Boolean);
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const rule of privateRules) if (content.includes(rule)) failures.push(`${file}: private pattern`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Public-safety scan passed for ${files.length} tracked files.`);
