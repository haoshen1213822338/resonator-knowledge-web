import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadEnv(filePath) {
  const text = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

const imagePaths = process.argv.slice(2);
if (!imagePaths.length) {
  console.error("用法：node scripts/multimodal_smoke_test.mjs <图片1> [图片2 ...]");
  process.exit(1);
}

const env = await loadEnv(path.resolve(".env"));
const content = [
  {
    type: "text",
    text: "请逐张说明图片中的主题、文字、图表或业务信息。使用中文，并按图片编号回答。",
  },
];

for (const [index, imagePath] of imagePaths.entries()) {
  const absolutePath = path.resolve(imagePath);
  const image = await readFile(absolutePath);
  content.push({ type: "text", text: `图片 ${index + 1}：${path.basename(imagePath)}` });
  content.push({
    type: "image_url",
    image_url: {
      url: `data:${getMimeType(imagePath)};base64,${image.toString("base64")}`,
    },
  });
}

const response = await fetch(`${env.AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.AI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: env.AI_VISION_MODEL || env.AI_MODEL,
    messages: [{ role: "user", content }],
    temperature: 0.1,
    max_tokens: 1200,
  }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(payload.error?.message || `请求失败：${response.status}`);
  process.exit(1);
}

console.log(payload.choices?.[0]?.message?.content || "模型没有返回内容。");
