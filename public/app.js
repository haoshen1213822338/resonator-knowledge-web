const form = document.querySelector("#ask-form");
const questionInput = document.querySelector("#question");
const answerBox = document.querySelector("#answer");
const sourcesBox = document.querySelector("#sources");
const sampleButton = document.querySelector("#sample-button");
const canvas = document.querySelector("#resonance-canvas");
const kbProject = document.querySelector("#kb-project");
const kbFile = document.querySelector("#kb-file");
const kbMode = document.querySelector("#kb-mode");
const kbOutputName = document.querySelector("#kb-output-name");
const kbDryRun = document.querySelector("#kb-dry-run");
const kbUpdate = document.querySelector("#kb-update");
const kbStatus = document.querySelector("#kb-status");
const kbSpaceAction = document.querySelector("#kb-space-action");
const kbTargetSpace = document.querySelector("#kb-target-space");
const kbExistingSpaceLabel = document.querySelector("#kb-existing-space-label");
const kbNewSpaceLabel = document.querySelector("#kb-new-space-label");
const kbNewSpaceName = document.querySelector("#kb-new-space-name");
const spaceSelect = document.querySelector("#space-select");
const newSpaceName = document.querySelector("#new-space-name");
const createSpace = document.querySelector("#create-space");
const spaceMessage = document.querySelector("#space-message");
const vaultPanel = document.querySelector("#vault-panel");
const vaultPath = document.querySelector("#vault-path");
const initVault = document.querySelector("#init-vault");
const vaultMessage = document.querySelector("#vault-message");
const vaultState = document.querySelector("#vault-state");
const aiFileCount = document.querySelector("#ai-file-count");
const rawFileCount = document.querySelector("#raw-file-count");
const apiState = document.querySelector("#api-state");
const kbPath = document.querySelector("#kb-path");
const refreshStatus = document.querySelector("#refresh-status");

const root = document.documentElement;
const pointer = {
  x: window.innerWidth / 2,
  y: window.innerHeight * 0.35,
};
const smoothPointer = { ...pointer };

function setLoading() {
  answerBox.className = "answer";
  answerBox.textContent = "正在搜索本地知识库，并交给 AI 总结...";
  sourcesBox.className = "sources empty";
  sourcesBox.textContent = "正在查找引用来源。";
}

function renderSources(citations) {
  if (!citations || citations.length === 0) {
    sourcesBox.className = "sources empty";
    sourcesBox.textContent = "没有找到相关知识文件。";
    return;
  }

  sourcesBox.className = "sources";
  sourcesBox.innerHTML = citations
    .map(
      (item) => `
        <div class="source-item">
          <p class="source-title">${escapeHtml(item.file)}</p>
          <div class="source-meta">相关度：${item.score}</div>
          <div class="source-snippet">${escapeHtml(item.snippet)}</div>
        </div>
      `,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updatePointer(event) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
}

function syncPointerTokens() {
  smoothPointer.x += (pointer.x - smoothPointer.x) * 0.09;
  smoothPointer.y += (pointer.y - smoothPointer.y) * 0.09;

  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const normalizedX = smoothPointer.x / width - 0.5;
  const normalizedY = smoothPointer.y / height - 0.5;

  root.style.setProperty("--pointer-x", `${smoothPointer.x}px`);
  root.style.setProperty("--pointer-y", `${smoothPointer.y}px`);
  root.style.setProperty("--tilt-x", `${normalizedY * -14}deg`);
  root.style.setProperty("--tilt-y", `${normalizedX * 22}deg`);
  root.style.setProperty("--drift-x", `${normalizedX * 22}px`);
  root.style.setProperty("--drift-y", `${normalizedY * 14}px`);

  return { normalizedX, normalizedY };
}

function createResonanceField() {
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    return () => {};
  }

  const particles = Array.from({ length: 58 }, (_, index) => ({
    seed: index * 37.17,
    x: Math.random(),
    y: Math.random() * 0.78,
    size: 0.6 + Math.random() * 1.6,
    depth: 0.25 + Math.random() * 0.9,
    phase: Math.random() * Math.PI * 2,
  }));

  let width = 0;
  let height = 0;
  let ratio = 1;
  let animationId = 0;
  const start = performance.now();

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function drawRibbon(time, layer) {
    const centerX = width * 0.5;
    const horizon = Math.min(height * 0.36, 310);
    const influenceX = (smoothPointer.x - centerX) * (0.06 + layer * 0.018);
    const influenceY = (smoothPointer.y - height * 0.34) * (0.025 + layer * 0.008);
    const amplitude = 82 + layer * 34;
    const lift = layer * 18;
    const alpha = 0.2 - layer * 0.035;
    const lineWidth = 18 - layer * 3;

    const gradient = ctx.createLinearGradient(width * 0.16, 0, width * 0.84, 0);
    gradient.addColorStop(0, `rgba(59, 87, 255, ${alpha * 0.4})`);
    gradient.addColorStop(0.32, `rgba(130, 94, 255, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(255, 235, 255, ${alpha + 0.16})`);
    gradient.addColorStop(0.64, `rgba(255, 213, 74, ${alpha * 0.5})`);
    gradient.addColorStop(1, `rgba(59, 87, 255, ${alpha * 0.38})`);

    ctx.beginPath();
    for (let step = 0; step <= 180; step += 1) {
      const progress = step / 180;
      const x = width * (0.12 + progress * 0.76);
      const distance = Math.abs(progress - 0.5) * 2;
      const arch = Math.pow(1 - distance, 0.72);
      const wave =
        Math.sin(progress * Math.PI * 3.2 + time * (0.55 + layer * 0.08)) *
        (10 + layer * 3);
      const y =
        horizon +
        amplitude * (1 - arch) -
        arch * (96 - layer * 12) +
        wave +
        lift +
        influenceY * arch;
      const bentX = x + influenceX * Math.sin(progress * Math.PI) * (1.2 - layer * 0.16);

      if (step === 0) {
        ctx.moveTo(bentX, y);
      } else {
        ctx.lineTo(bentX, y);
      }
    }

    ctx.strokeStyle = gradient;
    ctx.lineWidth = Math.max(lineWidth, 2);
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(139, 101, 255, 0.48)";
    ctx.shadowBlur = 28 + layer * 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawEnergyCore(time) {
    const x = width * 0.5 + (smoothPointer.x - width * 0.5) * 0.045;
    const y = Math.min(height * 0.24, 190) + (smoothPointer.y - height * 0.35) * 0.025;
    const pulse = 1 + Math.sin(time * 2.4) * 0.08;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, 150 * pulse);
    glow.addColorStop(0, "rgba(255, 230, 119, 0.42)");
    glow.addColorStop(0.32, "rgba(154, 104, 255, 0.26)");
    glow.addColorStop(1, "rgba(6, 7, 24, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 150 * pulse, 0, Math.PI * 2);
    ctx.fill();

    for (let ring = 0; ring < 4; ring += 1) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * (0.32 + ring * 0.08) + ring * 1.1);
      ctx.scale(1, 0.34 + ring * 0.08);
      ctx.strokeStyle =
        ring === 1
          ? "rgba(255, 213, 74, 0.3)"
          : "rgba(210, 190, 255, 0.22)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 44 + ring * 11, 44 + ring * 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = "rgba(255, 231, 128, 0.9)";
    ctx.beginPath();
    ctx.arc(x, y, 8 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParticles(time) {
    for (const particle of particles) {
      const driftX = Math.sin(time * 0.18 + particle.phase) * 18 * particle.depth;
      const driftY = Math.cos(time * 0.14 + particle.phase) * 9 * particle.depth;
      const parallaxX = (smoothPointer.x / width - 0.5) * 34 * particle.depth;
      const parallaxY = (smoothPointer.y / height - 0.5) * 18 * particle.depth;
      const x = particle.x * width + driftX + parallaxX;
      const y = particle.y * height + driftY + parallaxY;
      const twinkle = 0.34 + Math.sin(time * 1.7 + particle.seed) * 0.22;

      ctx.fillStyle = `rgba(230, 226, 255, ${twinkle})`;
      ctx.beginPath();
      ctx.arc(x, y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    const time = (now - start) / 1000;
    const { normalizedX, normalizedY } = syncPointerTokens();

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";

    const base = ctx.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "rgba(7, 8, 25, 0.72)");
    base.addColorStop(0.5, "rgba(12, 7, 45, 0.4)");
    base.addColorStop(1, "rgba(3, 4, 14, 0.82)");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    drawRibbon(time, 3);
    drawRibbon(time, 2);
    drawRibbon(time, 1);
    drawRibbon(time, 0);
    drawEnergyCore(time);
    drawParticles(time);

    ctx.globalCompositeOperation = "source-over";
    const vignette = ctx.createRadialGradient(
      width * (0.5 + normalizedX * 0.04),
      height * (0.34 + normalizedY * 0.04),
      width * 0.08,
      width * 0.5,
      height * 0.44,
      width * 0.72,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.44)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    animationId = requestAnimationFrame(frame);
  }

  resize();
  animationId = requestAnimationFrame(frame);
  window.addEventListener("resize", resize, { passive: true });

  return () => {
    cancelAnimationFrame(animationId);
    window.removeEventListener("resize", resize);
  };
}

function formatLatestUpdate(value) {
  if (!value) {
    return "暂无资料";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCurrentSpace() {
  return spaceSelect.value || localStorage.getItem("currentKnowledgeSpace") || "";
}

function setSpaceMessage(message, type = "") {
  spaceMessage.className = type ? `space-message ${type}` : "space-message";
  spaceMessage.textContent = message;
}

function setVaultMessage(message, type = "") {
  vaultMessage.className = type ? `vault-message ${type}` : "vault-message";
  vaultMessage.textContent = message;
}

function renderSpaces(spaces, selectedSpace) {
  const options = spaces
    .map((space) => {
      const selected = space.id === selectedSpace ? "selected" : "";
      return `<option value="${space.id}" ${selected}>${space.name}</option>`;
    })
    .join("");
  spaceSelect.innerHTML = options;
  kbTargetSpace.innerHTML = options;
}

async function loadSpaces(preferredSpace = localStorage.getItem("currentKnowledgeSpace")) {
  const response = await fetch("/api/spaces");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "项目库列表读取失败");
  }

  const spaces = payload.spaces || [];
  const selected = spaces.some((space) => space.id === preferredSpace)
    ? preferredSpace
    : payload.defaultSpace || spaces[0]?.id || "";
  renderSpaces(spaces, selected);
  if (selected) {
    spaceSelect.value = selected;
    kbTargetSpace.value = selected;
    localStorage.setItem("currentKnowledgeSpace", selected);
  }
}

async function createKnowledgeSpace() {
  const name = newSpaceName.value.trim();
  if (!name) {
    setSpaceMessage("请输入项目库名称。", "error");
    return;
  }

  createSpace.disabled = true;
  setSpaceMessage("正在创建项目库...");
  try {
    const response = await fetch("/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "项目库创建失败");
    }

    await loadSpaces(payload.space.id);
    newSpaceName.value = "";
    setSpaceMessage(`已创建并切换到：${payload.space.name}`, "success");
    await loadKnowledgeStatus();
  } catch (error) {
    setSpaceMessage(
      error instanceof Error ? error.message : "项目库创建失败。",
      "error"
    );
  } finally {
    createSpace.disabled = false;
  }
}

async function createSpaceByName(name) {
  const response = await fetch("/api/spaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "资料库创建失败");
  }
  await loadSpaces(payload.space.id);
  return payload.space.id;
}

function syncImportMode() {
  const isCreate = kbSpaceAction.value === "create";
  kbExistingSpaceLabel.classList.toggle("hidden", isCreate);
  kbNewSpaceLabel.classList.toggle("hidden", !isCreate);
}

async function resolveImportSpace() {
  if (kbSpaceAction.value === "existing") {
    const selectedSpace = kbTargetSpace.value || getCurrentSpace();
    if (!selectedSpace) {
      throw new Error("请先选择要加入的已有资料库。");
    }
    return selectedSpace;
  }

  const name = kbNewSpaceName.value.trim();
  if (!name) {
    throw new Error("请输入新资料库名称。");
  }
  const createdSpace = await createSpaceByName(name);
  kbNewSpaceName.value = "";
  kbTargetSpace.value = createdSpace;
  spaceSelect.value = createdSpace;
  localStorage.setItem("currentKnowledgeSpace", createdSpace);
  setSpaceMessage(`已创建并切换到：${createdSpace}`, "success");
  return createdSpace;
}

async function initializeVaultPath() {
  const nextPath = vaultPath.value.trim();
  if (!nextPath) {
    setVaultMessage("请输入要作为 Obsidian 总仓库的本地路径。", "error");
    return;
  }

  initVault.disabled = true;
  setVaultMessage("正在初始化本地知识库路径...");
  try {
    const response = await fetch("/api/vault-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultDir: nextPath }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "知识库路径初始化失败");
    }

    localStorage.setItem("currentKnowledgeSpace", payload.status.spaceId);
    await loadSpaces(payload.status.spaceId);
    await loadKnowledgeStatus();
    setVaultMessage(
      `已切换到：${payload.vaultDir}。请在 Obsidian 中打开这个文件夹。`,
      "success"
    );
  } catch (error) {
    setVaultMessage(
      error instanceof Error ? error.message : "知识库路径初始化失败。",
      "error"
    );
  } finally {
    initVault.disabled = false;
  }
}

function renderKnowledgeStatus(status) {
  vaultPanel.classList.toggle("hidden", !status.canConfigureVault);
  if (status.canConfigureVault) {
    vaultPath.value = status.vaultDir || "";
  }
  vaultState.textContent = status.ok ? "已初始化" : "异常";
  aiFileCount.textContent = `${status.counts?.aiFiles ?? 0} 个`;
  rawFileCount.textContent = `${status.counts?.rawFiles ?? 0} 个`;
  apiState.textContent = status.hasApiKey ? "已连接" : "未配置";
  kbPath.textContent = [
    `当前项目库：${status.spaceRoot}`,
    `最近更新：${formatLatestUpdate(status.latestUpdate)}`,
  ].join("  ·  ");
}

async function loadKnowledgeStatus() {
  try {
    vaultState.textContent = "检查中";
    apiState.textContent = "检查中";
    const space = getCurrentSpace();
    const response = await fetch(`/api/kb-status?space=${encodeURIComponent(space)}`);
    const status = await response.json();
    if (!response.ok) {
      throw new Error(status.detail || status.error || "状态检查失败");
    }
    renderKnowledgeStatus(status);
  } catch (error) {
    vaultState.textContent = "异常";
    apiState.textContent = "待检查";
    kbPath.textContent =
      error instanceof Error ? error.message : "无法读取知识库状态。";
  }
}

function setUpdateLoading(message) {
  kbStatus.className = "update-status";
  kbStatus.textContent = message;
  kbDryRun.disabled = true;
  kbUpdate.disabled = true;
}

function setUpdateIdle() {
  kbDryRun.disabled = false;
  kbUpdate.disabled = false;
}

async function runKnowledgeUpdate(dryRun) {
  if (!kbFile.files || kbFile.files.length === 0) {
    kbStatus.className = "update-status error";
    kbStatus.textContent = "请先选择要上传的 md、txt、csv、Word、PDF、Excel 或 PPT 文件。";
    return;
  }

  setUpdateLoading(dryRun ? "正在预检查上传资料..." : "正在上传并整理，可能需要几十秒...");

  try {
    const targetSpace = await resolveImportSpace();
    const formData = new FormData();
    formData.append("space", targetSpace);
    formData.append("project", kbProject.value.trim());
    formData.append("mode", kbMode.value);
    formData.append("outputName", kbOutputName.value.trim());
    formData.append("dryRun", String(dryRun));
    for (const file of kbFile.files) {
      formData.append("files", file);
    }

    const response = await fetch("/api/import-kb", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "更新失败");
    }

    kbStatus.className = "update-status success";
    const saved = payload.savedFiles?.length
      ? `\n\n原始资料已保存：\n${payload.savedFiles.join("\n")}`
      : "";
    kbStatus.textContent = `${payload.stdout || "更新完成。"}${saved}`;
    await loadKnowledgeStatus();
  } catch (error) {
    kbStatus.className = "update-status error";
    kbStatus.textContent =
      error instanceof Error ? error.message : "更新失败，请检查资料路径。";
  } finally {
    setUpdateIdle();
  }
}

window.addEventListener("pointermove", updatePointer, { passive: true });
window.addEventListener(
  "resize",
  () => {
    pointer.x = window.innerWidth / 2;
    pointer.y = window.innerHeight * 0.35;
  },
  { passive: true },
);

createResonanceField();
if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  function fallbackFrame() {
    syncPointerTokens();
    requestAnimationFrame(fallbackFrame);
  }
  fallbackFrame();
}

sampleButton.addEventListener("click", () => {
  questionInput.value = "梦星鸣潮每日返图传哪里？";
  questionInput.focus();
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  form.requestSubmit();
});

spaceSelect.addEventListener("change", async () => {
  localStorage.setItem("currentKnowledgeSpace", getCurrentSpace());
  kbTargetSpace.value = getCurrentSpace();
  setSpaceMessage(`已切换到：${getCurrentSpace()}`, "success");
  await loadKnowledgeStatus();
});
kbTargetSpace.addEventListener("change", async () => {
  spaceSelect.value = kbTargetSpace.value;
  localStorage.setItem("currentKnowledgeSpace", kbTargetSpace.value);
  setSpaceMessage(`已切换到：${kbTargetSpace.value}`, "success");
  await loadKnowledgeStatus();
});
kbSpaceAction.addEventListener("change", syncImportMode);
createSpace.addEventListener("click", createKnowledgeSpace);
initVault.addEventListener("click", initializeVaultPath);
refreshStatus.addEventListener("click", loadKnowledgeStatus);
kbDryRun.addEventListener("click", () => runKnowledgeUpdate(true));
kbUpdate.addEventListener("click", () => runKnowledgeUpdate(false));
syncImportMode();
loadSpaces()
  .then(loadKnowledgeStatus)
  .catch((error) => {
    setSpaceMessage(
      error instanceof Error ? error.message : "项目库初始化失败。",
      "error"
    );
  });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) {
    return;
  }

  setLoading();

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, space: getCurrentSpace() }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "请求失败");
    }

    answerBox.className = "answer";
    answerBox.textContent = payload.answer;
    renderSources(payload.citations);
  } catch (error) {
    answerBox.className = "answer error";
    answerBox.textContent =
      error instanceof Error ? error.message : "请求失败，请稍后重试。";
    sourcesBox.className = "sources empty";
    sourcesBox.textContent = "没有可展示的引用。";
  }
});
