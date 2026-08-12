const form = document.querySelector("#auth-form");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const displayName = document.querySelector("#display-name");
const submit = document.querySelector("#auth-submit");
const message = document.querySelector("#auth-message");
const title = document.querySelector("#auth-title");
const description = document.querySelector("#auth-description");
const eyebrow = document.querySelector("#auth-eyebrow");
const authSwitch = document.querySelector("#auth-switch");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const nameField = document.querySelector(".name-field");
const nameLabel = document.querySelector("#name-label");
let setupMode = false;
let authMode = "login";

function setMessage(text, type = "") {
  message.className = type ? `auth-message ${type}` : "auth-message";
  message.textContent = text;
}

function applyMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  loginTab.classList.toggle("active", !registering);
  registerTab.classList.toggle("active", registering);
  loginTab.setAttribute("aria-selected", String(!registering));
  registerTab.setAttribute("aria-selected", String(registering));
  nameField.classList.toggle("hidden", !registering);
  displayName.required = registering;
  password.autocomplete = registering ? "new-password" : "current-password";
  eyebrow.textContent = registering ? "员工注册" : "安全登录";
  title.textContent = registering ? "创建你的账号" : "进入知识平台";
  description.textContent = registering
    ? "注册后由超级管理员分配角色和项目权限。"
    : "使用公司账号登录。";
  submit.textContent = registering ? "注册并进入" : "登录";
  setMessage(registering ? "新账号默认没有项目权限。" : "");
}

async function initialize() {
  const response = await fetch("/api/auth/status");
  const payload = await response.json();
  if (payload.authenticated) {
    window.location.replace("/");
    return;
  }
  setupMode = !payload.initialized;
  if (setupMode) {
    nameField.classList.remove("hidden");
    displayName.required = true;
    password.autocomplete = "new-password";
    eyebrow.textContent = "首次启用";
    title.textContent = "创建超级管理员";
    description.textContent = "此操作只能在部署电脑本机完成，创建后由管理员添加员工账号。";
    submit.textContent = "初始化并进入";
  } else {
    authSwitch.classList.remove("hidden");
    applyMode("login");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  setMessage(setupMode ? "正在创建安全账号..." : authMode === "register" ? "正在注册账号..." : "正在验证身份...");
  try {
    const endpoint = setupMode ? "/api/auth/setup" : authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
        displayName: displayName.value.trim(),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "登录失败");
    }
    window.location.replace("/");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "登录失败", "error");
  } finally {
    submit.disabled = false;
  }
});

loginTab.addEventListener("click", () => applyMode("login"));
registerTab.addEventListener("click", () => applyMode("register"));

initialize().catch(() => setMessage("无法连接知识平台，请确认服务已经启动。", "error"));
