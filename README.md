# 公司知识问答本地原型

这是“共振体”公司知识平台的第一版本地网页原型。

当前能力：

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

