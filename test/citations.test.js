import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCitationEvidence,
  decorateCitation,
  extractCitationLocations,
  formatCitationLocator,
} from "../lib/citations.js";

test("extracts PDF page and PowerPoint slide locators", () => {
  assert.deepEqual(extractCitationLocations("## 第 12 页\n关键结论", ".pdf"), [
    { type: "page", label: "第 12 页", page: 12 },
  ]);
  assert.deepEqual(extractCitationLocations("### 幻灯片 7\n营销节奏", ".pptx"), [
    { type: "slide", label: "幻灯片 7", slide: 7 },
  ]);
});

test("extracts exact video time ranges", () => {
  const locations = extractCitationLocations(
    "- 00:01:12 - 00:01:26：客户说明核心需求",
    ".mp4"
  );
  assert.equal(locations[0].label, "00:01:12–00:01:26");
  assert.equal(locations[0].startSeconds, 72);
  assert.equal(locations[0].endSeconds, 86);
});

test("decorates evidence results with original source details", () => {
  const evidence = buildCitationEvidence({
    project: "测试项目",
    sourceFile: "案例.pdf",
    sourcePath: "00_原始资料/案例.pdf",
    sourceType: ".pdf",
    content: "## 第 3 页\n核心内容",
  });
  const citation = decorateCitation({
    file: "案例_引用证据.md",
    relativePath: "_引用证据/案例_引用证据.md",
    snippet: "## 第 3 页\n核心内容",
    score: 100,
  }, evidence);
  assert.equal(citation.file, "案例.pdf");
  assert.equal(citation.sourcePath, "00_原始资料/案例.pdf");
  assert.equal(citation.locator, "第 3 页");
  assert.equal(formatCitationLocator(citation.locations), "第 3 页");
});
