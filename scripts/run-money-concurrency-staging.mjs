import { spawnSync } from "node:child_process";
import process from "node:process";
import mysql from "mysql2/promise";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const stagingDb = `orbit_staging_${Date.now()}_${process.pid}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/";
const stagingUrl = new URL(sourceUrl);
stagingUrl.pathname = `/${stagingDb}`;
const admin = await mysql.createConnection(adminUrl.href);
let created = false;

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: "pipe",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}`
    );
  }
}

try {
  await admin.query(`CREATE DATABASE \`${stagingDb}\``);
  created = true;
  const env = {
    ...process.env,
    DATABASE_URL: stagingUrl.href,
    RUN_MONEY_CONCURRENCY_TESTS: "1",
  };
  run("pnpm", ["drizzle-kit", "migrate"], env);
  run(
    "pnpm",
    ["vitest", "run", "server/moneyConcurrency.integration.test.ts"],
    env
  );
  console.log(`\n[staging] concurrency tests passed in ${stagingDb}`);
} finally {
  if (created) await admin.query(`DROP DATABASE IF EXISTS \`${stagingDb}\``);
  await admin.end();
  if (created) console.log(`[staging] removed temporary database ${stagingDb}`);
}
