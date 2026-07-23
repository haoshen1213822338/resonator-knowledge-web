import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await loadEnvFile(path.join(__dirname, ".env"));

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
const VAULT_DIR = process.env.VAULT_DIR || path.dirname(KNOWLEDGE_DIR);
const UPDATE_SCRIPT = process.env.UPDATE_SCRIPT ||
  path.join(VAULT_DIR, "99_系统配置", "scripts", "update_kb.py");
const PYTHON_CMD = process.env.PYTHON_CMD || "python";
const DEFAULT_UPDATE_INPUT =
  process.env.DEFAULT_UPDATE_INPUT ||
  "00_原始资料\\候选材料包\\流程测试_梦星鸣潮_每日返图";
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.join(VAULT_DIR, "00_原始资料", "网页上传");
const PROJECT_STOP_WORDS = new Set([
  "梦星",
  "鸣潮",
  "梦星鸣潮",
  "崩铁",
  "星铁",
  "星穹",
  "铁道",
]);

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
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

async function callResponsesApi(question, results, instructions, knowledgeContext) {
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

async function callChatCompletionsApi(question, results, instructions, knowledgeContext) {
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

async function callAI(question, results) {
  if (!AI_API_KEY) {
    return null;
  }

  const knowledgeContext = buildKnowledgeContext(results);
  const instructions = [
    "你是公司的知识库问答助手。",
    "只能根据提供的本地知识库片段回答。",
    "如果资料不足，直接说资料不足，不要编造。",
    "回答要简洁、可执行，适合客服、管理员或接单人员直接使用。",
    "不要输出手机号、订单号、账号、密码、验证码等敏感信息。",
    "最后用“参考：文件名”列出用到的知识文件。",
  ].join("\n");

  if (AI_PROVIDER === "openai-responses") {
    return callResponsesApi(question, results, instructions, knowledgeContext);
  }

  return callChatCompletionsApi(question, results, instructions, knowledgeContext);
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, " ")
    .trim();
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

function buildSnippet(content, tokens) {
  const lines = content.split(/\r?\n/);
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
    return lines.slice(0, 10).join("\n").slice(0, 1800);
  }

  let start = Math.max(0, hitIndex - 3);
  for (let index = hitIndex; index >= 0; index -= 1) {
    if (/^#{2,3}\s+/.test(lines[index])) {
      start = index;
      break;
    }
  }

  let end = Math.min(lines.length, start + 34);
  for (let index = hitIndex + 1; index < lines.length; index += 1) {
    if (/^#{2}\s+/.test(lines[index])) {
      end = Math.min(index, start + 34);
      break;
    }
  }

  return lines
    .slice(start, end)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 1800);
}

function scoreDocument(content, fileName, tokens) {
  const lowerContent = content.toLowerCase();
  const lowerFileName = fileName.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contentCount = lowerContent.match(new RegExp(escaped, "g"))?.length || 0;
    const fileCount = lowerFileName.match(new RegExp(escaped, "g"))?.length || 0;
    score += contentCount * Math.min(token.length, 10);
    score += fileCount * Math.min(token.length, 10) * 4;
  }
  return score;
}

async function listMarkdownFiles(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const info = await stat(fullPath);
    if (info.isFile() && entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function searchKnowledge(question) {
  const tokens = tokenize(question);
  if (tokens.length === 0) {
    return [];
  }

  const files = await listMarkdownFiles(KNOWLEDGE_DIR);
  const results = [];
  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    const fileName = path.basename(filePath);
    const score = scoreDocument(content, fileName, tokens);
    if (score > 0) {
      results.push({
        file: fileName,
        path: filePath,
        score,
        snippet: buildSnippet(content, tokens),
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
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      sendJson(response, 413, { error: "请求过大" });
      return;
    }
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    sendJson(response, 400, { error: "请求格式不是有效 JSON" });
    return;
  }

  const question = String(payload.question || "").trim();
  if (!question) {
    sendJson(response, 400, { error: "请输入问题" });
    return;
  }

  try {
    const results = await searchKnowledge(question);
    const aiAnswer = await callAI(question, results);
    sendJson(response, 200, {
      answer: aiAnswer || buildDraftAnswer(question, results),
      citations: results,
      mode: aiAnswer ? "ai" : "local-search",
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
  if (![".md", ".txt", ".csv"].includes(extension)) {
    throw new Error("目前只支持上传 .md、.txt、.csv 文件。");
  }
  if (file.buffer.length === 0) {
    throw new Error(`文件内容为空：${file.fileName}`);
  }
}

async function saveUploadedFiles(project, files) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  const folderName = `${timestamp}_${safePathSegment(project)}`;
  const uploadDir = path.join(UPLOAD_ROOT, folderName);
  await mkdir(uploadDir, { recursive: true });

  const savedFiles = [];
  for (const file of files) {
    validateUploadFile(file);
    const fileName = safePathSegment(path.basename(file.fileName));
    const targetPath = path.join(uploadDir, fileName);
    await writeFile(targetPath, file.buffer);
    savedFiles.push(targetPath);
  }

  const relativeInput = path.relative(VAULT_DIR, uploadDir);
  return { uploadDir, relativeInput, savedFiles };
}

async function handleImportKnowledge(request, response) {
  try {
    const bodyBuffer = await readRequestBuffer(request);
    const { fields, files } = parseMultipartForm(request, bodyBuffer);
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

    const saved = await saveUploadedFiles(project, files);
    const result = await runUpdateScript({
      input: saved.relativeInput,
      project,
      mode,
      outputName,
      dryRun,
    });

    sendJson(response, 200, {
      ok: true,
      dryRun,
      uploadDir: saved.uploadDir,
      savedFiles: saved.savedFiles,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: "资料上传或整理失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const safePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
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
  if (request.method === "POST" && request.url === "/api/ask") {
    await handleAsk(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/update-kb") {
    await handleUpdateKnowledge(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/import-kb") {
    await handleImportKnowledge(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      knowledgeDir: KNOWLEDGE_DIR,
      aiProvider: AI_PROVIDER,
      aiBaseUrl: AI_BASE_URL,
      aiModel: AI_MODEL,
      hasApiKey: Boolean(AI_API_KEY),
      vaultDir: VAULT_DIR,
      updateScript: UPDATE_SCRIPT,
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

server.listen(PORT, () => {
  console.log(`知识库网页已启动：http://localhost:${PORT}`);
  console.log(`知识库目录：${KNOWLEDGE_DIR}`);
});
