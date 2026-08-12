const form = document.querySelector("#auth-form");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const displayName = document.querySelector("#display-name");
const submit = document.querySelector("#auth-submit");
const message = document.querySelector("#auth-message");
const title = document.querySelector("#auth-title");
const description = document.querySelector("#auth-description");
const eyebrow = document.querySelector("#auth-eyebrow");
let setupMode = false;

function setMessage(text, type = "") {
  message.className = type ? `auth-message ${type}` : "auth-message";
  message.textContent = text;
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
    document.querySelectorAll(".setup-only").forEach((element) => element.classList.remove("hidden"));
    displayName.required = true;
    password.autocomplete = "new-password";
    eyebrow.textContent = "首次启用";
    title.textContent = "创建超级管理员";
    description.textContent = "此操作只能在部署电脑本机完成，创建后由管理员添加员工账号。";
    submit.textContent = "初始化并进入";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  setMessage(setupMode ? "正在创建安全账号..." : "正在验证身份...");
  try {
    const response = await fetch(setupMode ? "/api/auth/setup" : "/api/auth/login", {
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

initialize().catch(() => setMessage("无法连接知识平台，请确认服务已经启动。", "error"));
