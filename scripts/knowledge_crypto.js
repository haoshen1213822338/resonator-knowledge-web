import { createDecipheriv } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MAGIC = Buffer.from("RSKB1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from("resonator-knowledge-v1", "utf8");

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function decodeEnvironmentKey(value) {
  if (!value) return null;
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("The configured key must contain 32 bytes.");
  return key;
}

async function loadKey() {
  const environmentKey = decodeEnvironmentKey(process.env.KNOWLEDGE_ENCRYPTION_KEY || "");
  if (environmentKey) return environmentKey;
  const keyPath = getArgument("--key-file");
  if (!keyPath) throw new Error("Provide --key-file or KNOWLEDGE_ENCRYPTION_KEY.");
  const key = await readFile(path.resolve(keyPath));
  if (key.length !== 32) throw new Error("The key file must contain exactly 32 bytes.");
  return key;
}

function decrypt(buffer, key) {
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) return buffer;
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const contentStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(ivStart, tagStart));
  decipher.setAAD(AAD);
  decipher.setAuthTag(buffer.subarray(tagStart, contentStart));
  return Buffer.concat([decipher.update(buffer.subarray(contentStart)), decipher.final()]);
}

async function decryptPath(inputPath, outputPath, key) {
  const info = await stat(inputPath);
  if (info.isDirectory()) {
    await mkdir(outputPath, { recursive: true });
    for (const entry of await readdir(inputPath, { withFileTypes: true })) {
      await decryptPath(
        path.join(inputPath, entry.name),
        path.join(outputPath, entry.name),
        key
      );
    }
    return;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, decrypt(await readFile(inputPath), key), { mode: 0o600 });
}

async function main() {
  const command = process.argv[2];
  const input = getArgument("--input");
  const output = getArgument("--output");
  if (command !== "decrypt" || !input || !output) {
    throw new Error(
      "Usage: node scripts/knowledge_crypto.js decrypt --input <file-or-directory> --output <path> --key-file <key>"
    );
  }
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  if (inputPath === outputPath) throw new Error("Input and output paths must be different.");
  await decryptPath(inputPath, outputPath, await loadKey());
  process.stdout.write(`Decrypted output: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
