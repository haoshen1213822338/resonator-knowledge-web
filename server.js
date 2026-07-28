import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const PUBLIC_DIR = path.join(__dirname, "public");
let VAULT_DIR = LOCAL_CONFIG.vaultDir || process.env.VAULT_DIR || path.dirname(KNOWLEDGE_DIR);
let SPACES_ROOT =
  LOCAL_CONFIG.spacesRoot || process.env.SPACES_ROOT || path.join(VAULT_DIR, "knowledge_spaces");
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

function isLocalRequest(request) {
  const host = String(request.headers.host || "").split(":")[0].toLowerCase();
  const remoteAddress = request.socket.remoteAddress || "";
  return [
    "localhost",
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ].includes(host) || [
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
}

function getSpacePaths(spaceId = DEFAULT_SPACE_ID) {
  const id = normalizeSpaceId(spaceId);
  const root = path.join(SPACES_ROOT, id);
  const rawDir = path.join(root, "00_原始资料");
  const uploadRoot = path.join(rawDir, "网页上传");
  const knowledgeDir = path.join(root, "90_AI输出");
  const systemDir = path.join(root, "99_系统配置");
  const chatDir = path.join(systemDir, "chat_sessions");
  const updateLogDir = path.join(systemDir, "update_logs");
  const importIndex = path.join(systemDir, "资料入库记录.md");
  return {
    id,
    root,
    rawDir,
    uploadRoot,
    knowledgeDir,
    systemDir,
    chatDir,
    updateLogDir,
    importIndex,
    folders: [
      rawDir,
      uploadRoot,
      knowledgeDir,
      systemDir,
      chatDir,
      path.join(systemDir, "scripts"),
      updateLogDir,
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

async function getKnowledgeBaseStatus(spaceId = DEFAULT_SPACE_ID) {
  const paths = await ensureKnowledgeBase(spaceId);

  const rawFiles = await listFilesRecursive(paths.rawDir, SUPPORTED_UPLOAD_EXTENSIONS);
  const uploadedFiles = await listFilesRecursive(paths.uploadRoot, SUPPORTED_UPLOAD_EXTENSIONS);
  const aiFiles = await listFilesRecursive(paths.knowledgeDir, new Set([".md"]));
  const allFiles = [...rawFiles, ...aiFiles];

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
    counts: {
      rawFiles: rawFiles.length,
      uploadedFiles: uploadedFiles.length,
      aiFiles: aiFiles.length,
    },
    latestUpdate: await getLatestWriteTime(allFiles),
  };
}

function buildKnowledgeContext(results) {
  return results
    .map((item, index) => {
      return [
        `[${index + 1}] ${item.file}`,
        item.snippet,
      ].join("\n");
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
    "只能根据提供的本地知识库片段回答。",
    "如果资料不足，直接说资料不足，不要编造。",
    "回答要简洁、可执行，适合客服、管理员或接单人员直接使用。",
    "你可以结合上一轮对话理解追问、省略指代和连续任务。",
    "但事实依据仍然必须来自本地知识库片段；如果片段不足，要说明资料不足。",
    "不要输出手机号、订单号、账号、密码、验证码等敏感信息。",
    "最后用“参考：文件名”列出用到的知识文件。",
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

function runFileExtractor(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PARSER_PYTHON_CMD, [FILE_EXTRACTOR_SCRIPT, filePath], {
      cwd: __dirname,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      let payload;
      try {
        payload = JSON.parse(stdout || "{}");
      } catch {
        reject(new Error(`文件解析器返回了无法读取的结果：${stderr || stdout}`));
        return;
      }

      if (code !== 0 || !payload.ok) {
        reject(new Error(payload.error || stderr || `文件解析失败：${filePath}`));
        return;
      }
      resolve(payload);
    });
  });
}

function getExtractedFileName(filePath) {
  const parsed = path.parse(filePath);
  return `${parsed.name}_解析结果.md`;
}

async function loadUploadedDocuments(savedFiles, spaceRoot) {
  const documents = [];
  for (const filePath of savedFiles) {
    const parsed = await runFileExtractor(filePath);
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
    ].join("\n");
    await writeFile(extractedPath, extractedContent, "utf8");
    documents.push({
      fileName: path.basename(filePath),
      relativePath: path.relative(spaceRoot, filePath),
      extractedPath,
      content: parsed.content || "",
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

function createEmptySession(spaceId, title = "新对话") {
  const now = new Date().toISOString();
  return {
    id: createSessionId(),
    space: normalizeSpaceId(spaceId),
    title: String(title || "新对话").trim().slice(0, 40) || "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

async function readChatSession(spaceId, sessionId) {
  await ensureKnowledgeBase(spaceId);
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
  return normalizedSession;
}

async function listChatSessions(spaceId = DEFAULT_SPACE_ID) {
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
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  try {
    sendJson(response, 200, {
      ok: true,
      space,
      sessions: await listChatSessions(space),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "读取历史对话失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleGetChatSession(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const space = normalizeSpaceId(requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID);
  const sessionId = normalizeSessionId(requestUrl.searchParams.get("session") || "");
  try {
    const session = await readChatSession(space, sessionId);
    if (!session) {
      sendJson(response, 404, { error: "没有找到这个历史对话" });
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
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const space = normalizeSpaceId(payload.space || DEFAULT_SPACE_ID);
  try {
    const session = await writeChatSession(
      space,
      createEmptySession(space, payload.title || "新对话")
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
async function writeKnowledgeOutput({ spaceId, project, mode, outputName, savedFiles, content }) {
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

  await writeFile(outputPath, finalContent, "utf8");

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

  return { outputPath, logPath };
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

  return mergeSnippets([leadSnippet, intentSnippet, keywordSnippet]) || leadSnippet;
}

function scoreDocument(content, fileName, tokens, question = "", aliasGroups = []) {
  const lowerContent = stripLowValueSections(content).toLowerCase();
  const lowerFileName = fileName.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contentCount = lowerContent.match(new RegExp(escaped, "g"))?.length || 0;
    const fileCount = lowerFileName.match(new RegExp(escaped, "g"))?.length || 0;
    score += contentCount * Math.min(token.length, 10);
    score += fileCount * Math.min(token.length, 10) * 4;
  }
  score += scoreAliasMatch(content, fileName, question, aliasGroups);
  return score;
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
  if (tokens.length === 0) {
    return [];
  }

  const files = await listMarkdownFiles(paths.knowledgeDir);
  const results = [];
  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    const fileName = path.basename(filePath);
    const score = scoreDocument(content, fileName, tokens, question, aliasGroups);
    if (score > 0) {
      results.push({
        file: fileName,
        path: filePath,
        score,
        snippet: buildSnippet(content, tokens, question, intent),
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
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

  try {
    let session = requestedSessionId
      ? await readChatSession(space, requestedSessionId)
      : null;
    if (!session) {
      session = createEmptySession(space, buildSessionTitle(question));
    }
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
  const payload = await readRequestJson(request, response);
  if (!payload) {
    return;
  }

  const project = String(payload.project || "梦星鸣潮").trim();
  const input = String(payload.input || DEFAULT_UPDATE_INPUT).trim();
  const mode = String(payload.mode || "mixed").trim();
  const outputName = String(payload.outputName || "").trim();
  const dryRun = Boolean(payload.dryRun);

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

async function readRequestBuffer(request) {
  const chunks = [];
  for await (const chunk of request) {
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
    result[rawKey] = Buffer.from(rawParameter, "latin1").toString("utf8");
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

  const body = bodyBuffer.toString("latin1");
  const parts = body.split(`--${boundary}`);
  const fields = {};
  const files = [];

  for (const rawPart of parts) {
    if (!rawPart || rawPart === "--\r\n" || rawPart === "--") {
      continue;
    }

    const part = rawPart.replace(/^\r\n/, "").replace(/\r\n--$/, "");
    const separatorIndex = part.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
      continue;
    }

    const rawHeaders = part.slice(0, separatorIndex);
    let content = part.slice(separatorIndex + 4);
    if (content.endsWith("\r\n")) {
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
        buffer: Buffer.from(content, "latin1"),
      });
    } else {
      fields[disposition.name] = Buffer.from(content, "latin1").toString("utf8");
    }
  }

  return { fields, files };
}

function safePathSegment(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\r\n]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "未命名";
}

function validateUploadFile(file) {
  const extension = path.extname(file.fileName).toLowerCase();
  if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
    throw new Error("目前支持上传 md、txt、csv、Word、PDF、Excel、PPT、图片和常见视频文件。");
  }
  if (file.buffer.length === 0) {
    throw new Error(`文件内容为空：${file.fileName}`);
  }
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
    const fileName = safePathSegment(path.basename(file.fileName));
    const targetPath = path.join(uploadDir, fileName);
    await writeFile(targetPath, file.buffer);
    savedFiles.push(targetPath);
  }

  const relativeInput = path.relative(paths.root, uploadDir);
  return { uploadDir, relativeInput, savedFiles, spaceRoot: paths.root };
}

async function handleImportKnowledge(request, response) {
  try {
    const bodyBuffer = await readRequestBuffer(request);
    const { fields, files } = parseMultipartForm(request, bodyBuffer);
    const space = normalizeSpaceId(fields.space || DEFAULT_SPACE_ID);
    const project = String(fields.project || "未命名项目").trim();
    const mode = String(fields.mode || "mixed").trim();
    const outputName = String(fields.outputName || "").trim();
    const dryRun = fields.dryRun === "true";

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

    const saved = await saveUploadedFiles(space, project, files);
    let result;
    if (dryRun) {
      const documents = await loadUploadedDocuments(saved.savedFiles, saved.spaceRoot);
      const totalChars = documents.reduce((total, item) => total + item.content.length, 0);
      result = {
        stdout: [
          "Dry run: 不调用 API，不写入 90_AI输出。",
          `项目：${project}`,
          `模式：${mode}`,
          `输入文件数：${documents.length}`,
          `预计发送字符数：${Math.min(totalChars, 48_000)}`,
          ...documents.map((item) => `- ${item.relativePath}`),
        ].join("\n"),
        stderr: "",
      };
    } else {
      const documents = await loadUploadedDocuments(saved.savedFiles, saved.spaceRoot);
      const organizedContent = await callOrganizationApi({ project, mode, documents });
      const written = await writeKnowledgeOutput({
        spaceId: space,
        project,
        mode,
        outputName,
        savedFiles: saved.savedFiles,
        content: organizedContent,
      });
      result = {
        stdout: [
          `知识整理已生成：${written.outputPath}`,
          `更新日志已记录：${written.logPath}`,
          `原始资料目录：${saved.uploadDir}`,
        ].join("\n"),
        stderr: "",
        outputPath: written.outputPath,
        logPath: written.logPath,
      };
    }

    sendJson(response, 200, {
      ok: true,
      dryRun,
      space,
      uploadDir: saved.uploadDir,
      savedFiles: saved.savedFiles,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
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

async function handleCreateSpace(request, response) {
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

  try {
    const paths = await ensureKnowledgeBase(name);
    sendJson(response, 200, {
      ok: true,
      space: {
        id: name,
        name,
        root: paths.root,
      },
      spaces: await listSpaces(),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "创建项目库失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleVaultConfig(request, response) {
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

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const routeMap = {
    "/": "/index.html",
    "/admin": "/admin.html",
    "/admin/": "/admin.html",
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

  if (request.method === "GET" && requestUrl.pathname === "/api/spaces") {
    sendJson(response, 200, {
      ok: true,
      defaultSpace: DEFAULT_SPACE_ID,
      spacesRoot: SPACES_ROOT,
      spaces: await listSpaces(),
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/spaces") {
    await handleCreateSpace(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/kb-status") {
    try {
      const status = await getKnowledgeBaseStatus(
        requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID
      );
      sendJson(response, 200, {
        ...status,
        canConfigureVault: isLocalRequest(request),
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

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    const status = await getKnowledgeBaseStatus(
      requestUrl.searchParams.get("space") || DEFAULT_SPACE_ID
    );
    sendJson(response, 200, {
      ok: true,
      knowledgeDir: status.knowledgeDir,
      aiProvider: AI_PROVIDER,
      aiBaseUrl: AI_BASE_URL,
      aiModel: AI_MODEL,
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

await ensureKnowledgeBase(DEFAULT_SPACE_ID);

server.listen(PORT, () => {
  console.log(`知识库网页已启动：http://localhost:${PORT}`);
  console.log(`知识库总目录：${SPACES_ROOT}`);
});
