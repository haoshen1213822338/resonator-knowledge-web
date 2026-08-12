# 公司知识问答本地原型

这是“共振体”公司知识平台的第一版本地网页原型。

当前能力：

- 用户登录、自助注册、三类角色和项目访问隔离
- 每个账号独立保存历史对话
- 超级管理员在资料后台创建账号并分配项目库
- 登录、问答、入库、建库和删除操作留有审计日志
- 读取本地 Obsidian/Markdown 知识库中的 `90_AI输出`
- 根据问题搜索相关 Markdown 文件
- 调用 DeepSeek API 生成可追溯回答
- 在回答区展示引用来源和知识片段
- 使用品牌化暗色视觉、动态共振背景和鼠标响应效果

## 启动

```powershell
cd E:\共振体\知识库项目\knowledge-web
npm run dev
```

打开：

```text
http://localhost:3030
```

首次打开会进入登录页。请在部署电脑本机创建唯一的超级管理员，系统不会预设通用密码。员工之后可以自行注册，注册账号默认没有项目权限，由超级管理员在资料后台分配普通成员/资料管理员角色和可访问项目库。

账号、登录会话和操作日志默认保存在项目的 `data` 目录，该目录不会提交到 GitHub。正式部署时可在 `.env` 中用 `DATA_DIR` 指定到受保护并定期备份的位置。

## 知识库目录

默认读取：

```text
D:\Wecaht\聊天记录\wechat_kb_test_export\90_AI输出
```

如需修改，可以在 `.env` 中设置：

```text
KNOWLEDGE_DIR=D:\Wecaht\聊天记录\wechat_kb_test_export\90_AI输出
```

## DeepSeek 配置

复制 `.env.example` 为 `.env`，然后填写：

```text
PORT=3030
KNOWLEDGE_DIR=D:\Wecaht\聊天记录\wechat_kb_test_export\90_AI输出
AI_PROVIDER=deepseek
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
AI_API_KEY=你的 DeepSeek API Key
```

注意：

- API Key 只放在 `.env`
- `.env` 已被 `.gitignore` 忽略，不能提交到 GitHub
- 前端网页不保存 API Key
- 后端先检索本地知识库，再把相关片段交给 AI 生成答案

## 版本管理

每次修改代码后执行：

```powershell
git status
git add .
git commit -m "说明这次修改"
git push
```
