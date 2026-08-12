import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createPersistence } from "../lib/persistence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadEnvFile(path.join(__dirname, "..", ".env"));

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  throw new Error("请先在 .env 中配置 DATABASE_URL");
}

const persistence = createPersistence({
  databaseUrl,
  ssl: ["1", "true", "enabled", "require"].includes(
    String(process.env.DATABASE_SSL || "false").toLowerCase()
  ),
});

try {
  await persistence.initialize();
  const health = await persistence.health();
  process.stdout.write(
    `PostgreSQL 已连接并完成建表：${health.database}（${health.latencyMs} ms）\n`
  );
  process.stdout.write("启动网站后会自动导入现有本地账号、对话、日志和任务。\n");
} finally {
  await persistence.close();
}
