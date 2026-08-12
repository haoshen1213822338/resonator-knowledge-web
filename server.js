import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPersistence } from "./lib/persistence.js";
import {
  buildCitationEvidence,
  decorateCitation,
  formatCitationLocator,
  readCitationMetadata,
} from "./lib/citations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_STARTED_AT = Date.now();

await loadEnvFile(path.join(__dirname, ".env"));
const LOCAL_CONFIG_PATH = path.join(__dirname, "config.local.json");
const LOCAL_CONFIG = await loadLocalConfig();

const PORT = Number(process.env.PORT || 3030);
const KNOWLEDGE_DIR =
  process.env.KNOWLEDGE_DIR ||
  "D:\\Wecaht\\聊天记录\\wechat_kb_test_export\\90_AI输出";
const AI_PROVIDER = process.env.AI_PROVIDER || "deepseek";
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.deepseek.com")
  .replace(/\/+$/, "");
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "deepseek-v4-flash";
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || AI_MODEL;
const VISION_BATCH_SIZE = Math.max(1, Number(process.env.VISION_BATCH_SIZE || 6));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const AUTH_STORE_PATH = path.join(DATA_DIR, "auth.json");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "audit.ndjson");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const DATABASE_SSL = ["1", "true", "enabled", "require"].includes(
  String(process.env.DATABASE_SSL || "false").toLowerCase()
);
const PERSISTENCE = createPersistence({ databaseUrl: DATABASE_URL, ssl: DATABASE_SSL });
await PERSISTENCE.initialize();
const KNOWLEDGE_ENCRYPTION_ENABLED = !["0", "false", "disabled"].includes(
  String(process.env.KNOWLEDGE_ENCRYPTION_ENABLED || "true").toLowerCase()
);
const KNOWLEDGE_KEY_PATH = path.resolve(
  process.env.KNOWLEDGE_KEY_PATH || path.join(DATA_DIR, "knowledge-encryption.key")
);
const KNOWLEDGE_KEY_ENV = String(process.env.KNOWLEDGE_ENCRYPTION_KEY || "").trim();
const ENCRYPTION_MAGIC = Buffer.from("RSKB1", "ascii");
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_TAG_BYTES = 16;
const ENCRYPTION_AAD = Buffer.from("resonator-knowledge-v1", "utf8");
const BACKUP_RETENTION_COUNT = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT || 7));
const AUTO_BACKUP_ENABLED = ["1", "true", "enabled"].includes(
  String(process.env.AUTO_BACKUP_ENABLED || "false").toLowerCase()
);
const BACKUP_INTERVAL_HOURS = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24));
const IMPORT_MAX_ATTEMPTS = Math.max(1, Number(process.env.IMPORT_MAX_ATTEMPTS || 3));
const TRASH_RETENTION_DAYS = Math.max(1, Number(process.env.TRASH_RETENTION_DAYS || 30));
const UPLOAD_CHUNK_SIZE = Math.min(
  64 * 1024 * 1024,
  Math.max(1024 * 1024, Number(process.env.UPLOAD_CHUNK_SIZE || 8 * 1024 * 1024))
);
const UPLOAD_SESSION_RETENTION_HOURS = Math.max(
  24,
  Number(process.env.UPLOAD_SESSION_RETENTION_HOURS || 72)
);
const SESSION_COOKIE = "resonator_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const scrypt = promisify(scryptCallback);
let VAULT_DIR = LOCAL_CONFIG.vaultDir || process.env.VAULT_DIR || path.dirname(KNOWLEDGE_DIR);
let SPACES_ROOT =
  LOCAL_CONFIG.spacesRoot ||
  process.env.SPACES_ROOT ||
  path.join(VAULT_DIR, "knowledge_spaces");
let BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(VAULT_DIR, "_knowledge_backups"));
const DEFAULT_SPACE_ID = process.env.DEFAULT_SPACE_ID || "共振体公司知识库";
let UPDATE_SCRIPT = process.env.UPDATE_SCRIPT ||
  path.join(VAULT_DIR, "99_系统配置", "scripts", "update_kb.py");
const PYTHON_CMD = process.env.PYTHON_CMD || "python";
const DEFAULT_UPDATE_INPUT =
  process.env.DEFAULT_UPDATE_INPUT ||
  "00_原始资料\\候选材料包\\流程测试_梦星鸣潮_每日返图";
const FILE_EXTRACTOR_SCRIPT =
  process.env.FILE_EXTRACTOR_SCRIPT || path.join(__dirname, "scripts", "extract_file.py");
const PARSER_PYTHON_CMD =
  process.env.PARSER_PYTHON_CMD || process.env.PYTHON_CMD || "python";
const VECTOR_SEARCH_SCRIPT =
  process.env.VECTOR_SEARCH_SCRIPT || path.join(__dirname, "scripts", "vector_search.py");
const VECTOR_MODEL = process.env.VECTOR_MODEL || "BAAI/bge-small-zh-v1.5";
const VECTOR_ENABLED = !["0", "false", "disabled"].includes(
  String(process.env.VECTOR_ENABLED || "true").toLowerCase()
);
const VECTOR_CACHE_DIR = path.resolve(
  process.env.VECTOR_CACHE_DIR || path.join(DATA_DIR, "models")
);
const vectorSearchWarnings = new Set();
const vectorQueryCache = new Map();
const VECTOR_QUERY_CACHE_TTL_MS = 5 * 60_000;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let knowledgeEncryptionKey = null;
const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".docx",
  ".pdf",
  ".xlsx",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".webm",
  ".m4v",
]);
const VIDEO_UPLOAD_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);
const MAX_CONCURRENT_IMPORT_JOBS = 1;
const activeImportJobs = new Set();
const pendingImportJobs = [];
let queueWorkerBusy = false;
const PROJECT_STOP_WORDS = new Set([
  "梦星",
  "鸣潮",
  "梦星鸣潮",
  "崩铁",
  "星铁",
  "星穹",
  "铁道",
]);

const DEFAULT_PROJECT_ALIASES = [
  {
    canonical: "\u7f8e\u7684\u5c0f\u897f\u6885\u7535\u70ed\u6c34\u5668",
    aliases: [
      "\u5c0f\u897f\u6885",
      "\u5c0f\u897f\u6885\u6848\u4f8b",
      "\u7f8e\u7684\u5c0f\u897f\u6885",
      "\u7535\u70ed\u6c34\u5668",
      "\u65e0\u9541\u68d2",
      "\u65e0\u9541\u68d2\u7cfb\u5217",
    ],
  },
  {
    canonical: "\u7f8e\u7684\u51b0\u7bb1",
    aliases: [
      "\u7f8e\u7684\u51b0\u7bb1",
      "\u51b0\u7bb1\u4f1a\u8bae",
      "\u7f8e\u7684\u51b0\u7bb1\u4f1a\u8bae\u8bb0\u5f55",
      "\u5168\u98df\u6750\u4fdd\u9c9c",
    ],
  },
  {
    canonical: "\u68a6\u661f\u9e23\u6f6e",
    aliases: [
      "\u68a6\u661f",
      "\u9e23\u6f6e",
      "\u68a6\u661f\u9e23\u6f6e",
      "\u6bcf\u65e5\u8fd4\u56fe",
    ],
  },
  {
    canonical: "\u5d29\u574f\uff1a\u661f\u7a79\u94c1\u9053",
    aliases: [
      "\u5d29\u94c1",
      "\u661f\u94c1",
      "\u661f\u7a79\u94c1\u9053",
      "\u5d29\u574f\u661f\u7a79\u94c1\u9053",
    ],
  },
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const ROLE_LABELS = {
  admin: "超级管理员",
  manager: "资料管理员",
  member: "普通成员",
};

async function loadEnvFile(envPath) {
  try {
    const content = await readFile(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function loadLocalConfig() {
  try {
    const content = await readFile(LOCAL_CONFIG_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveLocalConfig(config) {
  await writeFile(LOCAL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function createEmptyAuthStore() {
  return {
    version: 1,
    sessionSecret: randomBytes(32).toString("hex"),
    users: [],
    sessions: [],
  };
}

async function loadAuthStore() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const store = JSON.parse(await readFile(AUTH_STORE_PATH, "utf8"));
    return {
      version: 1,
      sessionSecret: store.sessionSecret || randomBytes(32).toString("hex"),
      users: Array.isArray(store.users) ? store.users : [],
      sessions: Array.isArray(store.sessions) ? store.sessions : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    const store = createEmptyAuthStore();
    await saveAuthStore(store);
    return store;
  }
}

async function saveAuthStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(AUTH_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  await PERSISTENCE.saveAuthStore(store);
}

let AUTH_STORE = await PERSISTENCE.loadAuthStore(await loadAuthStore());
let authStoreRefreshedAt = Date.now();

async function refreshAuthStore(force = false) {
  if (!PERSISTENCE.enabled) return AUTH_STORE;
  if (!force && Date.now() - authStoreRefreshedAt < 1000) return AUTH_STORE;
  AUTH_STORE = await PERSISTENCE.loadAuthStore(AUTH_STORE);
  authStoreRefreshedAt = Date.now();
  return AUTH_STORE;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    spaces: Array.isArray(user.spaces) ? user.spaces : [],
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(String(password), salt, 64);
  return { salt, hash: Buffer.from(derived).toString("hex") };
}

async function verifyPassword(password, user) {
  const derived = await scrypt(String(password), user.passwordSalt, 64);
  const actual = Buffer.from(derived);
  const expected = Buffer.from(user.passwordHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(request) {
  const cookies = {};
  for (const item of String(request.headers.cookie || "").split(";")) {
    const index = item.indexOf("=");
    if (index < 1) {
      continue;
    }
    cookies[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return cookies;
}

function signSessionToken(sessionId) {
  const signature = createHmac("sha256", AUTH_STORE.sessionSecret).update(sessionId).digest("hex");
  return `${sessionId}.${signature}`;
}

function readSignedSessionId(token) {
  const [sessionId, signature] = String(token || "").split(".");
  if (!sessionId || !signature) {
    return "";
  }
  const expected = createHmac("sha256", AUTH_STORE.sessionSecret).update(sessionId).digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    ? sessionId
    : "";
}

function setSessionCookie(response, token) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
  );
}

async function getRequestUser(request) {
  await refreshAuthStore();
  const sessionId = readSignedSessionId(parseCookies(request)[SESSION_COOKIE]);
  if (!sessionId) {
    return null;
  }
  const now = Date.now();
  const session = AUTH_STORE.sessions.find((item) => item.id === sessionId);
  if (!session || Date.parse(session.expiresAt) <= now) {
    return null;
  }
  const user = AUTH_STORE.users.find((item) => item.id === session.userId);
  return user && !user.disabled ? user : null;
}

function userCanAccessSpace(user, spaceId) {
  if (!user) {
    return false;
  }
  return user.role === "admin" || (user.spaces || []).includes(normalizeSpaceId(spaceId));
}

function userCanManageSpace(user, spaceId) {
  return Boolean(user && (user.role === "admin" || (user.role === "manager" && userCanAccessSpace(user, spaceId))));
}

function sendForbidden(response, message = "你没有访问这个项目库的权限") {
  sendJson(response, 403, { error: message });
}

async function requireUser(request, response) {
  const user = await getRequestUser(request);
  if (!user) {
    sendJson(response, 401, { error: "请先登录", code: "AUTH_REQUIRED" });
    return null;
  }
  return user;
}

async function appendAuditLog({ request, user, action, space = "", target = "", detail = "" }) {
  await mkdir(DATA_DIR, { recursive: true });
  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    userId: user?.id || "",
    username: user?.username || "anonymous",
    action,
    space,
    target,
    detail,
    ip: request?.socket?.remoteAddress || "",
  };
  if (PERSISTENCE.enabled) {
    await PERSISTENCE.appendAuditLog(record);
    return;
  }
  await appendFile(AUDIT_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

async function readAuditLogs(limit = 100) {
  if (PERSISTENCE.enabled) return PERSISTENCE.readAuditLogs(limit);
  try {
    const content = await readFile(AUDIT_LOG_PATH, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.min(Math.max(Number(limit) || 100, 1), 500))
      .reverse()
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isLocalRequest(request) {
  const remoteAddress = request.socket.remoteAddress || "";
  return [
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ].includes(remoteAddress);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function decodeConfiguredEncryptionKey(value) {
  if (!value) return null;
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("KNOWLEDGE_ENCRYPTION_KEY 必须是 32 字节密钥（Base64 或 64 位十六进制）");
  }
  return key;
}

async function getKnowledgeEncryptionKey() {
  if (!KNOWLEDGE_ENCRYPTION_ENABLED) return null;
  if (knowledgeEncryptionKey) return knowledgeEncryptionKey;

  const configuredKey = decodeConfiguredEncryptionKey(KNOWLEDGE_KEY_ENV);
  if (configuredKey) {
    knowledgeEncryptionKey = configuredKey;
    return knowledgeEncryptionKey;
  }

  await mkdir(path.dirname(KNOWLEDGE_KEY_PATH), { recursive: true });
  try {
    const storedKey = await readFile(KNOWLEDGE_KEY_PATH);
    if (storedKey.length !== 32) {
      throw new Error(`知识库密钥文件长度异常：${KNOWLEDGE_KEY_PATH}`);
    }
    knowledgeEncryptionKey = storedKey;
    return knowledgeEncryptionKey;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const generatedKey = randomBytes(32);
  try {
    await writeFile(KNOWLEDGE_KEY_PATH, generatedKey, { flag: "wx", mode: 0o600 });
    knowledgeEncryptionKey = generatedKey;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    knowledgeEncryptionKey = await readFile(KNOWLEDGE_KEY_PATH);
  }
  return knowledgeEncryptionKey;
}

function isEncryptedKnowledgeBuffer(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length >= ENCRYPTION_MAGIC.length + ENCRYPTION_IV_BYTES + ENCRYPTION_TAG_BYTES &&
    buffer.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC);
}

async function encryptKnowledgeBuffer(plainBuffer) {
  if (!KNOWLEDGE_ENCRYPTION_ENABLED) return Buffer.from(plainBuffer);
  const key = await getKnowledgeEncryptionKey();
  const iv = randomBytes(ENCRYPTION_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(ENCRYPTION_AAD);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  return Buffer.concat([ENCRYPTION_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

async function decryptKnowledgeBuffer(encryptedBuffer) {
  if (!isEncryptedKnowledgeBuffer(encryptedBuffer)) return Buffer.from(encryptedBuffer);
  const key = await getKnowledgeEncryptionKey();
  const ivStart = ENCRYPTION_MAGIC.length;
  const tagStart = ivStart + ENCRYPTION_IV_BYTES;
  const contentStart = tagStart + ENCRYPTION_TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    encryptedBuffer.subarray(ivStart, tagStart)
  );
  decipher.setAAD(ENCRYPTION_AAD);
  decipher.setAuthTag(encryptedBuffer.subarray(tagStart, contentStart));
  try {
    return Buffer.concat([
      decipher.update(encryptedBuffer.subarray(contentStart)),
      decipher.final(),
    ]);
  } catch {
    throw new Error("知识文件解密失败：密钥不匹配或文件已损坏");
  }
}

async function readKnowledgeText(filePath) {
  const content = await readFile(filePath);
  return (await decryptKnowledgeBuffer(content)).toString("utf8");
}

async function writeProtectedFile(filePath, plainBuffer) {
  const protectedContent = await encryptKnowledgeBuffer(plainBuffer);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(temporaryPath, protectedContent, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function writeKnowledgeText(filePath, content) {
  await writeProtectedFile(filePath, Buffer.from(String(content), "utf8"));
}

async function getKnowledgeEncryptionInfo(filePath) {
  const content = await readFile(filePath);
  return { encrypted: isEncryptedKnowledgeBuffer(content), size: content.length };
}

async function getKnowledgeKeyId() {
  if (!KNOWLEDGE_ENCRYPTION_ENABLED) return "";
  const key = await getKnowledgeEncryptionKey();
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function normalizeSpaceId(value) {
  const normalized = safePathSegment(value || DEFAULT_SPACE_ID);
  return normalized || DEFAULT_SPACE_ID;
}

function setVaultDirectory(vaultDir) {
  VAULT_DIR = path.resolve(String(vaultDir));
  SPACES_ROOT =
    LOCAL_CONFIG.spacesRoot || process.env.SPACES_ROOT || path.join(VAULT_DIR, "knowledge_spaces");
  if (!process.env.UPDATE_SCRIPT) {
    UPDATE_SCRIPT = path.join(VAULT_DIR, "99_系统配置", "scripts", "update_kb.py");
  }
  if (!process.env.BACKUP_DIR) {
    BACKUP_DIR = path.join(VAULT_DIR, "_knowledge_backups");
  }
}

function getSpacePaths(spaceId = DEFAULT_SPACE_ID) {
  const id = normalizeSpaceId(spaceId);
  const root = path.join(SPACES_ROOT, id);
  const rawDir = path.join(root, "00_原始资料");
  const uploadRoot = path.join(rawDir, "网页上传");
  const knowledgeDir = path.join(root, "90_AI输出");
  const citationDir = path.join(knowledgeDir, "_引用证据");
  const systemDir = path.join(root, "99_系统配置");
  const chatDir = path.join(systemDir, "chat_sessions");
  const updateLogDir = path.join(systemDir, "update_logs");
  const importJobDir = path.join(systemDir, "import_jobs");
  const uploadSessionDir = path.join(systemDir, "upload_sessions");
  const trashDir = path.join(systemDir, "trash");
  const importIndex = path.join(systemDir, "资料入库记录.md");
  const vectorDir = path.join(systemDir, "vector_index");
  const vectorIndex = path.join(vectorDir, "index.json");
  return {
    id,
    root,
    rawDir,
    uploadRoot,
    knowledgeDir,
    citationDir,
    systemDir,
    chatDir,
    updateLogDir,
    importJobDir,
    uploadSessionDir,
    trashDir,
    importIndex,
    vectorDir,
    vectorIndex,
    folders: [
      rawDir,
      uploadRoot,
      knowledgeDir,
      citationDir,
      systemDir,
      chatDir,
      path.join(systemDir, "scripts"),
      updateLogDir,
      importJobDir,
      uploadSessionDir,
      trashDir,
      vectorDir,
    ],
  };
}

async function ensureKnowledgeBase(spaceId = DEFAULT_SPACE_ID) {
  await mkdir(SPACES_ROOT, { recursive: true });
  const paths = getSpacePaths(spaceId);
  for (const folder of paths.folders) {
    await mkdir(folder, { recursive: true });
  }

  if (!(await pathExists(paths.importIndex))) {
    await writeFile(
      paths.importIndex,
      [
        "# 资料入库记录",
        "",
        "这里记录网页端上传资料、AI 整理输出和本地知识库更新情况。",
        "",
      ].join("\n"),
      "utf8"
    );
  }

  return paths;
}

async function listSpaces() {
  await ensureKnowledgeBase(DEFAULT_SPACE_ID);
  const entries = await readdir(SPACES_ROOT, { withFileTypes: true });
  const spaces = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      name: entry.name,
      isDefault: entry.name === DEFAULT_SPACE_ID,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, "zh-CN"));

  return spaces;
}

async function listFilesRecursive(directory, extensions = null) {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath, extensions));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (extensions && !extensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

async function getLatestWriteTime(files) {
  let latest = null;
  for (const file of files) {
    const info = await stat(file);
    if (!latest || info.mtime > latest) {
      latest = info.mtime;
    }
  }
  return latest ? latest.toISOString() : null;
}

function getManagedFileType(filePath, paths) {
  const normalized = path.resolve(filePath);
  if (isPathInside(paths.knowledgeDir, normalized)) {
    return "ai";
  }
  if (isPathInside(paths.uploadRoot, normalized)) {
    return "upload";
  }
  if (isPathInside(paths.rawDir, normalized)) {
    return "raw";
  }
  if (isPathInside(paths.systemDir, normalized)) {
    return "system";
  }
  return "other";
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getManagedFileTypeLabel(type) {
  const labels = {
    ai: "AI 输出",
    upload: "网页上传",
    raw: "原始资料",
    system: "系统配置",
    other: "其他",
  };
  return labels[type] || type;
}

async function listManagedFiles(spaceId = DEFAULT_SPACE_ID, { type = "all", query = "" } = {}) {
  const paths = await ensureKnowledgeBase(spaceId);
  const roots = [
    paths.rawDir,
    paths.knowledgeDir,
    paths.systemDir,
  ];
  const files = [];
  const normalizedQuery = String(query || "").trim().toLowerCase();

  for (const rootDir of roots) {
    const found = await listFilesRecursive(rootDir);
    for (const filePath of found) {
      if (isPathInside(paths.trashDir, filePath)) {
        continue;
      }
      if (isPathInside(paths.uploadSessionDir, filePath)) {
        continue;
      }
      if (isPathInside(paths.citationDir, filePath)) {
        continue;
      }
      const info = await stat(filePath);
      const relativePath = path.relative(paths.root, filePath);
      const fileType = getManagedFileType(filePath, paths);
      if (type === "business" && !["ai", "upload", "raw"].includes(fileType)) {
        continue;
      }
      if (type !== "all" && type !== "business" && fileType !== type) {
        continue;
      }
      if (
        normalizedQuery &&
        !relativePath.toLowerCase().includes(normalizedQuery) &&
        !path.basename(filePath).toLowerCase().includes(normalizedQuery)
      ) {
        continue;
      }
      files.push({
        id: relativePath,
        name: path.basename(filePath),
        relativePath,
        absolutePath: filePath,
        extension: path.extname(filePath).toLowerCase() || "无扩展名",
        type: fileType,
        typeLabel: getManagedFileTypeLabel(fileType),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        canDelete: ["ai", "upload", "raw"].includes(fileType),
        encrypted: fileType === "ai"
          ? (await getKnowledgeEncryptionInfo(filePath)).encrypted
          : false,
      });
    }
  }

  return files.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}

function resolveManagedFilePath(spaceId, relativePath) {
  const paths = getSpacePaths(spaceId);
  const root = path.resolve(paths.root);
  const targetPath = path.resolve(paths.root, String(relativePath || ""));
  if (!isPathInside(root, targetPath) || targetPath === root) {
    throw new Error("文件路径不在当前项目库内。");
  }
  return { paths, targetPath };
}

async function deleteManagedFile(spaceId, relativePath) {
  const { paths, targetPath } = resolveManagedFilePath(spaceId, relativePath);
  const fileType = getManagedFileType(targetPath, paths);
  if (!["ai", "upload", "raw"].includes(fileType)) {
    throw new Error("系统配置文件不允许在网页端删除。");
  }
  const info = await stat(targetPath);
  if (!info.isFile()) {
    throw new Error("只能删除文件，不能删除文件夹。");
  }
  const trashId = `trash_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const trashItemDir = path.join(paths.trashDir, trashId);
  const trashedFilePath = path.join(trashItemDir, path.basename(targetPath));
  const deletedAt = new Date().toISOString();
  await mkdir(trashItemDir, { recursive: true });
  await rename(targetPath, trashedFilePath);
  const record = {
    id: trashId,
    space: paths.id,
    name: path.basename(targetPath),
    originalRelativePath: path.relative(paths.root, targetPath),
    trashedRelativePath: path.relative(paths.root, trashedFilePath),
    type: fileType,
    size: info.size,
    deletedAt,
  };
  await writeFile(path.join(trashItemDir, "metadata.json"), JSON.stringify(record, null, 2), "utf8");
  return {
    ...record,
    relativePath: record.originalRelativePath,
  };
}

async function listTrashItems(spaceId = DEFAULT_SPACE_ID) {
  const paths = await ensureKnowledgeBase(spaceId);
  const entries = await readdir(paths.trashDir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const content = await readFile(path.join(paths.trashDir, entry.name, "metadata.json"), "utf8");
      items.push(JSON.parse(content));
    } catch {
      // Ignore incomplete trash records; purge can still remove them later.
    }
  }
  return items.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

async function restoreTrashItem(spaceId, trashId) {
  const paths = await ensureKnowledgeBase(spaceId);
  const safeId = safePathSegment(trashId);
  const itemDir = path.join(paths.trashDir, safeId);
  const record = JSON.parse(await readFile(path.join(itemDir, "metadata.json"), "utf8"));
  const sourcePath = path.resolve(paths.root, record.trashedRelativePath);
  const originalPath = path.resolve(paths.root, record.originalRelativePath);
  if (!isPathInside(paths.trashDir, sourcePath) || sourcePath === path.resolve(paths.trashDir)) {
    throw new Error("回收站记录无效。");
  }
  let targetPath = originalPath;
  if (await pathExists(targetPath)) {
    const parsed = path.parse(targetPath);
    targetPath = path.join(parsed.dir, `${parsed.name}_恢复_${Date.now()}${parsed.ext}`);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
  await rm(itemDir, { recursive: true, force: true });
  return { ...record, restoredRelativePath: path.relative(paths.root, targetPath) };
}

async function purgeTrashItem(spaceId, trashId) {
  const paths = await ensureKnowledgeBase(spaceId);
  const itemDir = path.resolve(paths.trashDir, safePathSegment(trashId));
  if (!isPathInside(paths.trashDir, itemDir) || itemDir === path.resolve(paths.trashDir)) {
    throw new Error("回收站路径无效。");
  }
  await rm(itemDir, { recursive: true, force: true });
}

async function purgeExpiredTrash() {
  const threshold = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const space of await listSpaces()) {
    for (const item of await listTrashItems(space.id)) {
      if (Date.parse(item.deletedAt) < threshold) {
        await purgeTrashItem(space.id, item.id);
      }
    }
  }
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

async function listBackups(spaceId = "") {
  await mkdir(BACKUP_DIR, { recursive: true });
  const entries = await readdir(BACKUP_DIR, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(BACKUP_DIR, entry.name, "manifest.json"), "utf8"));
      if (!spaceId || manifest.space === normalizeSpaceId(spaceId)) backups.push(manifest);
    } catch {
      // Ignore incomplete snapshots.
    }
  }
  return backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function createSpaceBackup(spaceId, reason = "manual", includeSystemData = false) {
  const paths = await ensureKnowledgeBase(spaceId);
  await mkdir(BACKUP_DIR, { recursive: true });
  const id = `backup_${backupTimestamp()}_${safePathSegment(paths.id)}`;
  const backupRoot = path.join(BACKUP_DIR, id);
  const snapshotRoot = path.join(backupRoot, "snapshot");
  const createdAt = new Date().toISOString();
  await mkdir(backupRoot, { recursive: true });
  await cp(paths.root, snapshotRoot, {
    recursive: true,
    filter: (source) =>
      !isPathInside(paths.trashDir, source) &&
      !isPathInside(paths.uploadSessionDir, source),
  });
  let systemDataIncluded = false;
  if (includeSystemData) {
    const systemDataRoot = path.join(backupRoot, "system_data");
    await mkdir(systemDataRoot, { recursive: true });
    for (const source of [AUTH_STORE_PATH, AUDIT_LOG_PATH]) {
      if (await pathExists(source)) {
        await cp(source, path.join(systemDataRoot, path.basename(source)));
        systemDataIncluded = true;
      }
    }
  }
  const files = await listFilesRecursive(snapshotRoot);
  let totalBytes = 0;
  for (const file of files) totalBytes += (await stat(file)).size;
  const manifest = {
    id,
    space: paths.id,
    createdAt,
    reason,
    files: files.length,
    totalBytes,
    systemDataIncluded,
    backupRoot,
    knowledgeEncryptionEnabled: KNOWLEDGE_ENCRYPTION_ENABLED,
    knowledgeKeyId: await getKnowledgeKeyId(),
  };
  await writeFile(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const oldBackups = (await listBackups(paths.id)).slice(BACKUP_RETENTION_COUNT);
  for (const backup of oldBackups) {
    await rm(path.join(BACKUP_DIR, backup.id), { recursive: true, force: true });
  }
  return manifest;
}

async function restoreSpaceBackup(backupId, requestedName = "") {
  const safeId = String(backupId || "").trim();
  if (!safeId || safeId !== path.basename(safeId) || safeId.includes("..")) {
    throw new Error("备份编号无效。");
  }
  const backupRoot = path.resolve(BACKUP_DIR, safeId);
  if (!isPathInside(BACKUP_DIR, backupRoot) || backupRoot === path.resolve(BACKUP_DIR)) {
    throw new Error("备份路径无效。");
  }
  const manifest = JSON.parse(await readFile(path.join(backupRoot, "manifest.json"), "utf8"));
  const currentKeyId = await getKnowledgeKeyId();
  if (manifest.knowledgeKeyId && manifest.knowledgeKeyId !== currentKeyId) {
    throw new Error(
      `备份使用的知识库密钥不匹配（备份 ${manifest.knowledgeKeyId}，当前 ${currentKeyId || "未启用"}）`
    );
  }
  const baseName = requestedName || `${manifest.space}_恢复_${new Date().toISOString().slice(0, 10)}`;
  let targetSpace = normalizeSpaceId(baseName);
  let suffix = 1;
  while (await pathExists(getSpacePaths(targetSpace).root)) {
    targetSpace = normalizeSpaceId(`${baseName}_${suffix}`);
    suffix += 1;
  }
  await cp(path.join(backupRoot, "snapshot"), getSpacePaths(targetSpace).root, { recursive: true });
  await ensureKnowledgeBase(targetSpace);
  return { backup: manifest, targetSpace, targetRoot: getSpacePaths(targetSpace).root };
}

async function getKnowledgeBaseStatus(spaceId = DEFAULT_SPACE_ID) {
  const paths = await ensureKnowledgeBase(spaceId);

  const rawFiles = await listFilesRecursive(paths.rawDir, SUPPORTED_UPLOAD_EXTENSIONS);
  const uploadedFiles = await listFilesRecursive(paths.uploadRoot, SUPPORTED_UPLOAD_EXTENSIONS);
  const aiFiles = await listFilesRecursive(paths.knowledgeDir, new Set([".md"]));
  let encryptedAiFiles = 0;
  for (const filePath of aiFiles) {
    if ((await getKnowledgeEncryptionInfo(filePath)).encrypted) encryptedAiFiles += 1;
  }
  const allFiles = [...rawFiles, ...aiFiles];
  const vectorIndexInfo = await readVectorIndexStatus(paths.vectorIndex);

  return {
    ok: true,
    spaceId: paths.id,
    spaceRoot: paths.root,
    spacesRoot: SPACES_ROOT,
    vaultDir: VAULT_DIR,
    rawDir: paths.rawDir,
    uploadRoot: paths.uploadRoot,
    knowledgeDir: paths.knowledgeDir,
    systemDir: paths.systemDir,
    importIndex: paths.importIndex,
    updateScript: UPDATE_SCRIPT,
    updateScriptExists: await pathExists(UPDATE_SCRIPT),
    hasApiKey: Boolean(AI_API_KEY),
    aiProvider: AI_PROVIDER,
    aiModel: AI_MODEL,
    aiVisionModel: AI_VISION_MODEL,
    encryption: {
      enabled: KNOWLEDGE_ENCRYPTION_ENABLED,
      keyId: await getKnowledgeKeyId(),
      encryptedFiles: encryptedAiFiles,
      plaintextFiles: aiFiles.length - encryptedAiFiles,
      keySource: KNOWLEDGE_KEY_ENV ? "environment" : "server-key-file",
    },
    persistence: await PERSISTENCE.health(),
    vectorEnabled: VECTOR_ENABLED,
    vectorModel: VECTOR_MODEL,
    vectorIndex: vectorIndexInfo,
    counts: {
      rawFiles: rawFiles.length,
      uploadedFiles: uploadedFiles.length,
      aiFiles: aiFiles.length,
    },
    latestUpdate: await getLatestWriteTime(allFiles),
  };
}

async function readVectorIndexStatus(indexPath) {
  try {
    const storedContent = await readFile(indexPath);
    const content = JSON.parse((await decryptKnowledgeBuffer(storedContent)).toString("utf8"));
    const info = await stat(indexPath);
    return {
      ready: true,
      files: Object.keys(content.files || {}).length,
      chunks: Array.isArray(content.chunks) ? content.chunks.length : 0,
      model: content.model || VECTOR_MODEL,
      updatedAt: info.mtime.toISOString(),
      encrypted: isEncryptedKnowledgeBuffer(storedContent),
    };
  } catch (error) {
    if (["ENOENT", "EISDIR"].includes(error.code) || error instanceof SyntaxError) {
      return { ready: false, files: 0, chunks: 0, model: VECTOR_MODEL, updatedAt: null };
    }
    throw error;
  }
}

function buildKnowledgeContext(results) {
  return results
    .map((item, index) => {
      const locator = item.locator || formatCitationLocator(item.locations);
      return [
        `[${index + 1}] ${item.sourceFile || item.file}${locator ? `｜${locator}` : ""}`,
        item.sourcePath ? `原始位置：${item.sourcePath}` : "",
        item.snippet,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n---\n\n");
}

function extractResponsesApiText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractChatCompletionText(payload) {
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

function buildConversationHistory(history = []) {
  return history
    .slice(-8)
    .filter((item) => ["user", "assistant"].includes(item.role) && item.content)
    .map((item) => ({
      role: item.role,
      content: String(item.content).slice(0, 1800),
    }));
}

function buildHistoryText(history = []) {
  const usableHistory = buildConversationHistory(history);
  if (!usableHistory.length) {
    return "无";
  }
  return usableHistory
    .map((item, index) => {
      const label = item.role === "user" ? "用户" : "助手";
      return `${index + 1}. ${label}：${item.content}`;
    })
    .join("\n");
}

async function callResponsesApi(question, results, instructions, knowledgeContext, history = []) {
  const apiResponse = await fetch(`${AI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "上一轮对话记录：",
                buildHistoryText(history),
                "",
                `问题：${question}`,
                "",
                "本地知识库片段：",
                knowledgeContext || "未检索到相关片段。",
              ].join("\n"),
            },
          ],
        },
      ],
    }),
  });

  const payload = await apiResponse.json();
  if (!apiResponse.ok) {
    const message = payload.error?.message || `AI API 请求失败：${apiResponse.status}`;
    throw new Error(message);
  }

  return extractResponsesApiText(payload) || "AI 没有返回可用文本。";
}

async function callChatCompletionsApi(question, results, instructions, knowledgeContext, history = []) {
  const historyMessages = buildConversationHistory(history).map((item) => ({
    role: item.role,
    content: item.content,
  }));
  const apiResponse = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: instructions },
        ...historyMessages,
        {
          role: "user",
          content: [
            `问题：${question}`,
            "",
            "本地知识库片段：",
            knowledgeContext || "未检索到相关片段。",
          ].join("\n"),
        },
      ],
      stream: false,
      temperature: 0.35,
    }),
  });

  const payload = await apiResponse.json();
  if (!apiResponse.ok) {
    const message = payload.error?.message || `AI API 请求失败：${apiResponse.status}`;
    throw new Error(message);
  }

  return extractChatCompletionText(payload) || "AI 没有返回可用文本。";
}

async function callAI(question, results, history = []) {
  if (!AI_API_KEY) {
    return null;
  }

  const knowledgeContext = buildKnowledgeContext(results);
  const instructions = [
    "你是公司的知识库问答助手。",
    "回答必须优先基于提供的本地知识库片段，但可以在事实基础上做合理推断、归纳和下一步建议。",
    "请把事实、推断、建议区分清楚：资料明确支持的内容用确定语气；推断内容要标注“推断”；没有证据的内容要标注“待确认”。",
    "不要因为资料没有逐字写明就直接回答资料不足；先尝试从项目背景、时间线、需求、风险、流程和相似片段中总结可用判断。",
    "只有完全没有相关片段时，才说明资料不足，并给出建议补充哪些资料。",
    "回答要简洁、可执行，适合客服、管理员、项目负责人或接单人员直接使用。",
    "回答体验要求：先给一句明确结论；简单问题用 3-5 句话回答；复杂问题再分成“依据”“推断”“建议下一步”“待确认”。",
    "如果用户问怎么办、怎么做、下一步，优先输出可执行步骤，而不是长篇背景解释。",
    "你可以结合上一轮对话理解追问、省略指代和连续任务。",
    "不要输出手机号、订单号、账号、密码、验证码等敏感信息。",
    "知识片段前的方括号编号是引用编号。关键事实后必须标注对应编号，例如[1]。",
    "如果来源提供了页码、幻灯片或视频时间，必须在正文或参考中保留精确位置，例如[1，第 6 页]、[2，幻灯片 9]、[3，00:02:10–00:02:24]。",
    "最后用“参考：原始文件名｜精确位置”列出真正用到的来源，不要把引用证据 Markdown 文件当作原始来源。",
  ].join("\n");

  if (AI_PROVIDER === "openai-responses") {
    return callResponsesApi(question, results, instructions, knowledgeContext, history);
  }

  return callChatCompletionsApi(question, results, instructions, knowledgeContext, history);
}

function buildOrganizationInstructions(mode) {
  const modeNames = {
    project: "项目资料",
    faq: "FAQ",
    sop: "SOP",
    analysis: "项目分析",
    mixed: "综合整理",
  };
  return [
    "你是公司的本地知识库整理助手。",
    "任务是把用户上传的原始资料整理成适合写入 Obsidian 的 Markdown 文档。",
    `本次整理类型：${modeNames[mode] || "综合整理"}。`,
    "要求：",
    "1. 只根据上传资料整理，不要编造事实。",
    "2. 保留业务上有用的信息：项目需求、客户信息、执行流程、风险、待确认事项、FAQ、SOP。",
    "3. 如果资料不足，要明确标注“资料不足/待确认”。",
    "4. 不要输出手机号、验证码、账号密码、订单号等敏感信息。",
    "5. 使用清晰的 Markdown 标题和列表，方便后续在 Obsidian 中继续编辑。",
    "6. 最后加一节“来源文件”，列出用到的上传文件名。",
  ].join("\n");
}

async function callOrganizationApi({ project, mode, documents }) {
  if (!AI_API_KEY) {
    throw new Error("未配置 AI_API_KEY，无法自动整理资料。");
  }

  const sourceText = documents
    .map((document, index) => {
      return [
        `# 来源 ${index + 1}：${document.fileName}`,
        document.content,
      ].join("\n\n");
    })
    .join("\n\n---\n\n")
    .slice(0, 48_000);

  const apiResponse = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: buildOrganizationInstructions(mode) },
        {
          role: "user",
          content: [
            `项目名称：${project}`,
            "",
            "请把下面资料整理成一份可直接存入公司 Obsidian 知识库的 Markdown 文档：",
            "",
            sourceText || "资料为空。",
          ].join("\n"),
        },
      ],
      temperature: 0.2,
    }),
  });

  const payload = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    throw new Error(payload.error?.message || `AI 接口请求失败：${apiResponse.status}`);
  }

  const text = extractChatCompletionText(payload);
  if (!text) {
    throw new Error("AI 没有返回可写入的整理内容。");
  }
  return text;
}

function parseExtractorProgressLine(line) {
  const text = String(line || "").trim();
  if (!text) {
    return null;
  }
  try {
    const payload = JSON.parse(text);
    if (payload?.type === "progress") {
      return payload;
    }
  } catch {
    return null;
  }
  return null;
}

function runFileExtractor(filePath, assetsDir, onProgress = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PARSER_PYTHON_CMD,
      [FILE_EXTRACTOR_SCRIPT, filePath, "--assets-dir", assetsDir],
      {
      cwd: __dirname,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";
    let stderrDiagnostic = "";
    let stderrBuffer = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        const event = parseExtractorProgressLine(line);
        if (event) {
          if (onProgress) {
            onProgress(event);
          }
          continue;
        }
        stderrDiagnostic += `${line}\n`;
      }
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const pendingEvent = parseExtractorProgressLine(stderrBuffer);
      if (pendingEvent) {
        if (onProgress) {
          onProgress(pendingEvent);
        }
      } else if (stderrBuffer.trim()) {
        stderrDiagnostic += `${stderrBuffer}\n`;
      }
      let payload;
      try {
        payload = JSON.parse(stdout || "{}");
      } catch {
        reject(new Error(`文件解析器返回了无法读取的结果：${stderrDiagnostic || stdout}`));
        return;
      }

      if (code !== 0 || !payload.ok) {
        reject(new Error(payload.error || stderrDiagnostic || `文件解析失败：${filePath}`));
        return;
      }
      resolve(payload);
    });
  });
}

function getImageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  return "image/jpeg";
}

function buildVisualAnalysisPrompt(fileName, assets, batchIndex, totalBatches) {
  const labels = assets.map((asset, index) => `${index + 1}. ${asset.label}`).join("\n");
  return [
    `你正在分析公司知识库文件《${fileName}》的视觉素材。`,
    `当前为第 ${batchIndex}/${totalBatches} 批。`,
    "请逐项理解画面，而不是只抄写可见文字。重点识别：",
    "1. 页面或画面的主题、人物、对象、场景与相互关系；",
    "2. 图表标题、指标、横纵轴、数据系列、变化趋势、峰值、异常点和可支持的结论；",
    "3. 流程图、组织图、表格和版面结构所表达的业务逻辑；",
    "4. 视频画面中的动作、场景变化、演示内容和关键事件；",
    "5. 模糊、遮挡或无法确认之处必须标记为“待确认”，不得猜测。",
    "请使用中文 Markdown 输出，每项以对应标签为三级标题，并分成“画面内容”“业务信息”“关键发现”“待确认”四部分。没有内容的部分可省略。",
    "本批素材标签：",
    labels,
  ].join("\n");
}

async function analyzeVisualBatch(fileName, assets, batchIndex, totalBatches) {
  const content = [
    {
      type: "text",
      text: buildVisualAnalysisPrompt(fileName, assets, batchIndex, totalBatches),
    },
  ];

  for (const asset of assets) {
    const imageBuffer = await readFile(asset.path);
    content.push({ type: "text", text: `视觉素材：${asset.label}` });
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${getImageMimeType(asset.path)};base64,${imageBuffer.toString("base64")}`,
      },
    });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const apiResponse = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_VISION_MODEL,
        messages: [{ role: "user", content }],
        stream: false,
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    const payload = await apiResponse.json().catch(() => ({}));
    if (apiResponse.ok) {
      return extractChatCompletionText(payload);
    }
    lastError = new Error(
      payload.error?.message || `多模态接口请求失败：${apiResponse.status}`
    );
    if (![408, 429, 500, 502, 503, 504].includes(apiResponse.status) || attempt === 3) {
      break;
    }
    await wait(600 * (2 ** (attempt - 1)));
  }
  throw lastError || new Error("多模态接口请求失败。");
}

async function analyzeVisualAssets(fileName, visualAssets = [], onProgress = null) {
  if (!visualAssets.length) {
    return "";
  }
  if (!AI_API_KEY) {
    return "多模态视觉理解未执行：尚未配置 AI_API_KEY。";
  }

  const batches = [];
  for (let index = 0; index < visualAssets.length; index += VISION_BATCH_SIZE) {
    batches.push(visualAssets.slice(index, index + VISION_BATCH_SIZE));
  }

  const analyses = [];
  for (const [index, batch] of batches.entries()) {
    onProgress?.({
      phase: "多模态画面理解",
      progress: Math.round(((index + 0.2) / batches.length) * 100),
      detail: `${index + 1}/${batches.length} 批`,
    });
    try {
      const analysis = await analyzeVisualBatch(fileName, batch, index + 1, batches.length);
      if (analysis) {
        analyses.push(analysis);
      }
    } catch (error) {
      analyses.push(
        `### 第 ${index + 1} 批视觉素材\n\n多模态理解失败，已保留本地文字提取结果。错误：${error.message}`
      );
    }
  }
  return analyses.join("\n\n---\n\n");
}

function getExtractedFileName(filePath) {
  const parsed = path.parse(filePath);
  return `${parsed.name}_解析结果.md`;
}

async function loadUploadedDocuments(savedFiles, spaceRoot, onProgress = null) {
  const documents = [];
  const totalFiles = Math.max(1, savedFiles.length);
  for (const [index, filePath] of savedFiles.entries()) {
    const fileName = path.basename(filePath);
    onProgress?.({
      fileName,
      fileIndex: index + 1,
      totalFiles,
      phase: `解析文件 ${index + 1}/${totalFiles}`,
      progress: 0,
    });
    const assetsDir = path.join(DATA_DIR, "temp", `visual_${randomUUID()}`);
    await mkdir(assetsDir, { recursive: true });
    let parsed;
    let visualAnalysis = "";
    try {
      parsed = await runFileExtractor(filePath, assetsDir, (event) => {
        onProgress?.({
          ...event,
          progress: Math.round(Number(event.progress || 0) * 0.65),
          fileName,
          fileIndex: index + 1,
          totalFiles,
        });
      });
      visualAnalysis = await analyzeVisualAssets(
        fileName,
        parsed.visualAssets || [],
        (event) => {
        onProgress?.({
          ...event,
          progress: 66 + Math.round(Number(event.progress || 0) * 0.32),
          fileName,
            fileIndex: index + 1,
            totalFiles,
          });
        }
      );
    } finally {
      await rm(assetsDir, { recursive: true, force: true });
    }
    const extractedPath = path.join(path.dirname(filePath), getExtractedFileName(filePath));
    const extractedContent = [
      `# ${path.basename(filePath)} 解析结果`,
      "",
      `- 原文件：${path.relative(spaceRoot, filePath)}`,
      `- 文件类型：${parsed.extension}`,
      `- 提取字符数：${parsed.characters}`,
      "",
      "## 提取内容",
      "",
      parsed.content || "未提取到可读文字。",
      "",
      "## 多模态视觉理解",
      "",
      visualAnalysis || "该文件没有需要视觉理解的页面或画面。",
      "",
    ].join("\n");
    await writeFile(extractedPath, extractedContent, "utf8");
    documents.push({
      fileName: path.basename(filePath),
      relativePath: path.relative(spaceRoot, filePath),
      extension: parsed.extension,
      extractedPath,
      content: [
        visualAnalysis ? `## 多模态视觉理解\n\n${visualAnalysis}` : "",
        parsed.content ? `## 本地提取文字\n\n${parsed.content}` : "",
      ].filter(Boolean).join("\n\n"),
    });
    onProgress?.({
      fileName,
      fileIndex: index + 1,
      totalFiles,
      phase: `文件 ${index + 1}/${totalFiles} 已解析`,
      progress: 100,
    });
  }
  return documents;
}

function getOutputFileName(project, outputName) {
  const trimmed = String(outputName || "").trim();
  if (trimmed) {
    const safeName = safePathSegment(trimmed);
    return safeName.toLowerCase().endsWith(".md") ? safeName : `${safeName}.md`;
  }

  const date = new Date().toISOString().slice(0, 10);
  return `${safePathSegment(project)}_资料整理_${date}.md`;
}

function createSessionId() {
  return `chat_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeSessionId(value) {
  return safePathSegment(value || createSessionId()).slice(0, 120);
}

function getChatSessionPath(spaceId, sessionId) {
  const paths = getSpacePaths(spaceId);
  return path.join(paths.chatDir, `${normalizeSessionId(sessionId)}.json`);
}

function createEmptySession(spaceId, title = "新对话", ownerId = "") {
  const now = new Date().toISOString();
  return {
    id: createSessionId(),
    space: normalizeSpaceId(spaceId),
    ownerId,
    title: String(title || "新对话").trim().slice(0, 40) || "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

async function readChatSession(spaceId, sessionId) {
  await ensureKnowledgeBase(spaceId);
  if (PERSISTENCE.enabled) {
    return PERSISTENCE.readChatSession(normalizeSpaceId(spaceId), normalizeSessionId(sessionId));
  }
  const sessionPath = getChatSessionPath(spaceId, sessionId);
  try {
    const content = await readFile(sessionPath, "utf8");
    const session = JSON.parse(content);
    return {
      ...session,
      id: normalizeSessionId(session.id || sessionId),
      space: normalizeSpaceId(session.space || spaceId),
      messages: Array.isArray(session.messages) ? session.messages : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeChatSession(spaceId, session) {
  const paths = await ensureKnowledgeBase(spaceId);
  const normalizedSession = {
    ...session,
    id: normalizeSessionId(session.id),
    space: normalizeSpaceId(spaceId),
    updatedAt: new Date().toISOString(),
    messages: Array.isArray(session.messages) ? session.messages : [],
  };
  const sessionPath = path.join(paths.chatDir, `${normalizedSession.id}.json`);
  await writeFile(sessionPath, JSON.stringify(normalizedSession, null, 2), "utf8");
  await PERSISTENCE.writeChatSession(normalizedSession);
  return normalizedSession;
}

async function listChatSessions(spaceId = DEFAULT_SPACE_ID, user = null) {
  if (PERSISTENCE.enabled) {
    return PERSISTENCE.listChatSessions(
      normalizeSpaceId(spaceId),
      user?.id || "",
      user?.role === "admin"
    );
  }
  const paths = await ensureKnowledgeBase(spaceId);
  const entries = await readdir(paths.chatDir, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
      continue;
    }
    try {
      const content = await readFile(path.join(paths.chatDir, entry.name), "utf8");
      const session = JSON.parse(content);
      if (user && session.ownerId !== user.id && !(user.role === "admin" && !session.ownerId)) {
        continue;
      }
      sessions.push({
        id: normalizeSessionId(session.id || path.basename(entry.name, ".json")),
        title: session.title || "未命名对话",
        createdAt: session.createdAt || "",
        updatedAt: session.updatedAt || "",
        messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      });
    } catch {
      // Ignore broken session files so one damaged history does not block the app.
    }
  }
  return sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function buildSessionTitle(question) {
  return String(question || "新对话")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28) || "新对话";
}

async function handleListChatSessions(request, response) {
  const user = request.authUser;
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  if (!userCanAccessSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    sendJson(response, 200, {
      ok: true,
      space,
      sessions: await listChatSessions(space, user),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "读取历史对话失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleGetChatSession(request, response) {
  const user = request.authUser;
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  const sessionId = normalizeSessionId(requestUrl.searchParams.get("session") || "");
  if (!userCanAccessSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    const session = await readChatSession(space, sessionId);
    if (!session) {
      sendJson(response, 404, { error: "没有找到这个历史对话" });
      return;
    }
    if (session.ownerId !== user.id && !(user.role === "admin" && !session.ownerId)) {
      sendForbidden(response, "这个历史对话不属于当前账号");
      return;
    }
    sendJson(response, 200, { ok: true, session });
  } catch (error) {
    sendJson(response, 500, {
      error: "读取历史对话失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCreateChatSession(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  if (!userCanAccessSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    const session = await writeChatSession(
      space,
      createEmptySession(space, payload.title || "新对话", user.id)
    );
    sendJson(response, 200, { ok: true, session });
  } catch (error) {
    sendJson(response, 500, {
      error: "新建对话失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const MODE_LABELS = {
  project: "\u9879\u76ee\u8d44\u6599",
  faq: "FAQ",
  sop: "SOP",
  analysis: "\u9879\u76ee\u5206\u6790",
  mixed: "\u7efc\u5408\u6574\u7406",
};

const METADATA_FALLBACK = "\u5f85\u8865\u5145";

function cleanMetadataValue(value) {
  return String(value || "")
    .replace(/^[\s\-*#|]+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetadataLine(content, labels) {
  const labelPattern = labels.join("|");
  const matcher = new RegExp(`(?:^|\\n)\\s*[-|]?\\s*(?:\\*\\*)?(?:${labelPattern})(?:\\*\\*)?\\s*[\uff1a:]\\s*([^\\n|]+)`);
  const match = content.match(matcher);
  return match ? cleanMetadataValue(match[1]) : "";
}

function extractCoreTheme(content) {
  return extractMetadataLine(content, [
    "\u6838\u5fc3\u4e3b\u5f20",
    "\u6838\u5fc3\u9700\u6c42",
    "\u6838\u5fc3\u7b56\u7565",
    "\u6838\u5fc3\u4e3b\u9898",
    "\u6838\u5fc3\u8d2d\u4e70\u7406\u7531",
    "\u6838\u5fc3\u5b9a\u4f4d",
  ]);
}

function extractTimeRange(content) {
  const explicit = extractMetadataLine(content, [
    "\u8425\u9500\u65f6\u95f4",
    "\u65f6\u95f4\u8303\u56f4",
    "\u9879\u76ee\u65f6\u95f4",
    "\u5173\u952e\u8282\u70b9",
    "\u65f6\u95f4",
  ]);
  if (explicit) {
    return explicit;
  }

  const match = content.match(/(?:\d{4}\u5e74)?\d{1,2}\u6708\d{1,2}\u65e5\s*[-\u81f3\u5230\u2013\u2014]\s*(?:\d{4}\u5e74)?\d{1,2}\u6708\d{1,2}\u65e5/);
  return match ? match[0] : "";
}

function getMatchedAliasGroup(project, content, aliasGroups) {
  const target = normalizeText(`${project}\n${content.slice(0, 5000)}`);
  return aliasGroups.find((group) => {
    const terms = [group.canonical, ...(Array.isArray(group.aliases) ? group.aliases : [])]
      .filter(Boolean)
      .map((term) => normalizeText(term));
    return terms.some((term) => term && target.includes(term));
  });
}

function extractKeywords({ project, content, aliasGroup }) {
  const keywords = new Set();
  keywords.add(project);
  if (aliasGroup?.canonical) {
    keywords.add(aliasGroup.canonical);
  }
  for (const alias of aliasGroup?.aliases || []) {
    keywords.add(alias);
  }

  const coreTheme = extractCoreTheme(content);
  for (const term of coreTheme.split(/[\uff0c,\u3001\s=\u2192-]+/)) {
    const cleaned = cleanMetadataValue(term);
    if (cleaned.length >= 2 && cleaned.length <= 12) {
      keywords.add(cleaned);
    }
  }

  return Array.from(keywords).filter(Boolean).slice(0, 12);
}

function buildMetadataBlock({ project, mode, content, savedFiles, aliasGroups }) {
  const aliasGroup = getMatchedAliasGroup(project, content, aliasGroups);
  const aliases = aliasGroup?.aliases || [];
  const customer = extractMetadataLine(content, [
    "\u54c1\u724c/\u5ba2\u6237",
    "\u5ba2\u6237",
    "\u54c1\u724c",
  ]) || METADATA_FALLBACK;
  const coreTheme = extractCoreTheme(content) || METADATA_FALLBACK;
  const timeRange = extractTimeRange(content) || METADATA_FALLBACK;
  const keywords = extractKeywords({ project, content, aliasGroup });
  const sourceFiles = savedFiles.map((filePath) => path.basename(filePath));

  return [
    "## \u8d44\u6599\u5143\u4fe1\u606f",
    "",
    `- \u9879\u76ee\u540d\uff1a${project}`,
    `- \u522b\u540d\uff1a${aliases.length ? aliases.join("\u3001") : METADATA_FALLBACK}`,
    `- \u5ba2\u6237\uff1a${customer}`,
    `- \u8d44\u6599\u7c7b\u578b\uff1a${MODE_LABELS[mode] || mode || MODE_LABELS.mixed}`,
    `- \u5173\u952e\u8bcd\uff1a${keywords.length ? keywords.join("\u3001") : METADATA_FALLBACK}`,
    `- \u6838\u5fc3\u4e3b\u9898\uff1a${coreTheme}`,
    `- \u65f6\u95f4\u8303\u56f4\uff1a${timeRange}`,
    "- \u6765\u6e90\u6587\u4ef6\uff1a",
    ...sourceFiles.map((fileName) => `  - ${fileName}`),
    "",
  ].join("\n");
}

function getCitationEvidencePath(paths, sourcePath, sourceFile) {
  const identity = String(sourcePath || sourceFile || "unknown").replace(/\\/g, "/").toLowerCase();
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  const baseName = safePathSegment(path.parse(sourceFile || "未知文件").name).slice(0, 80);
  return path.join(paths.citationDir, `${baseName}_引用证据_${digest}.md`);
}

async function writeCitationEvidenceDocument(paths, document, project) {
  const sourceFile = document.fileName || path.basename(document.relativePath || "未知文件");
  const sourcePath = String(document.relativePath || sourceFile).replace(/\\/g, "/");
  const sourceType = String(document.extension || path.extname(sourceFile)).toLowerCase();
  const evidenceContent = buildCitationEvidence({
    project,
    sourceFile,
    sourcePath,
    sourceType,
    content: document.content,
  });
  const evidencePath = getCitationEvidencePath(paths, sourcePath, sourceFile);
  const existing = await readKnowledgeText(evidencePath).catch(() => "");
  if (existing !== evidenceContent) {
    await writeKnowledgeText(evidencePath, evidenceContent);
  }
  return evidencePath;
}

async function syncExistingCitationEvidence(spaceId) {
  const paths = await ensureKnowledgeBase(spaceId);
  const parsedFiles = (await listFilesRecursive(paths.rawDir, new Set([".md"])))
    .filter((filePath) => filePath.endsWith("_解析结果.md"));
  let created = 0;
  for (const parsedPath of parsedFiles) {
    const parsedContent = await readFile(parsedPath, "utf8").catch(() => "");
    if (!parsedContent) continue;
    const sourcePath = parsedContent.match(/^\s*-\s*原文件[：:]\s*(.+)$/mu)?.[1]?.trim() || "";
    if (!sourcePath) continue;
    const sourceType = parsedContent.match(/^\s*-\s*文件类型[：:]\s*(.+)$/mu)?.[1]?.trim() || path.extname(sourcePath);
    const evidencePath = await writeCitationEvidenceDocument(paths, {
      fileName: path.basename(sourcePath),
      relativePath: sourcePath,
      extension: sourceType,
      content: parsedContent,
    }, path.basename(path.dirname(parsedPath)));
    if (evidencePath) created += 1;
  }
  return created;
}

async function writeKnowledgeOutput({ spaceId, project, mode, outputName, savedFiles, documents, content }) {
  const paths = await ensureKnowledgeBase(spaceId);

  const outputFileName = getOutputFileName(project, outputName);
  const outputPath = path.join(paths.knowledgeDir, outputFileName);
  const createdAt = new Date().toISOString();
  const aliasGroups = await loadProjectAliases(paths);
  const metadataBlock = buildMetadataBlock({
    project,
    mode,
    content,
    savedFiles,
    aliasGroups,
  });
  const sourceList = savedFiles
    .map((filePath) => `- ${path.relative(paths.root, filePath)}`)
    .join("\n");
  const finalContent = [
    "---",
    `project: ${project}`,
    `mode: ${mode}`,
    `created: ${createdAt}`,
    "source: web-upload",
    "---",
    "",
    metadataBlock,
    "",
    content.trim(),
    "",
    "## 系统入库信息",
    "",
    sourceList,
    "",
  ].join("\n");

  await writeKnowledgeText(outputPath, finalContent);
  const citationFiles = [];
  for (const document of documents || []) {
    citationFiles.push(await writeCitationEvidenceDocument(paths, document, project));
  }

  const logPath = path.join(
    paths.updateLogDir,
    `web_import_${createdAt.replace(/[-:.]/g, "").replace("T", "_").replace("Z", "")}.json`
  );
  await writeFile(
    logPath,
    JSON.stringify({
      project,
      mode,
      outputPath,
      sourceFiles: savedFiles,
      citationFiles,
      model: AI_MODEL,
      createdAt,
    }, null, 2),
    "utf8"
  );

  await appendFile(
    paths.importIndex,
    [
      `## ${createdAt} ${project}`,
      "",
      `- 整理类型：${mode}`,
      `- 输出文件：${path.relative(paths.root, outputPath)}`,
      `- 更新日志：${path.relative(paths.root, logPath)}`,
      "- 来源文件：",
      sourceList,
      "",
    ].join("\n"),
    "utf8"
  );

  return { outputPath, logPath, citationFiles };
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

async function loadProjectAliases(paths) {
  const aliasPath = path.join(paths.systemDir, "project_aliases.json");
  try {
    const content = await readFile(aliasPath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? [...DEFAULT_PROJECT_ALIASES, ...parsed] : DEFAULT_PROJECT_ALIASES;
  } catch (error) {
    if (error.code === "ENOENT") {
      return DEFAULT_PROJECT_ALIASES;
    }
    console.warn(`Failed to read project aliases: ${error.message}`);
    return DEFAULT_PROJECT_ALIASES;
  }
}

function expandQuestionWithAliases(question, aliasGroups = []) {
  const normalizedQuestion = normalizeText(question);
  const expanded = [question];

  for (const group of aliasGroups) {
    const canonical = String(group.canonical || "").trim();
    const aliases = Array.isArray(group.aliases) ? group.aliases : [];
    const terms = [canonical, ...aliases].filter(Boolean);
    const hasMatch = terms.some((term) => normalizedQuestion.includes(normalizeText(term)));
    if (hasMatch) {
      expanded.push(canonical, ...aliases);
    }
  }

  return Array.from(new Set(expanded)).join(" ");
}

function scoreAliasMatch(content, fileName, question, aliasGroups = []) {
  const normalizedQuestion = normalizeText(question);
  const normalizedTarget = normalizeText(`${fileName}\n${stripLowValueSections(content).slice(0, 4000)}`);
  let score = 0;

  for (const group of aliasGroups) {
    const canonical = String(group.canonical || "").trim();
    const aliases = Array.isArray(group.aliases) ? group.aliases : [];
    const terms = [canonical, ...aliases].filter(Boolean);
    const questionHit = terms.some((term) => normalizedQuestion.includes(normalizeText(term)));
    if (!questionHit) {
      continue;
    }

    const targetHits = terms.filter((term) => normalizedTarget.includes(normalizeText(term))).length;
    if (targetHits > 0) {
      score += 120 + targetHits * 24;
    }
  }

  return score;
}

function hasExplicitProjectReference(question, aliasGroups = []) {
  const normalizedQuestion = normalizeText(question);
  return aliasGroups.some((group) => {
    const terms = [group.canonical, ...(Array.isArray(group.aliases) ? group.aliases : [])]
      .filter(Boolean)
      .map((term) => normalizeText(term));
    return terms.some((term) => term && normalizedQuestion.includes(term));
  });
}

function tokenize(question) {
  let normalized = normalizeText(question);
  for (const stopWord of PROJECT_STOP_WORDS) {
    normalized = normalized.replaceAll(stopWord, " ");
  }
  normalized = normalized.replace(/\s+/g, " ").trim();
  const latinTokens = normalized.split(/\s+/).filter((word) => word.length >= 2);
  const chineseTokens = Array.from(normalized.matchAll(/[\p{Script=Han}]{2,}/gu))
    .flatMap((match) => {
      const value = match[0];
      const words = [value];
      for (let size = 2; size <= Math.min(4, value.length); size += 1) {
        for (let index = 0; index <= value.length - size; index += 1) {
          words.push(value.slice(index, index + size));
        }
      }
      return words;
    });
  const uniqueTokens = Array.from(new Set([...latinTokens, ...chineseTokens]));
  const businessTokens = uniqueTokens.filter(
    (token) => !PROJECT_STOP_WORDS.has(token)
  );
  return businessTokens.length > 0 ? businessTokens : uniqueTokens;
}

function stripLowValueSections(content) {
  const lines = content.split(/\r?\n/);
  const usefulLines = [];
  let skippingYaml = lines[0]?.trim() === "---";
  let skippingSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (skippingYaml) {
      if (index > 0 && trimmed === "---") {
        skippingYaml = false;
      }
      continue;
    }

    if (/^##\s*(来源文件|系统入库信息)\s*$/.test(trimmed)) {
      skippingSection = true;
      continue;
    }

    if (skippingSection && /^##\s+/.test(trimmed)) {
      skippingSection = false;
    }

    if (!skippingSection) {
      usefulLines.push(line);
    }
  }

  return usefulLines.join("\n").trim();
}

function buildLeadSnippet(content) {
  const lines = stripLowValueSections(content)
    .split(/\r?\n/)
    .filter((line) => line.trim());

  return lines.slice(0, 34).join("\n").slice(0, 1800);
}

function classifyQuestionIntent(question) {
  if (/时间|节点|排期|roadmap|日程|阶段|什么时候|几号|周期/.test(question)) {
    return "timeline";
  }
  if (/最核心|核心是什么|核心内容|核心主张|关键是什么|重点|主线|策略|洞察/.test(question)) {
    return "core";
  }
  if (/怎么做|如何做|流程|步骤|sop|处理|操作|上传|执行/.test(question)) {
    return "process";
  }
  if (/风险|问题|隐患|注意|待确认|不确定|异常/.test(question)) {
    return "risk";
  }
  if (/什么内容|哪些内容|主要内容|文件里|讲了什么|总结一下|概括|概览/.test(question)) {
    return "overview";
  }
  return "general";
}

const INTENT_SECTION_PATTERNS = {
  timeline: /时间|节点|排期|roadmap|日程|阶段|营销时间|关键节点/i,
  core: /项目概述|核心主张|核心策略|营销洞察|创意营销策略|核心内容|核心定位|主线/i,
  process: /sop|流程|步骤|执行|处理动作|操作|关键动作|核心营销动作/i,
  risk: /风险|问题|隐患|注意|待确认|不确定|异常|资料缺口/i,
};

function isOverviewQuestion(question) {
  return /什么内容|哪些内容|主要内容|文件里|讲了什么|总结一下|概括|概览/.test(question);
}

function isBroadIntentQuestion(question) {
  return /什么内容|哪些内容|主要内容|文件里|讲了什么|总结一下|概括|概览|最核心|核心是什么|核心内容|关键是什么/.test(question);
}

function sliceSection(lines, start, maxLines = 34) {
  let end = Math.min(lines.length, start + maxLines);
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{2}\s+/.test(lines[index])) {
      end = Math.min(index, start + maxLines);
      break;
    }
  }
  return lines
    .slice(start, end)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 1800);
}

function buildIntentSnippet(content, intent) {
  const pattern = INTENT_SECTION_PATTERNS[intent];
  if (!pattern) {
    return "";
  }

  const lines = stripLowValueSections(content).split(/\r?\n/);
  const hitIndex = lines.findIndex((line) => /^#{1,4}\s+/.test(line) && pattern.test(line));
  if (hitIndex === -1) {
    return "";
  }

  return sliceSection(lines, hitIndex);
}

function buildKeywordSnippet(content, tokens) {
  const searchableContent = stripLowValueSections(content);
  const lines = searchableContent.split(/\r?\n/);
  let hitIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lowerLine = lines[index].toLowerCase();
    const lineScore = tokens.reduce((score, token) => {
      return lowerLine.includes(token) ? score + Math.min(token.length, 10) : score;
    }, 0);
    const headingBonus = /^#{2,4}\s+/.test(lines[index]) ? 12 : 0;
    if (lineScore + headingBonus > bestScore) {
      bestScore = lineScore + headingBonus;
      hitIndex = index;
    }
  }

  if (hitIndex === -1) {
    return "";
  }

  let start = Math.max(0, hitIndex - 3);
  for (let index = hitIndex; index >= 0; index -= 1) {
    if (/^#{2,3}\s+/.test(lines[index])) {
      start = index;
      break;
    }
  }

  return sliceSection(lines, start);
}

function buildPreciseCitationSnippet(content, tokens, metadata) {
  const lines = stripLowValueSections(content).split(/\r?\n/);
  let hitIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lowerLine = lines[index].toLowerCase();
    const score = tokens.reduce(
      (total, token) => total + (lowerLine.includes(token) ? Math.min(token.length, 10) : 0),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      hitIndex = index;
    }
  }
  if (hitIndex < 0) return "";

  const sourceType = String(metadata.source_type || "").toLowerCase();
  const locatorPattern = sourceType === ".pdf"
    ? /^#{1,4}\s*第\s*\d+\s*页(?:\s|$)/
    : [".ppt", ".pptx"].includes(sourceType)
      ? /^#{1,4}\s*幻灯片\s*\d+(?:\s|$)/
      : /^(?:#{1,4}\s*(?:视频时间\s*)?\d{2}:\d{2}:\d{2}|-\s*\d{2}:\d{2}:\d{2}\s*[-–—至到])/;

  let start = hitIndex;
  for (let index = hitIndex; index >= 0; index -= 1) {
    if (locatorPattern.test(lines[index].trim())) {
      start = index;
      break;
    }
  }
  let end = Math.min(lines.length, start + 18);
  for (let index = start + 1; index < end; index += 1) {
    if (locatorPattern.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim().slice(0, 1800);
}

function mergeSnippets(snippets) {
  const merged = [];
  const seen = new Set();

  for (const snippet of snippets) {
    const cleaned = String(snippet || "").trim();
    if (!cleaned) {
      continue;
    }
    const key = normalizeText(cleaned.slice(0, 160));
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(cleaned);
  }

  return merged
    .map((snippet, index) => `### 片段 ${index + 1}\n${snippet}`)
    .join("\n\n")
    .slice(0, 3600);
}

function buildSnippet(content, tokens, question = "", intent = "general") {
  const leadSnippet = buildLeadSnippet(content);
  const intentSnippet = buildIntentSnippet(content, intent);
  const keywordSnippet = buildKeywordSnippet(content, tokens);
  const metadata = readCitationMetadata(content);
  const isCitationEvidence = metadata.citation_evidence === true || metadata.citation_evidence === "true";

  if (isCitationEvidence) {
    const preciseSnippet = buildPreciseCitationSnippet(content, tokens, metadata);
    return mergeSnippets([preciseSnippet || keywordSnippet, intentSnippet]);
  }

  return mergeSnippets([leadSnippet, intentSnippet, keywordSnippet]) || leadSnippet;
}

function scoreDocument(content, fileName, tokens, question = "", aliasGroups = []) {
  const metadata = readCitationMetadata(content);
  const lowerContent = stripLowValueSections(content).toLowerCase();
  const lowerFileName = `${fileName} ${metadata.source_file || ""} ${metadata.project || ""}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contentCount = lowerContent.match(new RegExp(escaped, "g"))?.length || 0;
    const fileCount = lowerFileName.match(new RegExp(escaped, "g"))?.length || 0;
    score += contentCount * Math.min(token.length, 10);
    score += fileCount * Math.min(token.length, 10) * 4;
  }
  score += scoreAliasMatch(
    `${metadata.project || ""}\n${content}`,
    metadata.source_file || fileName,
    question,
    aliasGroups
  );
  return score;
}

function runVectorProcess(paths, command, query = "", force = false) {
  return new Promise((resolve, reject) => {
    const args = [
      VECTOR_SEARCH_SCRIPT,
      command,
      "--knowledge-dir",
      paths.knowledgeDir,
      "--index",
      paths.vectorIndex,
      "--model",
      VECTOR_MODEL,
      "--cache-dir",
      VECTOR_CACHE_DIR,
    ];
    if (query) {
      args.push("--query", query, "--limit", "16");
    }
    if (force) {
      args.push("--force");
    }
    const child = spawn(PARSER_PYTHON_CMD, args, {
      cwd: __dirname,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("向量索引处理超时"));
    }, command === "build" ? 15 * 60_000 : 4 * 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let payload = null;
      try {
        payload = JSON.parse(stdout.trim() || "{}");
      } catch {
        // The caller receives the original diagnostic below.
      }
      if (code === 0 && payload?.ok) {
        resolve(payload);
        return;
      }
      reject(new Error(payload?.error || stderr.trim() || stdout.trim() || "向量检索失败"));
    });
  });
}

async function createDecryptedVectorWorkspace(paths, command) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "resonator-vector-"));
  const temporaryKnowledgeDir = path.join(temporaryRoot, "knowledge");
  const temporaryIndex = path.join(temporaryRoot, "index.json");
  await mkdir(temporaryKnowledgeDir, { recursive: true });

  if (command === "build") {
    for (const sourcePath of await listMarkdownFiles(paths.knowledgeDir)) {
      const relativePath = path.relative(paths.knowledgeDir, sourcePath);
      const targetPath = path.join(temporaryKnowledgeDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, await readKnowledgeText(sourcePath), "utf8");
    }
  }

  if (await pathExists(paths.vectorIndex)) {
    const protectedIndex = await readFile(paths.vectorIndex);
    await writeFile(temporaryIndex, await decryptKnowledgeBuffer(protectedIndex));
  }

  return {
    temporaryRoot,
    paths: {
      ...paths,
      knowledgeDir: temporaryKnowledgeDir,
      vectorIndex: temporaryIndex,
    },
  };
}

async function runVectorCommand(paths, command, query = "", force = false) {
  if (!KNOWLEDGE_ENCRYPTION_ENABLED) {
    return runVectorProcess(paths, command, query, force);
  }

  const workspace = await createDecryptedVectorWorkspace(paths, command);
  try {
    const result = await runVectorProcess(workspace.paths, command, query, force);
    if (command === "build" && await pathExists(workspace.paths.vectorIndex)) {
      await writeProtectedFile(paths.vectorIndex, await readFile(workspace.paths.vectorIndex));
    }
    return result;
  } finally {
    await rm(workspace.temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function searchSemanticKnowledge(question, paths) {
  if (!VECTOR_ENABLED) {
    return [];
  }
  const cacheKey = `${paths.id}:${normalizeText(question)}`;
  const cached = vectorQueryCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < VECTOR_QUERY_CACHE_TTL_MS) {
    return cached.results;
  }
  try {
    const payload = await runVectorCommand(paths, "search", question);
    const results = payload.results || [];
    vectorQueryCache.set(cacheKey, { createdAt: Date.now(), results });
    if (vectorQueryCache.size > 200) {
      vectorQueryCache.delete(vectorQueryCache.keys().next().value);
    }
    return results;
  } catch (error) {
    const warningKey = `${paths.id}:${error.message}`;
    if (!vectorSearchWarnings.has(warningKey)) {
      vectorSearchWarnings.add(warningKey);
      console.warn(`向量检索暂不可用，已回退关键词检索：${error.message}`);
    }
    return [];
  }
}

function mergeHybridResults(keywordResults, semanticResults, question, aliasGroups) {
  const candidates = new Map();
  const maxKeywordScore = Math.max(...keywordResults.map((item) => item.score), 1);
  const requireProjectMatch = hasExplicitProjectReference(question, aliasGroups);
  const resultKey = (item) => String(item.relativePath || item.file || item.path)
    .replace(/\\/g, "/")
    .toLowerCase();

  keywordResults.forEach((item, rank) => {
    const key = resultKey(item);
    const citationContext = `${item.citationMetadata?.project || ""}\n${item.snippet || ""}`;
    const citationFile = item.citationMetadata?.source_file || item.file;
    candidates.set(key, {
      ...item,
      keywordScore: item.score,
      semanticScore: 0,
      retrieval: "关键词",
      hybridScore: 0.44 * (item.score / maxKeywordScore) + 0.12 / (rank + 1),
      semanticSnippets: [],
      projectMatch: scoreAliasMatch(citationContext, citationFile, question, aliasGroups) > 0,
    });
  });

  semanticResults.forEach((item, rank) => {
    const key = resultKey(item);
    const semanticScore = Math.max(0, Number(item.semanticScore || 0));
    const existing = candidates.get(key) || {
      ...item,
      file: item.file,
      path: item.path,
      relativePath: item.relativePath || item.file,
      score: 0,
      keywordScore: 0,
      semanticScore: 0,
      retrieval: "语义",
      hybridScore: 0,
      snippet: "",
      semanticSnippets: [],
      projectMatch: false,
    };
    existing.sourceFile ||= item.sourceFile || "";
    existing.sourcePath ||= item.sourcePath || "";
    existing.sourceType ||= item.sourceType || "";
    existing.project ||= item.project || "";
    existing.locations = [
      ...(Array.isArray(existing.locations) ? existing.locations : []),
      ...(Array.isArray(item.locations) ? item.locations : []),
    ];
    existing.semanticScore = Math.max(existing.semanticScore, semanticScore);
    existing.hybridScore += 0.48 * semanticScore + 0.1 / (rank + 1);
    existing.retrieval = existing.keywordScore > 0 ? "混合" : "语义";
    if (item.text && !existing.semanticSnippets.includes(item.text)) {
      existing.semanticSnippets.push(item.text);
    }
    existing.projectMatch = existing.projectMatch || scoreAliasMatch(
      `${item.project || ""}\n${item.text || ""}`,
      item.sourceFile || item.file,
      question,
      aliasGroups
    ) > 0;
    candidates.set(key, existing);
  });

  return Array.from(candidates.values())
    .map((item) => decorateCitation({
      ...item,
      score: Math.round(item.hybridScore * 1000),
      snippet: mergeSnippets([
        ...item.semanticSnippets.slice(0, 3),
        item.snippet,
      ]),
    }))
    .filter((item) => (item.keywordScore > 0 || item.semanticScore >= 0.36) && (!requireProjectMatch || item.projectMatch))
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, 5);
}

async function listMarkdownFiles(directory) {
  return listFilesRecursive(directory, new Set([".md"]));
}

async function searchKnowledge(question, spaceId = DEFAULT_SPACE_ID) {
  const paths = await ensureKnowledgeBase(spaceId);
  const aliasGroups = await loadProjectAliases(paths);
  const expandedQuestion = expandQuestionWithAliases(question, aliasGroups);
  const intent = classifyQuestionIntent(question);
  const tokens = tokenize(expandedQuestion);

  const files = await listMarkdownFiles(paths.knowledgeDir);
  const keywordResults = [];
  for (const filePath of files) {
    const content = await readKnowledgeText(filePath);
    const fileName = path.basename(filePath);
    const score = scoreDocument(content, fileName, tokens, question, aliasGroups);
    if (score > 0) {
      keywordResults.push({
        file: fileName,
        path: filePath,
        relativePath: path.relative(paths.knowledgeDir, filePath),
        score,
        snippet: buildSnippet(content, tokens, question, intent),
        citationMetadata: readCitationMetadata(content),
      });
    }
  }
  keywordResults.sort((a, b) => b.score - a.score);
  const semanticResults = (await searchSemanticKnowledge(expandedQuestion, paths)).map((item) => ({
    ...item,
    path: path.join(paths.knowledgeDir, item.relativePath || item.file),
  }));
  return mergeHybridResults(keywordResults.slice(0, 12), semanticResults, question, aliasGroups);
}

function buildDraftAnswer(question, results) {
  if (results.length === 0) {
    return [
      "我还没有在知识库里找到足够相关的内容。",
      "",
      "可以换一个更具体的问法，或者先把相关项目资料补进 90_AI输出。",
    ].join("\n");
  }

  const topFiles = results.map((item) => `《${item.file.replace(/\.md$/, "")}》`);
  return [
    "已从本地知识库找到相关资料。",
    "",
    `优先参考：${topFiles.join("、")}`,
    "",
    "当前版本先返回检索结果和引用片段；下一步接入 AI API 后，这里会生成完整自然语言回答。",
  ].join("\n");
}

async function handleAsk(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const question = String(payload.question || "").trim();
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  const requestedSessionId = payload.sessionId ? normalizeSessionId(payload.sessionId) : "";
  if (!question) {
    sendJson(response, 400, { error: "请输入问题" });
    return;
  }
  if (!userCanAccessSpace(user, space)) {
    sendForbidden(response);
    return;
  }

  try {
    let session = requestedSessionId
      ? await readChatSession(space, requestedSessionId)
      : null;
    if (!session) {
      session = createEmptySession(space, buildSessionTitle(question), user.id);
    } else if (session.ownerId !== user.id && !(user.role === "admin" && !session.ownerId)) {
      sendForbidden(response, "这个历史对话不属于当前账号");
      return;
    }
    session.ownerId = user.id;
    if (!session.title || session.title === "新对话") {
      session.title = buildSessionTitle(question);
    }

    const previousMessages = session.messages || [];
    const results = await searchKnowledge(question, space);
    const aiAnswer = await callAI(question, results, previousMessages);
    const answer = aiAnswer || buildDraftAnswer(question, results);
    const now = new Date().toISOString();
    session.messages = [
      ...previousMessages,
      {
        id: `${session.id}_u_${previousMessages.length + 1}`,
        role: "user",
        content: question,
        createdAt: now,
      },
      {
        id: `${session.id}_a_${previousMessages.length + 2}`,
        role: "assistant",
        content: answer,
        citations: results,
        mode: aiAnswer ? "ai" : "local-search",
        createdAt: new Date().toISOString(),
      },
    ].slice(-80);
    session = await writeChatSession(space, session);
    await appendAuditLog({ request, user, action: "ask", space, target: session.id });

    sendJson(response, 200, {
      answer,
      citations: results,
      mode: aiAnswer ? "ai" : "local-search",
      space,
      session,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "读取知识库失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readRequestJson(request, response) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      sendJson(response, 413, { error: "请求过大" });
      return null;
    }
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    sendJson(response, 400, { error: "请求格式不是有效 JSON" });
    return null;
  }
}

function runUpdateScript({ input, project, mode, outputName, dryRun }) {
  return new Promise((resolve, reject) => {
    const args = [
      UPDATE_SCRIPT,
      "--vault",
      VAULT_DIR,
      "--input",
      input,
      "--project",
      project,
      "--mode",
      mode,
    ];

    if (outputName) {
      args.push("--output-name", outputName);
    }
    if (dryRun) {
      args.push("--dry-run");
    }

    const child = spawn(PYTHON_CMD, args, {
      cwd: VAULT_DIR,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("知识库更新超时，请减少资料量后重试。"));
    }, 180_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `更新脚本退出码：${code}`));
    });
  });
}

async function handleUpdateKnowledge(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const project = String(payload.project || "梦星鸣潮").trim();
  const input = String(payload.input || DEFAULT_UPDATE_INPUT).trim();
  const mode = String(payload.mode || "mixed").trim();
  const outputName = String(payload.outputName || "").trim();
  const dryRun = Boolean(payload.dryRun);
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);

  if (user?.role !== "admin" || !isLocalRequest(request)) {
    sendForbidden(response, "旧版路径更新功能仅限部署电脑本机的超级管理员");
    return;
  }

  if (!project || !input) {
    sendJson(response, 400, { error: "项目名称和资料路径不能为空" });
    return;
  }

  if (!["project", "faq", "sop", "analysis", "mixed"].includes(mode)) {
    sendJson(response, 400, { error: "整理类型不支持" });
    return;
  }

  try {
    const result = await runUpdateScript({
      input,
      project,
      mode,
      outputName,
      dryRun,
    });
    sendJson(response, 200, {
      ok: true,
      dryRun,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "知识库更新失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readRequestBuffer(request, maxBytes = Infinity) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error("上传分片超过服务器约定大小");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseContentDisposition(value) {
  const result = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey || rawValue.length === 0) {
      continue;
    }
    const rawParameter = rawValue.join("=").trim().replace(/^"|"$/g, "");
    if (rawKey.endsWith("*")) {
      const key = rawKey.slice(0, -1);
      const encoded = rawParameter.replace(/^UTF-8''/i, "");
      result[key] = decodeURIComponent(encoded);
      continue;
    }
    result[rawKey] = rawParameter;
  }
  return result;
}

function parseMultipartForm(request, bodyBuffer) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    throw new Error("上传请求缺少 multipart boundary。");
  }

  const boundaryBuffer = Buffer.from(`--${boundary}`, "utf8");
  const headerSeparator = Buffer.from("\r\n\r\n", "utf8");
  const lineBreak = Buffer.from("\r\n", "utf8");
  const fields = {};
  const files = [];
  let cursor = bodyBuffer.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    cursor += boundaryBuffer.length;

    if (bodyBuffer[cursor] === 45 && bodyBuffer[cursor + 1] === 45) {
      break;
    }
    if (bodyBuffer[cursor] === 13 && bodyBuffer[cursor + 1] === 10) {
      cursor += 2;
    }

    const nextBoundary = bodyBuffer.indexOf(boundaryBuffer, cursor);
    if (nextBoundary === -1) {
      break;
    }

    let partEnd = nextBoundary;
    if (
      partEnd >= 2 &&
      bodyBuffer[partEnd - 2] === 13 &&
      bodyBuffer[partEnd - 1] === 10
    ) {
      partEnd -= 2;
    }

    const separatorIndex = bodyBuffer.indexOf(headerSeparator, cursor);
    if (separatorIndex === -1) {
      cursor = nextBoundary;
      continue;
    }
    if (separatorIndex > partEnd) {
      cursor = nextBoundary;
      continue;
    }

    const rawHeaders = bodyBuffer.slice(cursor, separatorIndex).toString("utf8");
    let content = bodyBuffer.slice(separatorIndex + headerSeparator.length, partEnd);
    if (
      content.length >= 2 &&
      content[content.length - 2] === lineBreak[0] &&
      content[content.length - 1] === lineBreak[1]
    ) {
      content = content.slice(0, -2);
    }

    const headers = Object.fromEntries(
      rawHeaders.split("\r\n").map((line) => {
        const index = line.indexOf(":");
        if (index === -1) {
          return ["", ""];
        }
        return [
          line.slice(0, index).trim().toLowerCase(),
          line.slice(index + 1).trim(),
        ];
      }).filter(([key]) => key)
    );
    const disposition = parseContentDisposition(headers["content-disposition"] || "");
    if (!disposition.name) {
      continue;
    }

    if (disposition.filename) {
      files.push({
        fieldName: disposition.name,
        fileName: disposition.filename,
        contentType: headers["content-type"] || "application/octet-stream",
        buffer: content,
      });
    } else {
      fields[disposition.name] = content.toString("utf8");
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

function safePathSegment(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f\uFFFD<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "未命名";
}

function getSafeUploadFileName(fileName) {
  const rawName = String(fileName || "未命名").split(/[\\/]/).pop() || "未命名";
  const extension = path.extname(rawName).toLowerCase();
  const stem = rawName.slice(0, Math.max(0, rawName.length - extension.length));
  const safeStem = safePathSegment(stem);
  const safeExtension = SUPPORTED_UPLOAD_EXTENSIONS.has(extension) ? extension : "";
  return `${safeStem}${safeExtension}`;
}

function validateUploadMetadata(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
    throw new Error("目前支持上传 md、txt、csv、Word、PDF、Excel、PPT、图片和常见视频文件。");
  }
}

function validateUploadFile(file) {
  validateUploadMetadata(file.fileName);
  if (file.buffer.length === 0) {
    throw new Error(`文件内容为空：${file.fileName}`);
  }
}

async function inspectUploadMetadata(spaceId, project, files) {
  const paths = await ensureKnowledgeBase(spaceId);
  const previewFolderName = `${safePathSegment(project)}_正式上传时自动生成时间目录`;
  const previewUploadDir = path.join(paths.uploadRoot, previewFolderName);

  const inspectedFiles = files.map((file) => {
    validateUploadMetadata(file.fileName || file.name);
    const fileName = getSafeUploadFileName(file.fileName || file.name);
    return {
      fileName,
      extension: path.extname(fileName).toLowerCase(),
      size: Number(file.size || file.buffer?.length || 0),
      previewPath: path.join(previewUploadDir, fileName),
    };
  });

  return {
    previewUploadDir,
    inspectedFiles,
    spaceRoot: paths.root,
  };
}

async function saveUploadedFiles(spaceId, project, files) {
  const paths = await ensureKnowledgeBase(spaceId);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  const folderName = `${timestamp}_${safePathSegment(project)}`;
  const uploadDir = path.join(paths.uploadRoot, folderName);
  await mkdir(uploadDir, { recursive: true });

  const savedFiles = [];
  for (const file of files) {
    validateUploadFile(file);
    const fileName = getSafeUploadFileName(file.fileName);
    const targetPath = path.join(uploadDir, fileName);
    await writeFile(targetPath, file.buffer);
    savedFiles.push(targetPath);
  }

  const relativeInput = path.relative(paths.root, uploadDir);
  return { uploadDir, relativeInput, savedFiles, spaceRoot: paths.root };
}

function createUploadSessionId() {
  return `upload_${Date.now()}_${randomUUID().slice(0, 12)}`;
}

function getUploadSessionPaths(spaceId, uploadId) {
  const paths = getSpacePaths(spaceId);
  const safeId = safePathSegment(uploadId);
  if (!uploadId || safeId !== uploadId || !uploadId.startsWith("upload_")) {
    throw new Error("上传会话编号无效");
  }
  const root = path.resolve(paths.uploadSessionDir, safeId);
  if (!isPathInside(paths.uploadSessionDir, root)) {
    throw new Error("上传会话路径无效");
  }
  return {
    ...paths,
    sessionRoot: root,
    sessionPath: path.join(root, "session.json"),
    chunksRoot: path.join(root, "chunks"),
  };
}

function createUniqueUploadNames(files) {
  const usedNames = new Set();
  return files.map((file) => {
    const initialName = getSafeUploadFileName(file.name || file.fileName);
    const parsed = path.parse(initialName);
    let safeName = initialName;
    let suffix = 2;
    while (usedNames.has(safeName.toLowerCase())) {
      safeName = `${parsed.name}_${suffix}${parsed.ext}`;
      suffix += 1;
    }
    usedNames.add(safeName.toLowerCase());
    return safeName;
  });
}

function validateChunkedUploadFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("请先选择要上传的资料文件");
  }
  const safeNames = createUniqueUploadNames(files);
  return files.map((file, index) => {
    validateUploadMetadata(file.name || file.fileName);
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`文件大小无效：${file.name || file.fileName}`);
    }
    return {
      index,
      name: String(file.name || file.fileName),
      safeName: safeNames[index],
      size,
      type: String(file.type || "application/octet-stream"),
      lastModified: Number(file.lastModified || 0),
      totalChunks: Math.ceil(size / UPLOAD_CHUNK_SIZE),
    };
  });
}

async function writeUploadSession(spaceId, session) {
  const sessionPaths = getUploadSessionPaths(spaceId, session.id);
  await mkdir(sessionPaths.sessionRoot, { recursive: true });
  const persistedSession = { ...session, updatedAt: new Date().toISOString() };
  await writeFile(
    sessionPaths.sessionPath,
    JSON.stringify(persistedSession, null, 2),
    "utf8"
  );
  await PERSISTENCE.writeUploadSession(persistedSession);
  return persistedSession;
}

async function readUploadSession(spaceId, uploadId) {
  const sessionPaths = getUploadSessionPaths(spaceId, uploadId);
  if (PERSISTENCE.enabled) {
    const session = await PERSISTENCE.readUploadSession(normalizeSpaceId(spaceId), uploadId);
    if (!session) {
      const error = new Error("没有找到上传会话");
      error.code = "ENOENT";
      throw error;
    }
    return { session, paths: sessionPaths };
  }
  const content = await readFile(sessionPaths.sessionPath, "utf8");
  return { session: JSON.parse(content), paths: sessionPaths };
}

function assertUploadSessionAccess(user, session) {
  if (!userCanManageSpace(user, session.space)) {
    throw new Error("你没有管理这个项目库的权限");
  }
  if (user.role !== "admin" && session.ownerId !== user.id) {
    throw new Error("这个上传会话不属于当前账号");
  }
}

function getExpectedChunkSize(file, chunkIndex) {
  const offset = chunkIndex * UPLOAD_CHUNK_SIZE;
  return Math.min(UPLOAD_CHUNK_SIZE, file.size - offset);
}

async function getReceivedChunkIndexes(paths, file) {
  const fileChunkDir = path.join(paths.chunksRoot, String(file.index));
  if (!(await pathExists(fileChunkDir))) return [];
  const entries = await readdir(fileChunkDir, { withFileTypes: true });
  const received = [];
  for (const entry of entries) {
    const match = entry.isFile() && entry.name.match(/^(\d+)\.part$/);
    if (!match) continue;
    const chunkIndex = Number(match[1]);
    if (chunkIndex < 0 || chunkIndex >= file.totalChunks) continue;
    const info = await stat(path.join(fileChunkDir, entry.name));
    if (info.size === getExpectedChunkSize(file, chunkIndex)) received.push(chunkIndex);
  }
  return received.sort((a, b) => a - b);
}

async function getUploadSessionStatus(spaceId, uploadId, user) {
  const { session, paths } = await readUploadSession(spaceId, uploadId);
  assertUploadSessionAccess(user, session);
  const files = [];
  for (const file of session.files) {
    files.push({ ...file, receivedChunks: await getReceivedChunkIndexes(paths, file) });
  }
  const storedJob = session.jobId
    ? await readImportJob(session.space, session.jobId).catch(() => null)
    : null;
  const job = storedJob ? sanitizeImportJob(storedJob) : null;
  return {
    id: session.id,
    space: session.space,
    project: session.project,
    mode: session.mode,
    outputName: session.outputName,
    status: session.status || "uploading",
    chunkSize: session.chunkSize,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    uploadDir: session.uploadDir,
    jobId: session.jobId || "",
    job,
    files,
  };
}

async function createChunkedUploadSession({ user, space, project, mode, outputName, files }) {
  const paths = await ensureKnowledgeBase(space);
  const id = createUploadSessionId();
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
  const session = {
    id,
    ownerId: user.id,
    space,
    project,
    mode,
    outputName,
    status: "uploading",
    chunkSize: UPLOAD_CHUNK_SIZE,
    createdAt,
    updatedAt: createdAt,
    uploadDir: path.join(paths.uploadRoot, `${timestamp}_${safePathSegment(project)}`),
    files: validateChunkedUploadFiles(files),
    jobId: "",
  };
  await writeUploadSession(space, session);
  return getUploadSessionStatus(space, id, user);
}

async function saveUploadChunk({ request, user, space, uploadId, fileIndex, chunkIndex }) {
  const { session, paths } = await readUploadSession(space, uploadId);
  assertUploadSessionAccess(user, session);
  if (session.status === "completed") return { alreadyCompleted: true, session };
  const file = session.files.find((item) => item.index === fileIndex);
  if (!file || chunkIndex < 0 || chunkIndex >= file.totalChunks) {
    throw new Error("上传分片位置无效");
  }
  const expectedSize = getExpectedChunkSize(file, chunkIndex);
  const declaredSize = Number(request.headers["content-length"] || expectedSize);
  if (declaredSize !== expectedSize) {
    throw new Error(`分片大小不正确，应为 ${expectedSize} 字节`);
  }
  const fileChunkDir = path.join(paths.chunksRoot, String(file.index));
  const targetPath = path.join(fileChunkDir, `${chunkIndex}.part`);
  await mkdir(fileChunkDir, { recursive: true });
  if (await pathExists(targetPath)) {
    const info = await stat(targetPath);
    if (info.size === expectedSize) return { received: true, duplicate: true };
  }
  const content = await readRequestBuffer(request, expectedSize);
  if (content.length !== expectedSize) {
    throw new Error(`分片接收不完整，应为 ${expectedSize} 字节，实际 ${content.length} 字节`);
  }
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, { mode: 0o600 });
  await rm(targetPath, { force: true });
  await rename(temporaryPath, targetPath);
  return { received: true, duplicate: false };
}

async function assembleChunkedUpload(session, paths) {
  await mkdir(session.uploadDir, { recursive: true });
  const savedFiles = [];
  for (const file of session.files) {
    const received = await getReceivedChunkIndexes(paths, file);
    if (received.length !== file.totalChunks) {
      throw new Error(`${file.name} 尚有 ${file.totalChunks - received.length} 个分片未上传`);
    }
    const targetPath = path.join(session.uploadDir, file.safeName);
    if (await pathExists(targetPath) && (await stat(targetPath)).size === file.size) {
      savedFiles.push(targetPath);
      continue;
    }
    const temporaryPath = `${targetPath}.${session.id}.assembling`;
    await writeFile(temporaryPath, Buffer.alloc(0), { mode: 0o600 });
    try {
      for (let chunkIndex = 0; chunkIndex < file.totalChunks; chunkIndex += 1) {
        const chunkPath = path.join(paths.chunksRoot, String(file.index), `${chunkIndex}.part`);
        await appendFile(temporaryPath, await readFile(chunkPath));
      }
      if ((await stat(temporaryPath)).size !== file.size) {
        throw new Error(`${file.name} 合并后的大小不正确`);
      }
      await rm(targetPath, { force: true });
      await rename(temporaryPath, targetPath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
    savedFiles.push(targetPath);
  }
  return {
    uploadDir: session.uploadDir,
    relativeInput: path.relative(paths.root, session.uploadDir),
    savedFiles,
    spaceRoot: paths.root,
  };
}

function createImportJobId() {
  return `job_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function getImportJobPath(spaceId, jobId) {
  const paths = getSpacePaths(spaceId);
  return path.join(paths.importJobDir, `${safePathSegment(jobId)}.json`);
}

function sanitizeImportJob(job) {
  return {
    id: job.id,
    uploadId: job.uploadId || "",
    space: job.space,
    project: job.project,
    mode: job.mode,
    outputName: job.outputName,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    currentFile: job.currentFile || "",
    fileIndex: job.fileIndex || 0,
    totalFiles: job.totalFiles || 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    uploadDir: job.uploadDir,
    savedFiles: job.savedFiles || [],
    outputPath: job.outputPath,
    logPath: job.logPath,
    stdout: job.stdout || "",
    error: job.error || "",
    attempts: Number(job.attempts || 0),
    maxAttempts: Number(job.maxAttempts || IMPORT_MAX_ATTEMPTS),
    nextRetryAt: job.nextRetryAt || "",
  };
}

async function cleanupExpiredUploadSessions() {
  const threshold = Date.now() - UPLOAD_SESSION_RETENTION_HOURS * 60 * 60 * 1000;
  for (const space of await listSpaces()) {
    const paths = await ensureKnowledgeBase(space.id);
    for (const entry of await readdir(paths.uploadSessionDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionRoot = path.join(paths.uploadSessionDir, entry.name);
      try {
        const session = JSON.parse(await readFile(path.join(sessionRoot, "session.json"), "utf8"));
        const referenceTime = Date.parse(session.completedAt || session.updatedAt || session.createdAt || "");
        if (Number.isFinite(referenceTime) && referenceTime < threshold) {
          await rm(sessionRoot, { recursive: true, force: true });
          await PERSISTENCE.deleteUploadSession(space.id, session.id || entry.name);
        }
      } catch {
        const info = await stat(sessionRoot);
        if (info.mtimeMs < threshold) await rm(sessionRoot, { recursive: true, force: true });
      }
    }
  }
  await PERSISTENCE.deleteExpiredUploadSessions(new Date(threshold).toISOString());
}

async function countActiveUploadSessions(spaceId) {
  if (PERSISTENCE.enabled) {
    return PERSISTENCE.countActiveUploadSessions(normalizeSpaceId(spaceId));
  }
  const paths = await ensureKnowledgeBase(spaceId);
  let active = 0;
  for (const entry of await readdir(paths.uploadSessionDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const session = JSON.parse(
        await readFile(path.join(paths.uploadSessionDir, entry.name, "session.json"), "utf8")
      );
      if (session.status !== "completed") active += 1;
    } catch {
      active += 1;
    }
  }
  return active;
}

async function readImportJob(spaceId, jobId) {
  if (PERSISTENCE.enabled) {
    const job = await PERSISTENCE.readImportJob(normalizeSpaceId(spaceId), jobId);
    if (!job) {
      const error = new Error("没有找到入库任务");
      error.code = "ENOENT";
      throw error;
    }
    return job;
  }
  const jobPath = getImportJobPath(spaceId, jobId);
  const content = (await readFile(jobPath, "utf8")).replace(/^\uFEFF/, "");
  return JSON.parse(content);
}

async function writeImportJob(job) {
  const paths = await ensureKnowledgeBase(job.space);
  const jobPath = path.join(paths.importJobDir, `${safePathSegment(job.id)}.json`);
  const payload = {
    ...job,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(jobPath, JSON.stringify(payload, null, 2), "utf8");
  await PERSISTENCE.writeImportJob(payload);
  return payload;
}

async function patchImportJob(spaceId, jobId, patch) {
  const job = await readImportJob(spaceId, jobId);
  return writeImportJob({
    ...job,
    ...patch,
  });
}

async function listImportJobs(spaceId, limit = 30) {
  if (PERSISTENCE.enabled) {
    return (await PERSISTENCE.listImportJobs(normalizeSpaceId(spaceId), limit)).map(sanitizeImportJob);
  }
  const paths = await ensureKnowledgeBase(spaceId);
  const files = await readdir(paths.importJobDir, { withFileTypes: true });
  const jobs = [];
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const content = (await readFile(path.join(paths.importJobDir, entry.name), "utf8")).replace(/^\uFEFF/, "");
      jobs.push(sanitizeImportJob(JSON.parse(content)));
    } catch {
      // Ignore broken job records so the history page remains usable.
    }
  }
  return jobs
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, limit);
}

async function resumePendingImportJobs() {
  const spaces = await listSpaces();
  for (const space of spaces) {
    const jobs = await listImportJobs(space.id, 100);
    for (const job of jobs) {
      if (!["queued", "running", "retrying"].includes(job.status)) {
        continue;
      }
      if (PERSISTENCE.enabled) {
        const inserted = await PERSISTENCE.ensureTask(space.id, job.id, job.nextRetryAt || "");
        if (inserted && job.status === "running") {
          await patchImportJob(space.id, job.id, {
            status: "queued",
            phase: "服务重启后等待继续处理",
            progress: Math.max(10, Math.min(Number(job.progress || 10), 40)),
          });
        }
        continue;
      }
      await patchImportJob(space.id, job.id, {
        status: "queued",
        phase: "服务重启后等待继续处理",
        progress: Math.max(10, Math.min(Number(job.progress || 10), 40)),
      });
      await enqueueImportJob(space.id, job.id);
    }
  }
}

async function enqueueImportJob(spaceId, jobId, delayMs = 0) {
  if (PERSISTENCE.enabled) {
    await PERSISTENCE.enqueueTask(spaceId, jobId, delayMs);
    setTimeout(processImportQueue, Math.min(Math.max(0, delayMs), 1000));
    return;
  }
  if (delayMs > 0) {
    setTimeout(() => enqueueImportJob(spaceId, jobId).catch(console.error), delayMs);
    return;
  }
  const key = `${spaceId}:${jobId}`;
  if (
    activeImportJobs.has(key) ||
    pendingImportJobs.some((item) => item.key === key)
  ) {
    return;
  }
  pendingImportJobs.push({ key, spaceId, jobId });
  setTimeout(processImportQueue, 0);
}

async function processImportQueue() {
  if (queueWorkerBusy || activeImportJobs.size >= MAX_CONCURRENT_IMPORT_JOBS) {
    return;
  }
  queueWorkerBusy = true;
  const next = PERSISTENCE.enabled
    ? await PERSISTENCE.claimTask().catch((error) => {
      console.error(`数据库队列认领失败：${error.message}`);
      return null;
    })
    : pendingImportJobs.shift();
  if (!next) {
    queueWorkerBusy = false;
    return;
  }

  const key = next.key || `${next.spaceId}:${next.jobId}`;
  activeImportJobs.add(key);
  queueWorkerBusy = false;
  const heartbeatTimer = PERSISTENCE.enabled
    ? setInterval(() => PERSISTENCE.heartbeatTask(next.id).catch(() => {}), 30_000)
    : null;
  heartbeatTimer?.unref();
  try {
    await runImportJob(next.spaceId, next.jobId);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (PERSISTENCE.enabled) {
      const job = await readImportJob(next.spaceId, next.jobId).catch(() => null);
      if (!job || ["completed", "failed"].includes(job.status)) {
        await PERSISTENCE.finishTask(next.id).catch(() => {});
      }
    }
    activeImportJobs.delete(key);
    setTimeout(processImportQueue, 0);
  }
}

async function runImportJob(spaceId, jobId) {
  try {
    const previousJob = await readImportJob(spaceId, jobId);
    const attempts = Number(previousJob.attempts || 0) + 1;
    let job = await patchImportJob(spaceId, jobId, {
      status: "running",
      phase: attempts > 1 ? `第 ${attempts} 次尝试：准备解析资料` : "准备解析上传资料",
      progress: 28,
      attempts,
      maxAttempts: Number(previousJob.maxAttempts || IMPORT_MAX_ATTEMPTS),
      nextRetryAt: "",
      error: "",
      currentFile: "",
      fileIndex: 0,
      totalFiles: 0,
    });
    const paths = await ensureKnowledgeBase(job.space);
    const progressState = {
      lastWriteAt: 0,
    };
    const documents = await loadUploadedDocuments(job.savedFiles, paths.root, (event) => {
      const now = Date.now();
      if (now - progressState.lastWriteAt < 700 && Number(event.progress || 0) < 100) {
        return;
      }
      progressState.lastWriteAt = now;
      const totalFiles = Math.max(1, Number(event.totalFiles || job.savedFiles.length || 1));
      const fileIndex = Math.max(1, Number(event.fileIndex || 1));
      const fileBase = ((fileIndex - 1) / totalFiles) * 44;
      const fileSlice = (Number(event.progress || 0) / 100) * (44 / totalFiles);
      const progress = Math.max(30, Math.min(74, Math.round(30 + fileBase + fileSlice)));
      patchImportJob(spaceId, jobId, {
        status: "running",
        phase: event.detail
          ? `${event.phase}：${event.detail}`
          : event.phase || `解析文件 ${fileIndex}/${totalFiles}`,
        progress,
        currentFile: event.fileName || "",
        fileIndex,
        totalFiles,
      }).catch(() => {});
    });

    job = await patchImportJob(spaceId, jobId, {
      status: "running",
      phase: "AI 整理资料",
      progress: 76,
    });
    const organizedContent = await callOrganizationApi({
      project: job.project,
      mode: job.mode,
      documents,
    });

    job = await patchImportJob(spaceId, jobId, {
      status: "running",
      phase: "写入知识库",
      progress: 92,
    });
    const written = await writeKnowledgeOutput({
      spaceId: job.space,
      project: job.project,
      mode: job.mode,
      outputName: job.outputName,
      savedFiles: job.savedFiles,
      documents,
      content: organizedContent,
    });

    job = await patchImportJob(spaceId, jobId, {
      status: "running",
      phase: "更新语义索引",
      progress: 96,
    });
    let vectorSummary = "语义索引未启用";
    if (VECTOR_ENABLED) {
      try {
        const vectorResult = await runVectorCommand(paths, "build");
        for (const cacheKey of vectorQueryCache.keys()) {
          if (cacheKey.startsWith(`${paths.id}:`)) {
            vectorQueryCache.delete(cacheKey);
          }
        }
        vectorSummary = `语义索引：${vectorResult.files} 个文件 / ${vectorResult.chunks} 个片段`;
      } catch (error) {
        vectorSummary = `语义索引稍后自动重试：${error.message}`;
      }
    }

    await patchImportJob(spaceId, jobId, {
      status: "completed",
      phase: "已完成",
      progress: 100,
      outputPath: written.outputPath,
      logPath: written.logPath,
      stdout: [
        `知识整理已生成：${written.outputPath}`,
        `更新日志已记录：${written.logPath}`,
        `原始资料目录：${job.uploadDir}`,
        vectorSummary,
      ].join("\n"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedJob = await readImportJob(spaceId, jobId).catch(() => null);
    const attempts = Number(failedJob?.attempts || 1);
    const maxAttempts = Number(failedJob?.maxAttempts || IMPORT_MAX_ATTEMPTS);
    if (attempts < maxAttempts) {
      const delayMs = Math.min(60_000, 5_000 * (2 ** (attempts - 1)));
      const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
      await patchImportJob(spaceId, jobId, {
        status: "retrying",
        phase: `处理失败，${Math.round(delayMs / 1000)} 秒后自动重试`,
        progress: 20,
        error: message,
        nextRetryAt,
      }).catch(() => {});
      await enqueueImportJob(spaceId, jobId, delayMs);
      return;
    }
    await patchImportJob(spaceId, jobId, {
      status: "failed",
      phase: `处理失败，已尝试 ${attempts} 次`,
      progress: 100,
      error: message,
      nextRetryAt: "",
    }).catch(() => {});
  }
}

async function createImportJob({ space, project, mode, outputName, saved, id = "", uploadId = "" }) {
  const now = new Date().toISOString();
  const job = await writeImportJob({
    id: id || createImportJobId(),
    uploadId,
    space,
    project,
    mode,
    outputName,
    status: "queued",
    phase: "等待后台处理",
    progress: 25,
    createdAt: now,
    updatedAt: now,
    uploadDir: saved.uploadDir,
    savedFiles: saved.savedFiles,
    outputPath: "",
    logPath: "",
    stdout: "",
    error: "",
    attempts: 0,
    maxAttempts: IMPORT_MAX_ATTEMPTS,
    nextRetryAt: "",
  });

  await enqueueImportJob(space, job.id);

  return job;
}

async function handleInitChunkedUpload(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  const project = String(payload.project || "").trim();
  const mode = String(payload.mode || "mixed").trim();
  const outputName = String(payload.outputName || "").trim();
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response, "只有项目资料管理员可以上传资料");
    return;
  }
  if (!project) {
    sendJson(response, 400, { error: "项目名称不能为空" });
    return;
  }
  if (!["project", "faq", "sop", "analysis", "mixed"].includes(mode)) {
    sendJson(response, 400, { error: "整理类型不支持" });
    return;
  }
  try {
    const upload = await createChunkedUploadSession({
      user,
      space,
      project,
      mode,
      outputName,
      files: payload.files,
    });
    await appendAuditLog({
      request,
      user,
      action: "upload.init",
      space,
      target: upload.id,
      detail: `${project} / ${upload.files.length} 个文件`,
    });
    sendJson(response, 200, { ok: true, upload });
  } catch (error) {
    sendJson(response, 400, { error: "无法创建上传会话", detail: error.message });
  }
}

async function handleGetChunkedUpload(request, response, requestUrl, uploadId) {
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  try {
    const upload = await getUploadSessionStatus(space, uploadId, request.authUser);
    sendJson(response, 200, { ok: true, upload });
  } catch (error) {
    sendJson(response, error.code === "ENOENT" ? 404 : 400, {
      error: "无法读取上传会话",
      detail: error.message,
    });
  }
}

async function handleSaveUploadChunk(request, response, uploadId, fileIndex, chunkIndex) {
  let requestedSpace = String(request.headers["x-knowledge-space"] || DEFAULT_SPACE_ID);
  try {
    requestedSpace = decodeURIComponent(requestedSpace);
  } catch {
    // Keep the original value so normalizeSpaceId can safely sanitize it.
  }
  const space = normalizeSpaceId(requestedSpace);
  try {
    const result = await saveUploadChunk({
      request,
      user: request.authUser,
      space,
      uploadId,
      fileIndex: Number(fileIndex),
      chunkIndex: Number(chunkIndex),
    });
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(response, 400, { error: "上传分片失败", detail: error.message });
  }
}

async function handleCompleteChunkedUpload(request, response, uploadId) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  try {
    const loaded = await readUploadSession(space, uploadId);
    const { session, paths } = loaded;
    assertUploadSessionAccess(user, session);
    if (session.status === "completed" && session.jobId) {
      const job = await readImportJob(space, session.jobId);
      sendJson(response, 200, {
        ok: true,
        resumed: true,
        jobId: job.id,
        job: sanitizeImportJob(job),
        uploadDir: session.uploadDir,
        savedFiles: session.savedFiles || job.savedFiles || [],
        stdout: `上传已经完成，继续处理任务：${job.id}`,
      });
      return;
    }

    const jobId = session.jobId || createImportJobId();
    await writeUploadSession(space, { ...session, status: "assembling", jobId });
    const saved = await assembleChunkedUpload(session, paths);
    const existingJob = await readImportJob(space, jobId).catch(() => null);
    const job = existingJob || await createImportJob({
        space,
        project: session.project,
        mode: session.mode,
        outputName: session.outputName,
        saved,
        id: jobId,
        uploadId,
      });
    await writeUploadSession(space, {
      ...session,
      status: "completed",
      jobId: job.id,
      savedFiles: saved.savedFiles,
      completedAt: new Date().toISOString(),
    });
    await rm(paths.chunksRoot, { recursive: true, force: true });
    await appendAuditLog({
      request,
      user,
      action: "upload.complete",
      space,
      target: uploadId,
      detail: `${session.project} / ${session.files.length} 个文件 / ${job.id}`,
    });
    sendJson(response, 200, {
      ok: true,
      jobId: job.id,
      job: sanitizeImportJob(job),
      uploadDir: saved.uploadDir,
      savedFiles: saved.savedFiles,
      stdout: [
        `分片上传完成：${uploadId}`,
        `入库任务已提交：${job.id}`,
        `原始资料目录：${saved.uploadDir}`,
      ].join("\n"),
    });
  } catch (error) {
    sendJson(response, 400, { error: "无法完成分片上传", detail: error.message });
  }
}

async function handleImportKnowledge(request, response) {
  const user = request.authUser;
  try {
    const bodyBuffer = await readRequestBuffer(request);
    const { fields, files } = parseMultipartForm(request, bodyBuffer);
    const space = normalizeSpaceId(fields.space || DEFAULT_SPACE_ID);
    const project = String(fields.project || "未命名项目").trim();
    const mode = String(fields.mode || "mixed").trim();
    const outputName = String(fields.outputName || "").trim();
    const dryRun = fields.dryRun === "true";

    if (!userCanManageSpace(user, space)) {
      sendForbidden(response, "只有项目资料管理员可以上传并整理资料");
      return;
    }

    if (!project) {
      sendJson(response, 400, { error: "项目名称不能为空" });
      return;
    }
    if (!files.length) {
      sendJson(response, 400, { error: "请先选择要上传的资料文件" });
      return;
    }
    if (!["project", "faq", "sop", "analysis", "mixed"].includes(mode)) {
      sendJson(response, 400, { error: "整理类型不支持" });
      return;
    }

    let result;
    if (dryRun) {
      const inspection = await inspectUploadMetadata(space, project, files);
      const totalBytes = inspection.inspectedFiles.reduce((total, item) => total + item.size, 0);
      const hasVideo = inspection.inspectedFiles.some((item) =>
        VIDEO_UPLOAD_EXTENSIONS.has(item.extension)
      );
      result = {
        stdout: [
          "预检查完成：不会保存文件，不会解析正文，不会调用 AI，不会写入 90_AI输出。",
          `项目：${project}`,
          `模式：${mode}`,
          `输入文件数：${inspection.inspectedFiles.length}`,
          `文件总大小：${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
          `正式上传时将保存到：${inspection.previewUploadDir}`,
          hasVideo ? "提示：视频会在正式上传整理时抽取音频、转文字和关键帧 OCR，耗时会明显更久。" : "",
          ...inspection.inspectedFiles.map(
            (item) =>
              `- ${item.fileName} / ${(item.size / 1024 / 1024).toFixed(1)} MB / ${item.extension}`
          ),
        ].join("\n"),
        stderr: "",
        uploadDir: inspection.previewUploadDir,
        savedFiles: [],
      };
    } else {
      const saved = await saveUploadedFiles(space, project, files);
      const job = await createImportJob({
        space,
        project,
        mode,
        outputName,
        saved,
      });
      result = {
        stdout: [
          `入库任务已提交：${job.id}`,
          "后台会继续解析资料、调用 AI 整理并写入知识库。",
          `原始资料目录：${saved.uploadDir}`,
        ].join("\n"),
        stderr: "",
        job: sanitizeImportJob(job),
        jobId: job.id,
        uploadDir: saved.uploadDir,
        savedFiles: saved.savedFiles,
      };
      await appendAuditLog({ request, user, action: "import", space, target: job.id, detail: `${project} / ${files.length} 个文件` });
    }

    sendJson(response, 200, {
      ok: true,
      dryRun,
      space,
      uploadDir: result.uploadDir,
      savedFiles: result.savedFiles || [],
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      jobId: result.jobId,
      job: result.job,
      outputPath: result.outputPath,
      logPath: result.logPath,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "资料上传或整理失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleImportPrecheck(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  const project = String(payload.project || "未命名项目").trim();
  const mode = String(payload.mode || "mixed").trim();
  const files = Array.isArray(payload.files) ? payload.files : [];

  if (!userCanManageSpace(user, space)) {
    sendForbidden(response, "只有项目资料管理员可以检查待上传资料");
    return;
  }

  try {
    if (!project) {
      sendJson(response, 400, { error: "项目名称不能为空" });
      return;
    }
    if (!files.length) {
      sendJson(response, 400, { error: "请先选择要检查的资料文件" });
      return;
    }
    if (!["project", "faq", "sop", "analysis", "mixed"].includes(mode)) {
      sendJson(response, 400, { error: "整理类型不支持" });
      return;
    }

    const inspection = await inspectUploadMetadata(space, project, files);
    const totalBytes = inspection.inspectedFiles.reduce((total, item) => total + item.size, 0);
    const hasVideo = inspection.inspectedFiles.some((item) =>
      VIDEO_UPLOAD_EXTENSIONS.has(item.extension)
    );
    sendJson(response, 200, {
      ok: true,
      dryRun: true,
      space,
      uploadDir: inspection.previewUploadDir,
      savedFiles: [],
      stdout: [
        "预检查完成：没有上传文件内容，没有保存文件，没有解析正文，没有调用 AI。",
        `项目：${project}`,
        `模式：${mode}`,
        `输入文件数：${inspection.inspectedFiles.length}`,
        `文件总大小：${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
        `正式上传时将保存到：${inspection.previewUploadDir}`,
        hasVideo ? "提示：视频会在正式上传整理时抽取音频、转文字和关键帧 OCR，耗时会明显更久。" : "",
        ...inspection.inspectedFiles.map(
          (item) =>
            `- ${item.fileName} / ${(item.size / 1024 / 1024).toFixed(1)} MB / ${item.extension}`
        ),
      ].join("\n"),
      stderr: "",
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "资料预检查失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCreateSpace(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const rawName = String(payload.name || "").trim();
  if (!rawName) {
    sendJson(response, 400, { error: "项目库名称不能为空" });
    return;
  }
  const name = normalizeSpaceId(rawName);

  if (!user || !["admin", "manager"].includes(user.role)) {
    sendForbidden(response, "只有管理员可以创建项目库");
    return;
  }

  try {
    const paths = await ensureKnowledgeBase(name);
    if (user.role === "manager" && !user.spaces.includes(name)) {
      user.spaces.push(name);
      user.updatedAt = new Date().toISOString();
      await saveAuthStore(AUTH_STORE);
    }
    await appendAuditLog({ request, user, action: "space.create", space: name, target: paths.root });
    sendJson(response, 200, {
      ok: true,
      space: {
        id: name,
        name,
        root: paths.root,
      },
      spaces: getAccessibleSpaces(user, await listSpaces()),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "创建项目库失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleListImportJobs(requestUrl, response) {
  const user = response.authUser;
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  const limit = Number(requestUrl.searchParams.get("limit") || 30);
  try {
    sendJson(response, 200, {
      ok: true,
      space,
      jobs: await listImportJobs(space, Number.isFinite(limit) ? limit : 30),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "读取入库任务历史失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleGetImportJob(requestUrl, response) {
  const user = response.authUser;
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  const jobId = decodeURIComponent(requestUrl.pathname.split("/").pop() || "");
  if (!jobId) {
    sendJson(response, 400, { error: "任务编号不能为空" });
    return;
  }

  try {
    const job = await readImportJob(space, jobId);
    sendJson(response, 200, {
      ok: true,
      space,
      job: sanitizeImportJob(job),
    });
  } catch (error) {
    const statusCode = error?.code === "ENOENT" ? 404 : 500;
    sendJson(response, statusCode, {
      error: statusCode === 404 ? "没有找到这个入库任务" : "读取入库任务失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleRetryImportJob(request, response, requestUrl) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  const jobId = decodeURIComponent(requestUrl.pathname.split("/").at(-2) || "");
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response, "只有项目资料管理员可以重试入库任务");
    return;
  }
  try {
    const job = await readImportJob(space, jobId);
    if (!["failed", "retrying"].includes(job.status)) {
      sendJson(response, 409, { error: "只有失败或等待重试的任务可以重新执行" });
      return;
    }
    for (const filePath of job.savedFiles || []) {
      if (!(await pathExists(filePath))) {
        throw new Error(`原始文件已不存在：${filePath}`);
      }
    }
    const nextJob = await patchImportJob(space, jobId, {
      status: "queued",
      phase: "已手动重新提交",
      progress: 20,
      attempts: 0,
      error: "",
      nextRetryAt: "",
    });
    await enqueueImportJob(space, jobId);
    await appendAuditLog({ request, user, action: "import.retry", space, target: jobId });
    sendJson(response, 200, { ok: true, job: sanitizeImportJob(nextJob) });
  } catch (error) {
    sendJson(response, 500, { error: "重新执行入库任务失败", detail: error.message });
  }
}

async function handleListManagedFiles(requestUrl, response) {
  const user = response.authUser;
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  const type = requestUrl.searchParams.get("type") || "all";
  const query = requestUrl.searchParams.get("q") || "";
  try {
    sendJson(response, 200, {
      ok: true,
      space,
      files: await listManagedFiles(space, { type, query }),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "读取资料列表失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDeleteManagedFile(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  const relativePath = String(payload.relativePath || "").trim();
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response, "只有项目资料管理员可以删除资料");
    return;
  }
  if (!relativePath) {
    sendJson(response, 400, { error: "文件路径不能为空" });
    return;
  }

  try {
    const deleted = await deleteManagedFile(space, relativePath);
    await appendAuditLog({ request, user, action: "file.trash", space, target: relativePath, detail: deleted.id });
    sendJson(response, 200, {
      ok: true,
      space,
      deleted,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "删除资料失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function migrateKnowledgeEncryption(spaceId) {
  if (!KNOWLEDGE_ENCRYPTION_ENABLED) {
    throw new Error("知识资料加密当前未启用");
  }
  const paths = await ensureKnowledgeBase(spaceId);
  const files = await listMarkdownFiles(paths.knowledgeDir);
  let encryptedFiles = 0;
  let alreadyEncrypted = 0;
  for (const filePath of files) {
    const content = await readFile(filePath);
    if (isEncryptedKnowledgeBuffer(content)) {
      alreadyEncrypted += 1;
      continue;
    }
    await writeProtectedFile(filePath, content);
    encryptedFiles += 1;
  }

  let vectorIndexEncrypted = false;
  if (await pathExists(paths.vectorIndex)) {
    const indexContent = await readFile(paths.vectorIndex);
    if (!isEncryptedKnowledgeBuffer(indexContent)) {
      await writeProtectedFile(paths.vectorIndex, indexContent);
      vectorIndexEncrypted = true;
    }
  }
  for (const cacheKey of vectorQueryCache.keys()) {
    if (cacheKey.startsWith(`${paths.id}:`)) vectorQueryCache.delete(cacheKey);
  }
  return {
    files: files.length,
    encryptedFiles,
    alreadyEncrypted,
    vectorIndexEncrypted,
    keyId: await getKnowledgeKeyId(),
  };
}

async function handleMigrateKnowledgeEncryption(request, response) {
  const user = request.authUser;
  if (user?.role !== "admin") {
    sendForbidden(response, "只有超级管理员可以迁移加密资料");
    return;
  }
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  if (!userCanAccessSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    const result = await migrateKnowledgeEncryption(space);
    await appendAuditLog({
      request,
      user,
      action: "encryption.migrate",
      space,
      detail: `${result.encryptedFiles} encrypted / ${result.alreadyEncrypted} unchanged`,
    });
    sendJson(response, 200, { ok: true, space, result, status: await getKnowledgeBaseStatus(space) });
  } catch (error) {
    sendJson(response, 500, {
      error: "已有资料加密失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleListTrash(requestUrl, response) {
  const user = response.authUser;
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  sendJson(response, 200, { ok: true, space, retentionDays: TRASH_RETENTION_DAYS, items: await listTrashItems(space) });
}

async function handleRestoreTrash(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    const restored = await restoreTrashItem(space, payload.id);
    await appendAuditLog({ request, user, action: "file.restore", space, target: restored.restoredRelativePath });
    sendJson(response, 200, { ok: true, restored });
  } catch (error) {
    sendJson(response, 500, { error: "恢复资料失败", detail: error.message });
  }
}

async function handlePurgeTrash(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    await purgeTrashItem(space, payload.id);
    await appendAuditLog({ request, user, action: "file.purge", space, target: payload.id });
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 500, { error: "彻底删除失败", detail: error.message });
  }
}

async function handleListBackups(requestUrl, response) {
  const user = response.authUser;
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  sendJson(response, 200, {
    ok: true,
    space,
    backupDir: BACKUP_DIR,
    autoEnabled: AUTO_BACKUP_ENABLED,
    intervalHours: BACKUP_INTERVAL_HOURS,
    retentionCount: BACKUP_RETENTION_COUNT,
    backups: await listBackups(space),
  });
}

async function handleCreateBackup(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    const backup = await createSpaceBackup(space, "manual", user.role === "admin");
    await appendAuditLog({ request, user, action: "backup.create", space, target: backup.id, detail: `${backup.files} files / ${backup.totalBytes} bytes` });
    sendJson(response, 200, { ok: true, backup });
  } catch (error) {
    sendJson(response, 500, { error: "创建备份失败", detail: error.message });
  }
}

async function handleRestoreBackup(request, response) {
  const user = request.authUser;
  if (user?.role !== "admin") {
    sendForbidden(response, "只有超级管理员可以从备份创建恢复库");
    return;
  }
  const payload = await readRequestJson(request, response);
  if (!payload) return;
  try {
    const restored = await restoreSpaceBackup(payload.id, payload.name);
    await appendAuditLog({ request, user, action: "backup.restore", space: restored.targetSpace, target: payload.id });
    sendJson(response, 200, { ok: true, restored, spaces: await listSpaces() });
  } catch (error) {
    sendJson(response, 500, { error: "恢复备份失败", detail: error.message });
  }
}

async function getOperationsStatus(spaceId) {
  const paths = await ensureKnowledgeBase(spaceId);
  const jobs = await listImportJobs(spaceId, 100);
  const backups = await listBackups(spaceId);
  const trash = await listTrashItems(spaceId);
  const databaseQueue = await PERSISTENCE.queueStats(spaceId);
  let disk = { freeBytes: null, totalBytes: null, usedPercent: null };
  try {
    const info = await statfs(paths.root);
    const totalBytes = Number(info.blocks) * Number(info.bsize);
    const freeBytes = Number(info.bavail) * Number(info.bsize);
    disk = { freeBytes, totalBytes, usedPercent: totalBytes ? Math.round((1 - freeBytes / totalBytes) * 1000) / 10 : null };
  } catch {
    // Disk metrics are optional on older Node versions/filesystems.
  }
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - SERVICE_STARTED_AT) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    disk,
    queue: {
      active: databaseQueue?.running ?? activeImportJobs.size,
      pending: databaseQueue?.queued ?? pendingImportJobs.length,
      uploading: await countActiveUploadSessions(spaceId),
      retrying: jobs.filter((job) => job.status === "retrying").length,
      failed: jobs.filter((job) => job.status === "failed").length,
    },
    ai: { provider: AI_PROVIDER, model: AI_MODEL, visionModel: AI_VISION_MODEL, configured: Boolean(AI_API_KEY) },
    vector: await readVectorIndexStatus(paths.vectorIndex),
    backup: { latest: backups[0] || null, count: backups.length, autoEnabled: AUTO_BACKUP_ENABLED },
    trash: { count: trash.length, retentionDays: TRASH_RETENTION_DAYS },
    database: await PERSISTENCE.health(),
  };
}

async function handleOperationsStatus(requestUrl, response) {
  const user = response.authUser;
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response);
    return;
  }
  try {
    sendJson(response, 200, await getOperationsStatus(space));
  } catch (error) {
    sendJson(response, 500, { error: "读取系统监控状态失败", detail: error.message });
  }
}

async function runAutomaticBackups() {
  if (!AUTO_BACKUP_ENABLED) return;
  for (const space of await listSpaces()) {
    try {
      const latest = (await listBackups(space.id))[0];
      const ageMs = latest ? Date.now() - Date.parse(latest.createdAt) : Infinity;
      if (ageMs < BACKUP_INTERVAL_HOURS * 60 * 60 * 1000) continue;
      const backup = await createSpaceBackup(space.id, "automatic", true);
      await appendAuditLog({ request: null, user: null, action: "backup.auto", space: space.id, target: backup.id });
    } catch (error) {
      await appendAuditLog({ request: null, user: null, action: "backup.auto.failed", space: space.id, detail: error.message }).catch(() => {});
    }
  }
}

async function migrateLegacyDataToPostgres() {
  if (!PERSISTENCE.enabled) return;
  const migrationKey = "legacy_files_migrated_v1";
  if (await PERSISTENCE.getSetting(migrationKey)) return;

  const migrated = { auditLogs: 0, chats: 0, importJobs: 0, uploadSessions: 0 };

  if (await pathExists(AUDIT_LOG_PATH)) {
    const content = await readFile(AUDIT_LOG_PATH, "utf8");
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
      try {
        await PERSISTENCE.appendAuditLog(JSON.parse(line));
        migrated.auditLogs += 1;
      } catch (error) {
        console.warn(`跳过一条无法迁移的操作日志：${error.message}`);
      }
    }
  }

  for (const space of await listSpaces()) {
    const paths = await ensureKnowledgeBase(space.id);
    for (const entry of await readdir(paths.chatDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        await PERSISTENCE.writeChatSession(
          JSON.parse(await readFile(path.join(paths.chatDir, entry.name), "utf8"))
        );
        migrated.chats += 1;
      } catch (error) {
        console.warn(`跳过无法迁移的对话 ${entry.name}：${error.message}`);
      }
    }
    for (const entry of await readdir(paths.importJobDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        await PERSISTENCE.writeImportJob(
          JSON.parse((await readFile(path.join(paths.importJobDir, entry.name), "utf8")).replace(/^\uFEFF/, ""))
        );
        migrated.importJobs += 1;
      } catch (error) {
        console.warn(`跳过无法迁移的任务 ${entry.name}：${error.message}`);
      }
    }
    for (const entry of await readdir(paths.uploadSessionDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        await PERSISTENCE.writeUploadSession(
          JSON.parse(await readFile(path.join(paths.uploadSessionDir, entry.name, "session.json"), "utf8"))
        );
        migrated.uploadSessions += 1;
      } catch (error) {
        console.warn(`跳过无法迁移的上传会话 ${entry.name}：${error.message}`);
      }
    }
  }
  await PERSISTENCE.setSetting(migrationKey, {
    completedAt: new Date().toISOString(),
    ...migrated,
  });
}

async function handleVaultConfig(request, response) {
  const user = request.authUser;
  if (user?.role !== "admin") {
    sendForbidden(response, "只有超级管理员可以修改知识库路径");
    return;
  }
  if (!isLocalRequest(request)) {
    sendJson(response, 403, { error: "只有部署电脑本机可以修改知识库路径" });
    return;
  }

  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const vaultDir = String(payload.vaultDir || "").trim();
  if (!vaultDir) {
    sendJson(response, 400, { error: "请输入本地知识库路径" });
    return;
  }

  try {
    setVaultDirectory(vaultDir);
    LOCAL_CONFIG.vaultDir = VAULT_DIR;
    LOCAL_CONFIG.updatedAt = new Date().toISOString();
    await saveLocalConfig(LOCAL_CONFIG);
    await ensureKnowledgeBase(DEFAULT_SPACE_ID);
    sendJson(response, 200, {
      ok: true,
      vaultDir: VAULT_DIR,
      spacesRoot: SPACES_ROOT,
      spaces: await listSpaces(),
      status: await getKnowledgeBaseStatus(DEFAULT_SPACE_ID),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "初始化知识库路径失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function getAccessibleSpaces(user, spaces) {
  if (user.role === "admin") {
    return spaces;
  }
  const allowed = new Set(user.spaces || []);
  return spaces.filter((space) => allowed.has(space.id));
}

async function createLoginSession(userId) {
  const now = Date.now();
  AUTH_STORE.sessions = AUTH_STORE.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  const session = {
    id: randomBytes(32).toString("hex"),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  };
  AUTH_STORE.sessions.push(session);
  await saveAuthStore(AUTH_STORE);
  return signSessionToken(session.id);
}

async function handleAuthStatus(request, response) {
  const user = await getRequestUser(request);
  sendJson(response, 200, {
    ok: true,
    initialized: AUTH_STORE.users.length > 0,
    authenticated: Boolean(user),
    user: sanitizeUser(user),
  });
}

async function handleAuthSetup(request, response) {
  await refreshAuthStore(true);
  if (AUTH_STORE.users.length > 0) {
    sendJson(response, 409, { error: "系统已经完成管理员初始化" });
    return;
  }
  if (!isLocalRequest(request)) {
    sendJson(response, 403, { error: "首次管理员只能在部署电脑本机创建" });
    return;
  }
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }
  const username = normalizeUsername(payload.username);
  const displayName = String(payload.displayName || payload.username || "管理员").trim().slice(0, 40);
  const password = String(payload.password || "");
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    sendJson(response, 400, { error: "账号需为 3-32 位字母、数字、点、横线或下划线" });
    return;
  }
  if (password.length < 8) {
    sendJson(response, 400, { error: "密码至少需要 8 位" });
    return;
  }
  const passwordData = await hashPassword(password);
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    username,
    displayName,
    role: "admin",
    spaces: [],
    disabled: false,
    passwordSalt: passwordData.salt,
    passwordHash: passwordData.hash,
    createdAt: now,
    updatedAt: now,
  };
  AUTH_STORE.users.push(user);
  await saveAuthStore(AUTH_STORE);
  setSessionCookie(response, await createLoginSession(user.id));
  await appendAuditLog({ request, user, action: "auth.setup", target: user.username });
  sendJson(response, 200, { ok: true, user: sanitizeUser(user) });
}

async function handleLogin(request, response) {
  await refreshAuthStore(true);
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || "");
  const user = AUTH_STORE.users.find((item) => item.username === username);
  if (!user || user.disabled || !(await verifyPassword(password, user))) {
    await appendAuditLog({ request, user: null, action: "auth.login.failed", target: username });
    sendJson(response, 401, { error: "账号或密码不正确" });
    return;
  }
  setSessionCookie(response, await createLoginSession(user.id));
  await appendAuditLog({ request, user, action: "auth.login", target: user.username });
  sendJson(response, 200, { ok: true, user: sanitizeUser(user) });
}

async function handleRegister(request, response) {
  await refreshAuthStore(true);
  if (AUTH_STORE.users.length === 0) {
    sendJson(response, 409, { error: "请先由部署电脑创建超级管理员" });
    return;
  }
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }
  const username = normalizeUsername(payload.username);
  const displayName = String(payload.displayName || "").trim().slice(0, 40);
  const password = String(payload.password || "");
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    sendJson(response, 400, { error: "账号需为 3-32 位字母、数字、点、横线或下划线" });
    return;
  }
  if (!displayName) {
    sendJson(response, 400, { error: "请输入你的姓名" });
    return;
  }
  if (password.length < 8) {
    sendJson(response, 400, { error: "密码至少需要 8 位" });
    return;
  }
  if (AUTH_STORE.users.some((item) => item.username === username)) {
    sendJson(response, 409, { error: "这个账号已经被注册" });
    return;
  }
  const passwordData = await hashPassword(password);
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    username,
    displayName,
    role: "member",
    spaces: [],
    disabled: false,
    passwordSalt: passwordData.salt,
    passwordHash: passwordData.hash,
    createdAt: now,
    updatedAt: now,
  };
  AUTH_STORE.users.push(user);
  await saveAuthStore(AUTH_STORE);
  setSessionCookie(response, await createLoginSession(user.id));
  await appendAuditLog({ request, user, action: "auth.register", target: user.username });
  sendJson(response, 200, { ok: true, user: sanitizeUser(user), pendingAuthorization: true });
}

async function handleLogout(request, response) {
  const token = parseCookies(request)[SESSION_COOKIE];
  const sessionId = readSignedSessionId(token);
  const user = await getRequestUser(request);
  if (sessionId) {
    AUTH_STORE.sessions = AUTH_STORE.sessions.filter((session) => session.id !== sessionId);
    await PERSISTENCE.deleteAuthSession(sessionId);
    await saveAuthStore(AUTH_STORE);
  }
  clearSessionCookie(response);
  await appendAuditLog({ request, user, action: "auth.logout", target: user?.username || "" });
  sendJson(response, 200, { ok: true });
}

async function handleListUsers(request, response) {
  if (request.authUser?.role !== "admin") {
    sendForbidden(response, "只有超级管理员可以管理账号");
    return;
  }
  await refreshAuthStore(true);
  sendJson(response, 200, { ok: true, users: AUTH_STORE.users.map(sanitizeUser) });
}

async function handleSaveUser(request, response) {
  const actor = request.authUser;
  if (actor?.role !== "admin") {
    sendForbidden(response, "只有超级管理员可以管理账号");
    return;
  }
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }
  if (!["manager", "member"].includes(payload.role)) {
    sendJson(response, 400, { error: "只能授予普通成员或资料管理员角色" });
    return;
  }
  const role = payload.role;
  const availableSpaces = new Set((await listSpaces()).map((space) => space.id));
  const spaces = Array.from(new Set((Array.isArray(payload.spaces) ? payload.spaces : [])
    .map(normalizeSpaceId)
    .filter((space) => availableSpaces.has(space))));
  const user = payload.id ? AUTH_STORE.users.find((item) => item.id === payload.id) : null;
  if (!user) {
    sendJson(response, 404, { error: "没有找到这个注册账号，请让员工先自行注册" });
    return;
  }
  const now = new Date().toISOString();
  if (user.role === "admin") {
    sendJson(response, 400, { error: "超级管理员账号不可在员工授权页修改" });
    return;
  }
  Object.assign(user, { role, spaces, disabled: Boolean(payload.disabled), updatedAt: now });
  if (user.disabled) {
    AUTH_STORE.sessions = AUTH_STORE.sessions.filter((session) => session.userId !== user.id);
    await PERSISTENCE.deleteUserSessions(user.id);
  }
  await saveAuthStore(AUTH_STORE);
  await appendAuditLog({ request, user: actor, action: "user.update", target: user.username, detail: `${role} / ${spaces.join(", ")}` });
  sendJson(response, 200, { ok: true, user: sanitizeUser(user), users: AUTH_STORE.users.map(sanitizeUser) });
}

async function handleAuditLogs(request, response, requestUrl) {
  const user = request.authUser;
  if (!user || !["admin", "manager"].includes(user.role)) {
    sendForbidden(response, "只有管理员可以查看操作日志");
    return;
  }
  let logs = await readAuditLogs(requestUrl.searchParams.get("limit") || 100);
  if (user.role === "manager") {
    const allowed = new Set(user.spaces || []);
    logs = logs.filter((item) => !item.space || allowed.has(item.space));
  }
  sendJson(response, 200, { ok: true, logs });
}

async function handleRebuildVectorIndex(request, response) {
  const user = request.authUser;
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }
  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response, "只有项目资料管理员可以更新语义索引");
    return;
  }
  if (!VECTOR_ENABLED) {
    sendJson(response, 409, { error: "当前没有启用向量语义检索" });
    return;
  }
  try {
    const paths = await ensureKnowledgeBase(space);
    await syncExistingCitationEvidence(space);
    const result = await runVectorCommand(paths, "build", "", Boolean(payload.force));
    for (const cacheKey of vectorQueryCache.keys()) {
      if (cacheKey.startsWith(`${paths.id}:`)) {
        vectorQueryCache.delete(cacheKey);
      }
    }
    await appendAuditLog({ request, user, action: "vector.rebuild", space, detail: `${result.files} files / ${result.chunks} chunks` });
    sendJson(response, 200, { ok: true, space, ...result, status: await readVectorIndexStatus(paths.vectorIndex) });
  } catch (error) {
    sendJson(response, 500, { error: "语义索引更新失败", detail: error instanceof Error ? error.message : String(error) });
  }
}

async function handleSearchDiagnostics(request, response, requestUrl) {
  const user = request.authUser;
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  const query = String(requestUrl.searchParams.get("q") || "").trim();
  if (!userCanManageSpace(user, space)) {
    sendForbidden(response, "只有项目资料管理员可以运行检索诊断");
    return;
  }
  if (!query) {
    sendJson(response, 400, { error: "请输入测试问题" });
    return;
  }
  try {
    const results = await searchKnowledge(query, space);
    sendJson(response, 200, { ok: true, space, query, results });
  } catch (error) {
    sendJson(response, 500, { error: "检索诊断失败", detail: error instanceof Error ? error.message : String(error) });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const routeMap = {
    "/": "/index.html",
    "/admin": "/admin.html",
    "/admin/": "/admin.html",
    "/login": "/login.html",
    "/login/": "/login.html",
  };
  const safePath = routeMap[requestUrl.pathname] || requestUrl.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && ["/", "/admin", "/admin/"].includes(requestUrl.pathname)) {
    const pageUser = await getRequestUser(request);
    if (!pageUser) {
      response.writeHead(302, { Location: "/login" });
      response.end();
      return;
    }
    if (["/admin", "/admin/"].includes(requestUrl.pathname) && pageUser.role === "member") {
      response.writeHead(302, { Location: "/" });
      response.end();
      return;
    }
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/auth/status") {
    await handleAuthStatus(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/setup") {
    await handleAuthSetup(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/login") {
    await handleLogin(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/register") {
    await handleRegister(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
    await handleLogout(request, response);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    const user = await requireUser(request, response);
    if (!user) {
      return;
    }
    request.authUser = user;
    response.authUser = user;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ask") {
    await handleAsk(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/chat-sessions") {
    await handleListChatSessions(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/chat-session") {
    await handleGetChatSession(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/chat-session") {
    await handleCreateChatSession(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/update-kb") {
    await handleUpdateKnowledge(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/import-kb") {
    await handleImportKnowledge(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/import-precheck") {
    await handleImportPrecheck(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/uploads/init") {
    await handleInitChunkedUpload(request, response);
    return;
  }

  const uploadChunkMatch = requestUrl.pathname.match(
    /^\/api\/uploads\/([^/]+)\/files\/(\d+)\/chunks\/(\d+)$/
  );
  if (request.method === "PUT" && uploadChunkMatch) {
    await handleSaveUploadChunk(
      request,
      response,
      decodeURIComponent(uploadChunkMatch[1]),
      uploadChunkMatch[2],
      uploadChunkMatch[3]
    );
    return;
  }

  const uploadCompleteMatch = requestUrl.pathname.match(/^\/api\/uploads\/([^/]+)\/complete$/);
  if (request.method === "POST" && uploadCompleteMatch) {
    await handleCompleteChunkedUpload(
      request,
      response,
      decodeURIComponent(uploadCompleteMatch[1])
    );
    return;
  }

  const uploadStatusMatch = requestUrl.pathname.match(/^\/api\/uploads\/([^/]+)$/);
  if (request.method === "GET" && uploadStatusMatch) {
    await handleGetChunkedUpload(
      request,
      response,
      requestUrl,
      decodeURIComponent(uploadStatusMatch[1])
    );
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/import-jobs") {
    await handleListImportJobs(requestUrl, response);
    return;
  }

  if (request.method === "POST" && /^\/api\/import-jobs\/[^/]+\/retry$/.test(requestUrl.pathname)) {
    await handleRetryImportJob(request, response, requestUrl);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/import-jobs/")) {
    await handleGetImportJob(requestUrl, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/files") {
    await handleListManagedFiles(requestUrl, response);
    return;
  }

  if (request.method === "DELETE" && requestUrl.pathname === "/api/files") {
    await handleDeleteManagedFile(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/trash") {
    await handleListTrash(requestUrl, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/trash/restore") {
    await handleRestoreTrash(request, response);
    return;
  }

  if (request.method === "DELETE" && requestUrl.pathname === "/api/trash") {
    await handlePurgeTrash(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/backups") {
    await handleListBackups(requestUrl, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/backups") {
    await handleCreateBackup(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/backups/restore") {
    await handleRestoreBackup(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/operations-status") {
    await handleOperationsStatus(requestUrl, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/spaces") {
    const spaces = getAccessibleSpaces(request.authUser, await listSpaces());
    sendJson(response, 200, {
      ok: true,
      defaultSpace: spaces.some((space) => space.id === DEFAULT_SPACE_ID)
        ? DEFAULT_SPACE_ID
        : spaces[0]?.id || "",
      spacesRoot: SPACES_ROOT,
      spaces,
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/spaces") {
    await handleCreateSpace(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/kb-status") {
    try {
      const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
      if (!userCanAccessSpace(request.authUser, space)) {
        sendForbidden(response);
        return;
      }
      const status = await getKnowledgeBaseStatus(space);
      sendJson(response, 200, {
        ...status,
        canConfigureVault: request.authUser.role === "admin" && isLocalRequest(request),
        canManage: userCanManageSpace(request.authUser, space),
        user: sanitizeUser(request.authUser),
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: "知识库状态检查失败",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/vault-config") {
    await handleVaultConfig(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/users") {
    await handleListUsers(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/users") {
    await handleSaveUser(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/audit-logs") {
    await handleAuditLogs(request, response, requestUrl);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/vector-index/rebuild") {
    await handleRebuildVectorIndex(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/encryption/migrate") {
    await handleMigrateKnowledgeEncryption(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/search-diagnostics") {
    await handleSearchDiagnostics(request, response, requestUrl);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    const requestedSpace = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
    if (!userCanAccessSpace(request.authUser, requestedSpace)) {
      sendForbidden(response);
      return;
    }
    const status = await getKnowledgeBaseStatus(
      requestedSpace
    );
    sendJson(response, 200, {
      ok: true,
      knowledgeDir: status.knowledgeDir,
      aiProvider: AI_PROVIDER,
      aiBaseUrl: AI_BASE_URL,
      aiModel: AI_MODEL,
      aiVisionModel: AI_VISION_MODEL,
      hasApiKey: Boolean(AI_API_KEY),
      vaultDir: VAULT_DIR,
      spacesRoot: SPACES_ROOT,
      space: status.spaceId,
      updateScript: UPDATE_SCRIPT,
      counts: status.counts,
      latestUpdate: status.latestUpdate,
    });
    return;
  }

  if (request.method === "GET") {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

if (KNOWLEDGE_ENCRYPTION_ENABLED) {
  await getKnowledgeEncryptionKey();
}
await ensureKnowledgeBase(DEFAULT_SPACE_ID);
for (const space of await listSpaces()) {
  await syncExistingCitationEvidence(space.id).catch((error) => {
    console.warn(`引用证据同步失败（${space.id}）：${error.message}`);
  });
}
await migrateLegacyDataToPostgres();
await resumePendingImportJobs();
setTimeout(processImportQueue, 0);
await purgeExpiredTrash().catch(() => {});
await cleanupExpiredUploadSessions().catch(() => {});
await runAutomaticBackups().catch(() => {});
setInterval(() => purgeExpiredTrash().catch(() => {}), 6 * 60 * 60 * 1000).unref();
setInterval(() => cleanupExpiredUploadSessions().catch(() => {}), 6 * 60 * 60 * 1000).unref();
setInterval(() => processImportQueue().catch(() => {}), 1000).unref();
if (AUTO_BACKUP_ENABLED) {
  setInterval(() => runAutomaticBackups().catch(() => {}), 60 * 60 * 1000).unref();
}

server.listen(PORT, () => {
  console.log(`知识库网页已启动：http://localhost:${PORT}`);
  console.log(`知识库总目录：${SPACES_ROOT}`);
  console.log(`知识资料加密：${KNOWLEDGE_ENCRYPTION_ENABLED ? "已启用" : "未启用"}`);
  console.log(`业务数据存储：${PERSISTENCE.enabled ? "PostgreSQL" : "本地兼容模式"}`);
});

async function shutdown() {
  server.close();
  await PERSISTENCE.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
