import path from "node:path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);

function cleanFrontmatterValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

export function readCitationMetadata(content) {
  const text = String(content || "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const metadata = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    metadata[key] = cleanFrontmatterValue(line.slice(separator + 1));
  }
  return metadata;
}

export function timestampToSeconds(timestamp) {
  const values = String(timestamp || "").split(":").map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return null;
  return values[0] * 3600 + values[1] * 60 + values[2];
}

function uniqueLocations(locations) {
  const seen = new Set();
  return locations.filter((location) => {
    const key = `${location.type}:${location.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

export function extractCitationLocations(text, sourceType = "") {
  const content = String(text || "");
  const extension = String(sourceType || "").toLowerCase();
  const locations = [];

  if (!extension || extension === ".pdf") {
    for (const match of content.matchAll(/(?:^|[#\s])第\s*(\d+)\s*页(?=$|[\s：:])/gmu)) {
      const page = Number(match[1]);
      locations.push({ type: "page", label: `第 ${page} 页`, page });
    }
  }

  if (!extension || [".ppt", ".pptx"].includes(extension)) {
    for (const match of content.matchAll(/(?:^|[#\s])幻灯片\s*(\d+)(?=$|[\s：:])/gmu)) {
      const slide = Number(match[1]);
      locations.push({ type: "slide", label: `幻灯片 ${slide}`, slide });
    }
  }

  if (!extension || VIDEO_EXTENSIONS.has(extension)) {
    for (const match of content.matchAll(/\b(\d{2}:\d{2}:\d{2})(?:\s*[-–—至到]\s*(\d{2}:\d{2}:\d{2}))?/g)) {
      const start = match[1];
      const end = match[2] || "";
      locations.push({
        type: "time",
        label: end && end !== start ? `${start}–${end}` : start,
        start,
        end,
        startSeconds: timestampToSeconds(start),
        endSeconds: end ? timestampToSeconds(end) : null,
      });
    }
  }

  return uniqueLocations(locations);
}

export function formatCitationLocator(locations) {
  const items = Array.isArray(locations) ? locations : [];
  if (!items.length) return "";
  const visible = items.slice(0, 3).map((item) => item.label);
  return `${visible.join("、")}${items.length > visible.length ? ` 等 ${items.length} 处` : ""}`;
}

export function decorateCitation(item, content = "") {
  const metadata = {
    ...readCitationMetadata(content),
    ...(item.citationMetadata || {}),
  };
  const sourceFile = metadata.source_file || item.sourceFile || item.file || "未知文件";
  const sourcePath = metadata.source_path || item.sourcePath || item.relativePath || item.path || "";
  const sourceType = metadata.source_type || item.sourceType || path.extname(sourceFile).toLowerCase();
  const locationText = [item.heading, item.snippet, ...(item.semanticSnippets || [])]
    .filter(Boolean)
    .join("\n");
  const locations = uniqueLocations([
    ...(Array.isArray(item.locations) ? item.locations : []),
    ...extractCitationLocations(locationText, sourceType),
  ]);
  return {
    ...item,
    file: sourceFile,
    sourceFile,
    sourcePath,
    sourceType,
    evidenceFile: metadata.citation_evidence === "true" || metadata.citation_evidence === true
      ? item.relativePath || item.path || ""
      : item.evidenceFile || "",
    locations,
    locator: formatCitationLocator(locations),
  };
}

export function buildCitationEvidence({ project, sourceFile, sourcePath, sourceType, content }) {
  return [
    "---",
    "citation_evidence: true",
    `project: ${JSON.stringify(String(project || "待分类"))}`,
    `source_file: ${JSON.stringify(String(sourceFile || "未知文件"))}`,
    `source_path: ${JSON.stringify(String(sourcePath || ""))}`,
    `source_type: ${JSON.stringify(String(sourceType || path.extname(sourceFile || "")).toLowerCase())}`,
    "---",
    "",
    `# ${sourceFile} 引用证据`,
    "",
    String(content || "").trim() || "未提取到可引用内容。",
    "",
  ].join("\n");
}
