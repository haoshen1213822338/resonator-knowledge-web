# 公司知识问答本地原型

这是“共振体”公司知识平台的第一版本地网页原型。

当前能力：

- 用户登录、自助注册、三类角色和项目访问隔离
- 每个账号独立保存历史对话
- 超级管理员在资料后台创建账号并分配项目库
- 登录、问答、入库、建库和删除操作留有审计日志
- 使用本地中文向量模型进行段落级语义检索，并与关键词、项目别名混合排序
- 读取本地 Obsidian/Markdown 知识库中的 `90_AI输出`
- 根据问题搜索相关 Markdown 文件
- 调用 OpenAI 兼容 API 生成可追溯回答
- 结合本地 OCR、语音转写和多模态模型理解图片、扫描 PDF、PPT 图表与视频关键帧
- 项目库快照备份、30 天回收站、操作审计、运行监控和入库失败自动重试
- 使用 AES-256-GCM 加密整理后的知识文档和向量索引，网页端透明解密
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

## 向量语义检索

系统默认使用本地 `BAAI/bge-small-zh-v1.5` 模型。首次在资料后台点击“更新语义索引”时会下载模型；索引按项目保存在各自的 `99_系统配置/vector_index`，后续只重新处理新增或修改过的 Markdown。问答时会把语义检索结果与关键词、项目别名结果合并排序。

## 知识库目录

默认读取：

```text
D:\Wecaht\聊天记录\wechat_kb_test_export\90_AI输出
```

如需修改，可以在 `.env` 中设置：

```text
KNOWLEDGE_DIR=D:\Wecaht\聊天记录\wechat_kb_test_export\90_AI输出
```

## AI 与多模态模型配置

复制 `.env.example` 为 `.env`，然后填写：

```text
PORT=3030
KNOWLEDGE_DIR=D:\Wecaht\聊天记录\wechat_kb_test_export\90_AI输出
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://你的兼容接口地址/v1
AI_MODEL=gemini-2.5-flash
AI_VISION_MODEL=gemini-2.5-flash
VISION_BATCH_SIZE=6
AI_API_KEY=你的 API Key
```

注意：

- API Key 只放在 `.env`
- `.env` 已被 `.gitignore` 忽略，不能提交到 GitHub
- 前端网页不保存 API Key
- 后端先检索本地知识库，再把相关片段交给 AI 生成答案
- 原始文件保存在本地；视觉分析时只把压缩后的图片、PDF 页面、PPT 幻灯片或视频关键帧发送给配置的模型服务商
- 本地向量模型与生成模型相互独立，切换多模态模型不会重建现有检索架构

## 数据保障

资料后台的“系统保障”区域可以手动创建项目库快照、从备份恢复为新项目库、恢复误删文件，并查看磁盘、任务队列和最近备份状态。删除资料默认移入当前项目库的回收站，不会直接永久删除。

自动备份默认关闭。正式部署时可在 `.env` 设置：

```text
BACKUP_DIR=D:\公司知识库备份
AUTO_BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_COUNT=7
TRASH_RETENTION_DAYS=30
IMPORT_MAX_ATTEMPTS=3
```

备份目录应尽量放在另一块物理磁盘或 NAS 上；如果与知识库放在同一块硬盘，只能防误删，不能防硬盘损坏。

## 知识资料加密

系统默认加密新生成的 `90_AI输出/*.md` 和向量索引。后台检索、问答和重建索引时会在服务器进程内透明解密，磁盘上的文件则不能直接阅读。超级管理员可以在资料后台点击“加密已有资料”，迁移当前项目库里的旧 Markdown。

默认情况下，首次启动会在 `DATA_DIR` 生成独立密钥文件：

```text
knowledge-encryption.key
```

生产部署也可以在 `.env` 中明确配置：

```text
KNOWLEDGE_ENCRYPTION_ENABLED=true
KNOWLEDGE_KEY_PATH=D:\公司知识库系统密钥\knowledge-encryption.key
# 或由服务器密钥管理服务注入 KNOWLEDGE_ENCRYPTION_KEY
```

注意：

- 密钥不能提交到 GitHub，也不要与密文只保存在同一块硬盘。
- 必须把密钥单独备份到受控介质；密钥丢失后，加密资料无法恢复。
- 服务器迁移时，需要同时安全迁移密钥，并核对后台显示的 12 位密钥编号。
- 加密后的 Markdown 无法由 Obsidian 直接阅读。需要保留 Obsidian 明文编辑体验时，应使用 BitLocker/磁盘加密保护本地仓库，再把网页知识库作为独立加密副本。
- 当前保护范围是整理后的知识文档与向量索引；原始上传文件、解析中间文件、聊天历史和操作日志仍由服务器磁盘权限及 BitLocker/NAS 加密保护。
- 调用外部 AI 时，后端会把本次问题命中的少量知识片段解密后发送给模型服务商；存储加密不等于内容完全不出服务器。

需要在隔离位置导出明文时，可以执行：

```powershell
npm run decrypt-kb -- --input "D:\公司知识库\knowledge_spaces\项目名\90_AI输出" --output "D:\临时解密资料" --key-file "D:\公司知识库系统密钥\knowledge-encryption.key"
```

解密目录使用完后应及时清理，不要放入同步盘或公开共享目录。

## 版本管理

每次修改代码后执行：

```powershell
git status
git add .
git commit -m "说明这次修改"
git push
```
