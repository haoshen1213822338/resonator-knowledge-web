const form = document.querySelector("#ask-form");
const questionInput = document.querySelector("#question");
const answerBox = document.querySelector("#answer");
const sourcesBox = document.querySelector("#sources");
const conversationBox = document.querySelector("#conversation");
const chatSessionsBox = document.querySelector("#chat-sessions");
const chatTitle = document.querySelector("#chat-title");
const newChatButton = document.querySelector("#new-chat");
const sampleButton = document.querySelector("#sample-button");
const canvas = document.querySelector("#resonance-canvas");
const kbProject = document.querySelector("#kb-project");
const kbFile = document.querySelector("#kb-file");
const kbMode = document.querySelector("#kb-mode");
const kbOutputName = document.querySelector("#kb-output-name");
const kbDryRun = document.querySelector("#kb-dry-run");
const kbUpdate = document.querySelector("#kb-update");
const kbStatus = document.querySelector("#kb-status");
const kbProgress = document.querySelector("#kb-progress");
const kbProgressLabel = document.querySelector("#kb-progress-label");
const kbProgressPercent = document.querySelector("#kb-progress-percent");
const kbProgressBar = document.querySelector("#kb-progress-bar");
const importJobsBox = document.querySelector("#import-jobs");
const fileFilterType = document.querySelector("#file-filter-type");
const fileSearch = document.querySelector("#file-search");
const refreshFiles = document.querySelector("#refresh-files");
const fileList = document.querySelector("#file-list");
const fileManagerCard = document.querySelector("#file-manager-card");
const toggleFileManager = document.querySelector("#toggle-file-manager");
const fileManagerSummary = document.querySelector("#file-manager-summary");
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
const vectorState = document.querySelector("#vector-state");
const vectorDetail = document.querySelector("#vector-detail");
const rebuildVectorIndexButton = document.querySelector("#rebuild-vector-index");
const kbPath = document.querySelector("#kb-path");
const refreshStatus = document.querySelector("#refresh-status");
const importPanel = document.querySelector("#import-panel");
const managePanel = document.querySelector("#manage-panel");
const toggleImportPanel = document.querySelector("#toggle-import-panel");
const toggleManagePanel = document.querySelector("#toggle-manage-panel");
const currentUserName = document.querySelector("#current-user-name");
const currentUserRole = document.querySelector("#current-user-role");
const logoutButton = document.querySelector("#logout-button");
const adminLink = document.querySelector("#admin-link");
const accessCard = document.querySelector("#access-card");
const userForm = document.querySelector("#user-form");
const userId = document.querySelector("#user-id");
const userUsername = document.querySelector("#user-username");
const userDisplayName = document.querySelector("#user-display-name");
const userRole = document.querySelector("#user-role");
const userDisabled = document.querySelector("#user-disabled");
const userSpaceOptions = document.querySelector("#user-space-options");
const userList = document.querySelector("#user-list");
const userMessage = document.querySelector("#user-message");
const resetUserFormButton = document.querySelector("#reset-user-form");
const auditCard = document.querySelector("#audit-card");
const auditList = document.querySelector("#audit-list");
const refreshAudit = document.querySelector("#refresh-audit");

const root = document.documentElement;
let currentSessionId = localStorage.getItem("currentChatSessionId") || "";
let currentMessages = [];
const activeImportPolls = new Map();
let managedFileCount = 0;
let currentUser = null;
let availableSpaces = [];
const pointer = {
  x: window.innerWidth / 2,
  y: window.innerHeight * 0.35,
};
const smoothPointer = { ...pointer };

function setLoading() {
  renderConversation([
    ...currentMessages,
    {
      role: "assistant",
      content: "正在搜索本地知识库，并交给 AI 总结...",
      pending: true,
    },
  ]);
  if (sourcesBox) {
    sourcesBox.className = "sources empty";
    sourcesBox.textContent = "正在查找引用来源。";
  }
}

function renderConversation(messages = currentMessages) {
  if (!conversationBox) {
    return;
  }
  if (!messages.length) {
    conversationBox.className = "conversation empty";
    conversationBox.textContent = "等待你的问题。";
    return;
  }

  conversationBox.className = "conversation";
  conversationBox.innerHTML = messages
    .map((message) => {
      const roleLabel = message.role === "user" ? "你" : "Agent";
      const pendingClass = message.pending ? " pending" : "";
      const content = message.role === "assistant"
        ? renderAssistantContent(message.content)
        : escapeHtml(message.content);
      return `
        <div class="chat-message ${message.role}${pendingClass}">
          <div class="message-role">${roleLabel}</div>
          <div class="message-content">${content}</div>
        </div>
      `;
    })
    .join("");
  conversationBox.scrollTop = conversationBox.scrollHeight;
}

function renderAssistantContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h3>${formatInlineMarkdown(heading[1])}</h3>`);
      continue;
    }

    const labelHeading = line.match(/^(结论|依据|推断|建议|建议下一步|待确认|参考)[:：]\s*(.*)$/);
    if (labelHeading) {
      closeList();
      html.push(
        `<h3>${escapeHtml(labelHeading[1])}</h3>${labelHeading[2] ? `<p>${formatInlineMarkdown(labelHeading[2])}</p>` : ""}`
      );
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+[.、]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${formatInlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function formatInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderChatSessions(sessions = []) {
  if (!chatSessionsBox) {
    return;
  }
  if (!sessions.length) {
    chatSessionsBox.className = "chat-sessions empty";
    chatSessionsBox.textContent = "暂无历史对话。";
    return;
  }

  chatSessionsBox.className = "chat-sessions";
  chatSessionsBox.innerHTML = sessions
    .map((session) => {
      const active = session.id === currentSessionId ? " active" : "";
      const updatedAt = session.updatedAt
        ? new Date(session.updatedAt).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      return `
        <button type="button" class="chat-session${active}" data-session-id="${escapeHtml(session.id)}">
          <span>${escapeHtml(session.title || "未命名对话")}</span>
          <small>${updatedAt} · ${session.messageCount || 0} 条</small>
        </button>
      `;
    })
    .join("");
}

function renderSources(citations) {
  if (!sourcesBox) {
    return;
  }
  if (!citations || citations.length === 0) {
    sourcesBox.className = "sources empty";
    sourcesBox.textContent = "没有找到相关知识文件。";
    return;
  }

  sourcesBox.className = "sources";
  sourcesBox.innerHTML = citations
    .slice(0, 5)
    .map(
      (item, index) => `
        <div class="source-item source-compact">
          <div class="source-heading">
            <span class="source-index">${index + 1}</span>
            <p class="source-title">${escapeHtml(item.file)}</p>
          </div>
          <div class="source-meta">${escapeHtml(item.retrieval || "关键词")}命中 · 综合相关度：${item.score}</div>
          <details class="source-details">
            <summary>查看引用片段</summary>
            <div class="source-snippet">${escapeHtml(item.snippet)}</div>
          </details>
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

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("请先登录");
  }
  return response;
}

async function loadCurrentUser() {
  const response = await fetch("/api/auth/status");
  const payload = await response.json();
  if (!payload.authenticated) {
    window.location.replace("/login");
    throw new Error("请先登录");
  }
  currentUser = payload.user;
  if (currentUserName) {
    currentUserName.textContent = currentUser.displayName || currentUser.username;
  }
  if (currentUserRole) {
    currentUserRole.textContent = currentUser.roleLabel;
  }
  const canManage = ["admin", "manager"].includes(currentUser.role);
  adminLink?.classList.toggle("hidden", !canManage);
  document.body.dataset.role = currentUser.role;
  return currentUser;
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  localStorage.removeItem("currentChatSessionId");
  window.location.replace("/login");
}

function setUserMessage(message, type = "") {
  if (!userMessage) {
    return;
  }
  userMessage.className = type ? `space-message ${type}` : "space-message";
  userMessage.textContent = message;
}

function renderUserSpaceOptions(selected = []) {
  if (!userSpaceOptions) {
    return;
  }
  const selectedSet = new Set(selected);
  userSpaceOptions.innerHTML = availableSpaces.map((space) => `
    <label class="permission-option">
      <input type="checkbox" value="${escapeHtml(space.id)}" ${selectedSet.has(space.id) ? "checked" : ""} />
      <span>${escapeHtml(space.name)}</span>
    </label>
  `).join("");
}

function resetUserForm() {
  if (!userForm) {
    return;
  }
  userForm.reset();
  userId.value = "";
  userUsername.value = "";
  userDisplayName.value = "";
  userRole.value = "member";
  renderUserSpaceOptions([]);
  setUserMessage("员工可自行注册；这里用于分配角色和项目权限。");
}

function renderUsers(users = []) {
  if (!userList) {
    return;
  }
  userList.className = "user-list";
  userList.innerHTML = users.map((user) => `
    <button type="button" class="user-row${user.role === "admin" ? " admin-account" : ""}" ${user.role === "admin" ? "disabled" : `data-user-id="${escapeHtml(user.id)}" data-user="${encodeURIComponent(JSON.stringify(user))}"`}>
      <span class="user-avatar">${escapeHtml((user.displayName || user.username).slice(0, 1).toUpperCase())}</span>
      <span class="user-row-copy">
        <strong>${escapeHtml(user.displayName || user.username)}</strong>
        <small>${escapeHtml(user.username)} · ${escapeHtml(user.roleLabel)}${user.disabled ? " · 已停用" : ""}</small>
        <em>${user.role === "admin" ? "唯一超级管理员 · 全部项目" : user.spaces.length ? `${user.spaces.length} 个项目` : "等待分配项目"}</em>
      </span>
    </button>
  `).join("");
}

async function loadUsers() {
  if (!accessCard || currentUser?.role !== "admin") {
    return;
  }
  accessCard.classList.remove("hidden");
  const response = await apiFetch("/api/users");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "账号读取失败");
  }
  renderUsers(payload.users || []);
  renderUserSpaceOptions([]);
}

async function saveUser(event) {
  event.preventDefault();
  if (!userId.value) {
    setUserMessage("请先从右侧选择一个已注册账号。", "error");
    return;
  }
  const spaces = Array.from(userSpaceOptions.querySelectorAll("input:checked")).map((input) => input.value);
  const response = await apiFetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: userId.value,
      role: userRole.value,
      spaces,
      disabled: userDisabled.checked,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    setUserMessage(payload.error || "账号保存失败", "error");
    return;
  }
  renderUsers(payload.users || []);
  resetUserForm();
  setUserMessage("账号和项目权限已保存。", "success");
  await loadAuditLogs();
}

function editUser(button) {
  const user = JSON.parse(decodeURIComponent(button.dataset.user));
  userId.value = user.id;
  userUsername.value = user.username;
  userDisplayName.value = user.displayName;
  userRole.value = user.role;
  userDisabled.checked = user.disabled;
  renderUserSpaceOptions(user.spaces || []);
  setUserMessage(`正在编辑：${user.displayName || user.username}`);
  userUsername.focus();
}

function getAuditActionLabel(action) {
  return {
    "auth.setup": "初始化管理员",
    "auth.login": "登录",
    "auth.login.failed": "登录失败",
    "auth.register": "员工注册",
    "auth.logout": "退出",
    ask: "知识问答",
    import: "资料入库",
    "space.create": "新建项目库",
    "file.delete": "删除资料",
    "user.create": "创建账号",
    "user.update": "修改账号",
  }[action] || action;
}

async function loadAuditLogs() {
  if (!auditCard || !["admin", "manager"].includes(currentUser?.role)) {
    return;
  }
  auditCard.classList.remove("hidden");
  const response = await apiFetch("/api/audit-logs?limit=100");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "日志读取失败");
  }
  const logs = payload.logs || [];
  auditList.className = logs.length ? "audit-list" : "audit-list empty";
  auditList.innerHTML = logs.length ? logs.map((item) => `
    <div class="audit-row">
      <span>${escapeHtml(getAuditActionLabel(item.action))}</span>
      <strong>${escapeHtml(item.username || "未登录用户")}</strong>
      <small>${escapeHtml(item.space || item.target || "全局")} · ${new Date(item.createdAt).toLocaleString("zh-CN")}</small>
    </div>
  `).join("") : "暂无操作日志。";
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
    gradient.addColorStop(0, `rgba(86, 126, 112, ${alpha * 0.36})`);
    gradient.addColorStop(0.32, `rgba(104, 230, 186, ${alpha * 0.78})`);
    gradient.addColorStop(0.5, `rgba(236, 248, 241, ${alpha + 0.08})`);
    gradient.addColorStop(0.68, `rgba(104, 230, 186, ${alpha * 0.5})`);
    gradient.addColorStop(1, `rgba(86, 126, 112, ${alpha * 0.34})`);

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
    ctx.shadowColor = "rgba(104, 230, 186, 0.22)";
    ctx.shadowBlur = 28 + layer * 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawEnergyCore(time) {
    const x = width * 0.5 + (smoothPointer.x - width * 0.5) * 0.045;
    const y = Math.min(height * 0.24, 190) + (smoothPointer.y - height * 0.35) * 0.025;
    const pulse = 1 + Math.sin(time * 2.4) * 0.08;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, 150 * pulse);
    glow.addColorStop(0, "rgba(236, 248, 241, 0.26)");
    glow.addColorStop(0.32, "rgba(104, 230, 186, 0.18)");
    glow.addColorStop(1, "rgba(5, 8, 7, 0)");
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
          ? "rgba(104, 230, 186, 0.3)"
          : "rgba(220, 234, 226, 0.2)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 44 + ring * 11, 44 + ring * 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = "rgba(236, 248, 241, 0.86)";
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

      ctx.fillStyle = `rgba(220, 234, 226, ${twinkle})`;
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
    base.addColorStop(0, "rgba(5, 8, 7, 0.72)");
    base.addColorStop(0.5, "rgba(9, 18, 15, 0.42)");
    base.addColorStop(1, "rgba(3, 5, 4, 0.84)");
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

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function getCurrentSpace() {
  return spaceSelect?.value || localStorage.getItem("currentKnowledgeSpace") || "";
}

function setSpaceMessage(message, type = "") {
  if (!spaceMessage) {
    return;
  }
  spaceMessage.className = type ? `space-message ${type}` : "space-message";
  spaceMessage.textContent = message;
}

function setVaultMessage(message, type = "") {
  if (!vaultMessage) {
    return;
  }
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
  if (spaceSelect) {
    spaceSelect.innerHTML = options;
  }
  if (kbTargetSpace) {
    kbTargetSpace.innerHTML = options;
  }
}

async function loadSpaces(preferredSpace = localStorage.getItem("currentKnowledgeSpace")) {
  const response = await apiFetch("/api/spaces");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "项目库列表读取失败");
  }

  const spaces = payload.spaces || [];
  availableSpaces = spaces;
  if (!spaces.length) {
    renderSpaces([], "");
    setSpaceMessage("当前账号还没有被分配项目库，请联系管理员。", "error");
    return false;
  }
  const selected = spaces.some((space) => space.id === preferredSpace)
    ? preferredSpace
    : payload.defaultSpace || spaces[0]?.id || "";
  renderSpaces(spaces, selected);
  if (selected) {
    if (spaceSelect) {
      spaceSelect.value = selected;
    }
    if (kbTargetSpace) {
      kbTargetSpace.value = selected;
    }
    localStorage.setItem("currentKnowledgeSpace", selected);
  }
  return true;
}

function showPendingAuthorization() {
  if (spaceSelect) {
    spaceSelect.disabled = true;
    spaceSelect.innerHTML = '<option value="">等待管理员授权</option>';
  }
  if (chatTitle) {
    chatTitle.textContent = "账号等待授权";
  }
  if (conversationBox) {
    conversationBox.className = "conversation empty pending-access";
    conversationBox.innerHTML = [
      "<strong>账号已经注册成功</strong>",
      "<span>超级管理员分配项目库后，你就可以开始查询公司知识。</span>",
    ].join("");
  }
  if (questionInput) {
    questionInput.disabled = true;
    questionInput.placeholder = "等待管理员分配项目权限";
  }
  form?.querySelector('button[type="submit"]')?.setAttribute("disabled", "");
  newChatButton?.setAttribute("disabled", "");
  if (sourcesBox) {
    sourcesBox.className = "sources empty";
    sourcesBox.textContent = "授权后会显示可引用的项目资料。";
  }
}

async function initializeApp() {
  await loadCurrentUser();
  const hasSpaces = await loadSpaces();
  if (!hasSpaces) {
    showPendingAuthorization();
    if (currentUser?.role === "admin") {
      await loadUsers();
      await loadAuditLogs();
    }
    return;
  }
  await loadKnowledgeStatus();
  await loadImportJobs();
  await loadManagedFiles();
  await loadUsers();
  await loadAuditLogs();
  if (chatSessionsBox) {
    await initializeChatHistory();
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
    const response = await apiFetch("/api/spaces", {
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
  const response = await apiFetch("/api/spaces", {
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
  if (!kbSpaceAction || !kbExistingSpaceLabel || !kbNewSpaceLabel) {
    return;
  }
  const isCreate = kbSpaceAction.value === "create";
  kbExistingSpaceLabel.classList.toggle("hidden", isCreate);
  kbNewSpaceLabel.classList.toggle("hidden", !isCreate);
}

function openUtilityPanel(panel) {
  if (!panel) {
    return;
  }
  panel.open = true;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetCurrentChat() {
  currentSessionId = "";
  currentMessages = [];
  localStorage.removeItem("currentChatSessionId");
  if (chatTitle) {
    chatTitle.textContent = "新对话";
  }
  renderConversation();
  renderSources([]);
}

async function loadChatSessions() {
  const response = await apiFetch(`/api/chat-sessions?space=${encodeURIComponent(getCurrentSpace())}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "历史对话读取失败");
  }
  renderChatSessions(payload.sessions || []);
  return payload.sessions || [];
}

async function loadChatSession(sessionId) {
  if (!sessionId) {
    resetCurrentChat();
    return;
  }
  const response = await apiFetch(
    `/api/chat-session?space=${encodeURIComponent(getCurrentSpace())}&session=${encodeURIComponent(sessionId)}`
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "历史对话读取失败");
  }

  currentSessionId = payload.session.id;
  currentMessages = payload.session.messages || [];
  localStorage.setItem("currentChatSessionId", currentSessionId);
  chatTitle.textContent = payload.session.title || "历史对话";
  renderConversation();
  const lastAssistant = [...currentMessages].reverse().find((message) => message.role === "assistant");
  renderSources(lastAssistant?.citations || []);
  await loadChatSessions();
}

async function initializeChatHistory() {
  try {
    const sessions = await loadChatSessions();
    const remembered = sessions.find((session) => session.id === currentSessionId);
    if (remembered) {
      await loadChatSession(remembered.id);
      return;
    }
    resetCurrentChat();
    renderChatSessions(sessions);
  } catch (error) {
    chatSessionsBox.className = "chat-sessions empty error";
    chatSessionsBox.textContent =
      error instanceof Error ? error.message : "历史对话读取失败。";
  }
}

async function resolveImportSpace() {
  if (kbSpaceAction.value === "existing") {
    const selectedSpace = kbTargetSpace?.value || getCurrentSpace();
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
  if (kbTargetSpace) {
    kbTargetSpace.value = createdSpace;
  }
  if (spaceSelect) {
    spaceSelect.value = createdSpace;
  }
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
    const response = await apiFetch("/api/vault-config", {
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
  vaultPanel?.classList.toggle("hidden", !status.canConfigureVault);
  if (status.canConfigureVault && vaultPath) {
    vaultPath.value = status.vaultDir || "";
  }
  if (vaultState) {
    vaultState.textContent = status.ok ? "已初始化" : "异常";
  }
  if (aiFileCount) {
    aiFileCount.textContent = `${status.counts?.aiFiles ?? 0} 个`;
  }
  if (rawFileCount) {
    rawFileCount.textContent = `${status.counts?.rawFiles ?? 0} 个`;
  }
  if (apiState) {
    apiState.textContent = status.hasApiKey ? "已连接" : "未配置";
  }
  if (vectorState) {
    vectorState.textContent = status.vectorEnabled
      ? status.vectorIndex?.ready ? "已建立" : "待建立"
      : "未启用";
  }
  if (vectorDetail) {
    vectorDetail.textContent = status.vectorIndex?.ready
      ? `${status.vectorIndex.files} 个文件 · ${status.vectorIndex.chunks} 个语义片段`
      : `本地模型：${status.vectorModel || "未配置"}`;
  }
  if (kbPath) {
    kbPath.textContent = [
      `当前项目库：${status.spaceRoot}`,
      `最近更新：${formatLatestUpdate(status.latestUpdate)}`,
    ].join("  ·  ");
  }
}

async function rebuildVectorIndex() {
  if (!rebuildVectorIndexButton) {
    return;
  }
  rebuildVectorIndexButton.disabled = true;
  rebuildVectorIndexButton.textContent = "正在更新...";
  if (vectorDetail) {
    vectorDetail.textContent = "首次建立会下载本地模型，可能需要几分钟。";
  }
  try {
    const response = await apiFetch("/api/vector-index/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space: getCurrentSpace() }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "语义索引更新失败");
    }
    await loadKnowledgeStatus();
  } catch (error) {
    if (vectorDetail) {
      vectorDetail.textContent = error instanceof Error ? error.message : "语义索引更新失败";
    }
  } finally {
    rebuildVectorIndexButton.disabled = false;
    rebuildVectorIndexButton.textContent = "更新语义索引";
  }
}

async function loadKnowledgeStatus() {
  try {
    if (vaultState) {
      vaultState.textContent = "检查中";
    }
    if (apiState) {
      apiState.textContent = "检查中";
    }
    const space = getCurrentSpace();
    const response = await apiFetch(`/api/kb-status?space=${encodeURIComponent(space)}`);
    const status = await response.json();
    if (!response.ok) {
      throw new Error(status.detail || status.error || "状态检查失败");
    }
    renderKnowledgeStatus(status);
  } catch (error) {
    if (vaultState) {
      vaultState.textContent = "异常";
    }
    if (apiState) {
      apiState.textContent = "待检查";
    }
    if (kbPath) {
      kbPath.textContent =
        error instanceof Error ? error.message : "无法读取知识库状态。";
    }
  }
}

function getJobStatusText(status) {
  const labels = {
    queued: "等待中",
    running: "处理中",
    completed: "已完成",
    failed: "失败",
  };
  return labels[status] || status || "未知";
}

function renderImportJobs(jobs = []) {
  if (!importJobsBox) {
    return;
  }
  if (!jobs.length) {
    importJobsBox.className = "import-jobs empty";
    importJobsBox.textContent = "还没有入库任务。";
    return;
  }

  importJobsBox.className = "import-jobs";
  importJobsBox.innerHTML = jobs
    .map((job) => {
      const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
      const statusClass = `job-status ${escapeHtml(job.status || "unknown")}`;
      const fileCount = job.savedFiles?.length || 0;
      const currentFile = job.currentFile
        ? `<span>当前：${escapeHtml(job.currentFile)}</span>`
        : "";
      const detail = job.error || job.stdout || job.uploadDir || "";
      return `
        <article class="import-job" data-job-id="${escapeHtml(job.id)}">
          <div class="import-job-main">
            <div>
              <strong>${escapeHtml(job.project || "未命名项目")}</strong>
              <span>${escapeHtml(job.phase || getJobStatusText(job.status))}</span>
            </div>
            <span class="${statusClass}">${escapeHtml(getJobStatusText(job.status))}</span>
          </div>
          <div class="import-job-meta">
            <span>${escapeHtml(formatLatestUpdate(job.createdAt))}</span>
            <span>${fileCount} 个文件</span>
            ${currentFile}
            <span>${progress}%</span>
          </div>
          <div class="import-job-track">
            <div style="width: ${progress}%"></div>
          </div>
          ${detail ? `<p>${escapeHtml(detail).slice(0, 240)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

function clearImportPolls() {
  for (const timerId of activeImportPolls.values()) {
    window.clearTimeout(timerId);
  }
  activeImportPolls.clear();
}

async function loadImportJobs() {
  if (!importJobsBox) {
    return [];
  }
  const response = await apiFetch(
    `/api/import-jobs?space=${encodeURIComponent(getCurrentSpace())}&limit=20`
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "入库任务历史读取失败");
  }
  renderImportJobs(payload.jobs || []);
  for (const job of payload.jobs || []) {
    if (job.status === "queued" || job.status === "running") {
      pollImportJob(job.id);
    }
  }
  return payload.jobs || [];
}

function renderManagedFiles(files = []) {
  if (!fileList) {
    return;
  }
  managedFileCount = files.length;
  updateFileManagerSummary();
  if (!files.length) {
    fileList.className = "file-list empty";
    fileList.textContent = "没有找到符合条件的资料。";
    return;
  }

  fileList.className = "file-list";
  fileList.innerHTML = files
    .map((file) => {
      const deleteButton = file.canDelete
        ? `<button type="button" class="text-danger" data-file-delete="${escapeHtml(file.relativePath)}">删除</button>`
        : `<span class="file-action-disabled">受保护</span>`;
      return `
        <article class="file-row">
          <div class="file-row-main">
            <div>
              <strong>${escapeHtml(file.name)}</strong>
              <span>${escapeHtml(file.relativePath)}</span>
            </div>
            <span class="file-type">${escapeHtml(file.typeLabel || file.type)}</span>
          </div>
          <div class="file-row-meta">
            <span>${escapeHtml(file.extension || "")}</span>
            <span>${escapeHtml(formatFileSize(file.size))}</span>
            <span>${escapeHtml(formatLatestUpdate(file.modifiedAt))}</span>
          </div>
          <div class="file-row-actions">
            <button type="button" data-file-copy="${escapeHtml(file.absolutePath)}">复制路径</button>
            ${deleteButton}
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadManagedFiles() {
  if (!fileList) {
    return [];
  }
  fileList.className = "file-list empty";
  fileList.textContent = "正在读取资料列表。";
  const type = fileFilterType?.value || "all";
  const query = fileSearch?.value?.trim() || "";
  const response = await apiFetch(
    `/api/files?space=${encodeURIComponent(getCurrentSpace())}&type=${encodeURIComponent(type)}&q=${encodeURIComponent(query)}`
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "资料列表读取失败");
  }
  renderManagedFiles(payload.files || []);
  return payload.files || [];
}

function isFileManagerCollapsed() {
  return localStorage.getItem("fileManagerCollapsed") === "true";
}

function updateFileManagerSummary() {
  if (!fileManagerSummary) {
    return;
  }
  const typeLabel = fileFilterType?.selectedOptions?.[0]?.textContent || "当前筛选";
  const query = fileSearch?.value?.trim();
  fileManagerSummary.textContent = query
    ? `${typeLabel} · 搜索“${query}” · ${managedFileCount} 个结果`
    : `${typeLabel} · ${managedFileCount} 个文件`;
}

function applyFileManagerCollapsed(collapsed) {
  if (!fileManagerCard || !toggleFileManager) {
    return;
  }
  fileManagerCard.classList.toggle("is-collapsed", collapsed);
  toggleFileManager.textContent = collapsed ? "展开列表" : "收起列表";
  toggleFileManager.setAttribute("aria-expanded", String(!collapsed));
  localStorage.setItem("fileManagerCollapsed", String(collapsed));
  updateFileManagerSummary();
}

async function deleteManagedFile(relativePath) {
  const confirmed = window.confirm(`确定删除这个资料文件吗？\n\n${relativePath}`);
  if (!confirmed) {
    return;
  }

  const response = await apiFetch("/api/files", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      space: getCurrentSpace(),
      relativePath,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "删除失败");
  }
  await loadManagedFiles();
  await loadKnowledgeStatus();
}

async function pollImportJob(jobId) {
  if (!jobId || activeImportPolls.has(jobId)) {
    return;
  }

  const poll = async () => {
    try {
      const response = await apiFetch(
        `/api/import-jobs/${encodeURIComponent(jobId)}?space=${encodeURIComponent(getCurrentSpace())}`
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || "任务状态读取失败");
      }

      const job = payload.job;
      setUploadProgress(
        job.progress || 0,
        job.currentFile
          ? `${job.phase || getJobStatusText(job.status)} · ${job.currentFile}`
          : job.phase || getJobStatusText(job.status)
      );
      if (job.status === "completed") {
        kbStatus.className = "update-status success";
        kbStatus.textContent = job.stdout || "入库任务已完成。";
        activeImportPolls.delete(jobId);
        await loadKnowledgeStatus();
        await loadImportJobs();
        return;
      }
      if (job.status === "failed") {
        kbStatus.className = "update-status error";
        kbStatus.textContent = job.error || "入库任务失败。";
        activeImportPolls.delete(jobId);
        await loadImportJobs();
        return;
      }
      activeImportPolls.set(jobId, window.setTimeout(poll, 2500));
    } catch (error) {
      activeImportPolls.delete(jobId);
      kbStatus.className = "update-status error";
      kbStatus.textContent =
        error instanceof Error ? error.message : "任务状态读取失败。";
    }
  };

  activeImportPolls.set(jobId, window.setTimeout(poll, 900));
}

function setUpdateLoading(message) {
  if (!kbStatus || !kbDryRun || !kbUpdate) {
    return;
  }
  kbStatus.className = "update-status";
  kbStatus.textContent = message;
  kbDryRun.disabled = true;
  kbUpdate.disabled = true;
}

function setUploadProgress(percent, label) {
  if (!kbProgress || !kbProgressBar || !kbProgressPercent || !kbProgressLabel) {
    return;
  }
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  kbProgress.classList.remove("hidden");
  kbProgressBar.style.width = `${safePercent}%`;
  kbProgressPercent.textContent = `${safePercent}%`;
  kbProgressLabel.textContent = label;
}

function resetUploadProgress() {
  if (!kbProgress || !kbProgressBar) {
    return;
  }
  kbProgress.classList.add("hidden");
  kbProgressBar.style.width = "0%";
}

function sendImportRequest(formData, { dryRun, hasVideo }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/import-kb");
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const uploadPercent = (event.loaded / event.total) * 100;
      if (dryRun) {
        setUploadProgress(uploadPercent, "正在检查文件信息");
      } else {
        setUploadProgress(Math.min(55, uploadPercent * 0.55), "正在上传原始文件");
      }
    };
    request.upload.onload = () => {
      if (dryRun) {
        setUploadProgress(90, "正在生成预检查结果");
      } else {
        setUploadProgress(hasVideo ? 68 : 72, hasVideo ? "正在解析视频内容" : "正在解析文件内容");
      }
    };
    request.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText || "{}");
      } catch {
        reject(new Error("后端返回了无法读取的结果。"));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.detail || payload.error || "更新失败"));
        return;
      }
      if (payload.jobId && !dryRun) {
        setUploadProgress(payload.job?.progress || 60, "后台任务已提交");
      } else {
        setUploadProgress(100, dryRun ? "预检查完成" : "已写入知识库");
      }
      resolve(payload);
    };
    request.onerror = () => reject(new Error("网络连接中断，上传没有完成。"));
    request.onabort = () => reject(new Error("上传已取消。"));
    request.send(formData);
  });
}

async function sendPrecheckRequest({ targetSpace, project, mode, files }) {
  setUploadProgress(35, "正在检查文件信息");
  const response = await apiFetch("/api/import-precheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      space: targetSpace,
      project,
      mode,
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "预检查失败");
  }
  setUploadProgress(100, "预检查完成");
  return payload;
}

function setUpdateIdle() {
  if (kbDryRun) {
    kbDryRun.disabled = false;
  }
  if (kbUpdate) {
    kbUpdate.disabled = false;
  }
}

async function runKnowledgeUpdate(dryRun) {
  if (!kbFile.files || kbFile.files.length === 0) {
    kbStatus.className = "update-status error";
    kbStatus.textContent = "请先选择要上传的文档、图片、表格、演示文稿或视频文件。";
    return;
  }

  const selectedFiles = Array.from(kbFile.files || []);
  const hasVideo = selectedFiles.some((file) =>
    /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(file.name)
  );
  setUpdateLoading(
    dryRun
      ? "正在预检查文件类型和保存路径..."
      : hasVideo
        ? "文件已开始上传。视频入库需要抽音频、转文字和关键帧识别，1GB 以上可能需要数分钟到十几分钟..."
        : "正在上传并整理，可能需要几十秒..."
  );
  setUploadProgress(2, dryRun ? "准备预检查" : "准备上传");

  try {
    const targetSpace = await resolveImportSpace();
    if (dryRun) {
      const payload = await sendPrecheckRequest({
        targetSpace,
        project: kbProject.value.trim(),
        mode: kbMode.value,
        files: selectedFiles,
      });
      kbStatus.className = "update-status success";
      kbStatus.textContent = payload.stdout || "预检查完成。";
      await loadKnowledgeStatus();
      return;
    }

    const formData = new FormData();
    formData.append("space", targetSpace);
    formData.append("project", kbProject.value.trim());
    formData.append("mode", kbMode.value);
    formData.append("outputName", kbOutputName.value.trim());
    formData.append("dryRun", String(dryRun));
    for (const file of kbFile.files) {
      formData.append("files", file);
    }

    const payload = await sendImportRequest(formData, { dryRun, hasVideo });

    kbStatus.className = "update-status success";
    const saved = payload.savedFiles?.length
      ? `\n\n原始资料已保存：\n${payload.savedFiles.join("\n")}`
      : "";
    kbStatus.textContent = `${payload.stdout || "更新完成。"}${saved}`;
    if (payload.jobId) {
      await loadImportJobs();
      await pollImportJob(payload.jobId);
    }
    await loadKnowledgeStatus();
  } catch (error) {
    kbStatus.className = "update-status error";
    kbStatus.textContent =
      error instanceof Error ? error.message : "更新失败，请检查资料路径。";
    setUploadProgress(100, "处理失败");
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

sampleButton?.addEventListener("click", () => {
  questionInput.value = "梦星鸣潮每日返图传哪里？";
  questionInput.focus();
});

questionInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  form?.requestSubmit();
});

spaceSelect?.addEventListener("change", async () => {
  clearImportPolls();
  localStorage.setItem("currentKnowledgeSpace", getCurrentSpace());
  if (kbTargetSpace) {
    kbTargetSpace.value = getCurrentSpace();
  }
  setSpaceMessage(`已切换到：${getCurrentSpace()}`, "success");
  await loadKnowledgeStatus();
  await loadImportJobs();
  await loadManagedFiles();
  resetCurrentChat();
  if (chatSessionsBox) {
    await initializeChatHistory();
  }
});
kbTargetSpace?.addEventListener("change", async () => {
  clearImportPolls();
  if (spaceSelect) {
    spaceSelect.value = kbTargetSpace.value;
  }
  localStorage.setItem("currentKnowledgeSpace", kbTargetSpace.value);
  setSpaceMessage(`已切换到：${kbTargetSpace.value}`, "success");
  await loadKnowledgeStatus();
  await loadImportJobs();
  await loadManagedFiles();
  resetCurrentChat();
  if (chatSessionsBox) {
    await initializeChatHistory();
  }
});
kbSpaceAction?.addEventListener("change", syncImportMode);
createSpace?.addEventListener("click", createKnowledgeSpace);
logoutButton?.addEventListener("click", logout);
userForm?.addEventListener("submit", saveUser);
resetUserFormButton?.addEventListener("click", resetUserForm);
userList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-user-id]");
  if (button) {
    editUser(button);
  }
});
refreshAudit?.addEventListener("click", loadAuditLogs);
initVault?.addEventListener("click", initializeVaultPath);
refreshStatus?.addEventListener("click", async () => {
  await loadKnowledgeStatus();
  await loadImportJobs();
  await loadManagedFiles();
});
rebuildVectorIndexButton?.addEventListener("click", rebuildVectorIndex);
refreshFiles?.addEventListener("click", loadManagedFiles);
toggleFileManager?.addEventListener("click", () => {
  applyFileManagerCollapsed(!isFileManagerCollapsed());
});
fileFilterType?.addEventListener("change", loadManagedFiles);
fileSearch?.addEventListener("input", () => {
  window.clearTimeout(fileSearch._timer);
  fileSearch._timer = window.setTimeout(loadManagedFiles, 280);
});
fileList?.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-file-copy]");
  if (copyButton) {
    await navigator.clipboard.writeText(copyButton.dataset.fileCopy || "");
    copyButton.textContent = "已复制";
    window.setTimeout(() => {
      copyButton.textContent = "复制路径";
    }, 1200);
    return;
  }

  const deleteButton = event.target.closest("[data-file-delete]");
  if (deleteButton) {
    try {
      await deleteManagedFile(deleteButton.dataset.fileDelete);
    } catch (error) {
      fileList.className = "file-list empty error";
      fileList.textContent = error instanceof Error ? error.message : "删除失败。";
    }
  }
});
toggleImportPanel?.addEventListener("click", () => openUtilityPanel(importPanel));
toggleManagePanel?.addEventListener("click", () => openUtilityPanel(managePanel));
newChatButton?.addEventListener("click", resetCurrentChat);
chatSessionsBox?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-session-id]");
  if (!button) {
    return;
  }
  try {
    await loadChatSession(button.dataset.sessionId);
  } catch (error) {
    chatSessionsBox.className = "chat-sessions empty error";
    chatSessionsBox.textContent =
      error instanceof Error ? error.message : "历史对话读取失败。";
  }
});
kbDryRun?.addEventListener("click", () => runKnowledgeUpdate(true));
kbUpdate?.addEventListener("click", () => runKnowledgeUpdate(false));
syncImportMode();
applyFileManagerCollapsed(isFileManagerCollapsed());
initializeApp().catch((error) => {
    setSpaceMessage(
      error instanceof Error ? error.message : "项目库初始化失败。",
      "error"
    );
  });

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) {
    return;
  }

  currentMessages = [
    ...currentMessages,
    {
      role: "user",
      content: question,
      createdAt: new Date().toISOString(),
    },
  ];
  setLoading();
  questionInput.value = "";

  try {
    const response = await apiFetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        space: getCurrentSpace(),
        sessionId: currentSessionId,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "请求失败");
    }

    currentSessionId = payload.session?.id || currentSessionId;
    if (currentSessionId) {
      localStorage.setItem("currentChatSessionId", currentSessionId);
    }
    currentMessages = payload.session?.messages || [
      ...currentMessages,
      {
        role: "assistant",
        content: payload.answer,
        citations: payload.citations,
        createdAt: new Date().toISOString(),
      },
    ];
    chatTitle.textContent = payload.session?.title || chatTitle.textContent || "当前对话";
    renderConversation();
    renderSources(payload.citations);
    await loadChatSessions();
  } catch (error) {
    currentMessages = [
      ...currentMessages,
      {
        role: "assistant",
        content: error instanceof Error ? error.message : "请求失败，请稍后重试。",
        pending: false,
      },
    ];
    renderConversation();
    if (sourcesBox) {
      sourcesBox.className = "sources empty";
      sourcesBox.textContent = "没有可展示的引用。";
    }
  }
});
