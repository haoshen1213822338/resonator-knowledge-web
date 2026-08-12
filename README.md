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
- 大文件分片上传、断线续传、分片校验与上传完成后的后台解析
- PostgreSQL 业务数据持久化和可由多台后端共同消费的持久化任务队列
- 使用 AES-256-GCM 加密整理后的知识文档和向量索引，网页端透明解密
- 在回答区展示引用来源和知识片段
- 引用可定位到 PDF 页码、PPT 幻灯片和视频时间段
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

## PostgreSQL 与持久化任务队列

不配置 `DATABASE_URL` 时，系统继续使用本地 JSON 文件，适合当前单机测试。正式部署或多台后端共同运行时，建议启用 PostgreSQL：

```text
DATABASE_URL=postgresql://knowledge_app:强密码@127.0.0.1:5432/resonator_knowledge
DATABASE_SSL=false
DATABASE_POOL_SIZE=10
```

配置好 `.env` 后，先初始化并检查数据库，再启动网站：

```powershell
npm run db:setup
npm run dev
```

系统会自动建立账号、登录会话、历史对话、操作日志、导入任务、断点上传会话和任务队列表。首次启用时会把已有本地数据迁移一次，之后 PostgreSQL 成为这些业务数据的主存储，本地文件只保留兼容镜像。

资料解析任务会先写入持久化队列，再由后端工作进程领取。即使网站重启，未完成任务仍会保留；多台后端同时运行时，数据库行锁会避免同一个任务被重复处理。运行中的任务每 30 秒更新心跳，异常中断超过 2 小时后会自动回到待处理状态。

如果部署多台后端，除了共用同一个 PostgreSQL，它们还必须访问同一份知识库和上传文件目录，例如挂载同一个 NAS 共享目录或对象存储；数据库队列只保存任务状态，不保存几个 TB 的原始文件本体。

也可以在安装 Docker 的部署机上使用仓库中的 `docker-compose.postgres.yml` 启动数据库。启动前必须设置 `POSTGRES_PASSWORD`，然后把 `DATABASE_URL` 中的密码改成相同值。

注意：资料后台的“项目快照”主要备份知识文件，不能代替 PostgreSQL 数据库备份。正式环境还需要启用云数据库自动备份，或定期执行 `pg_dump`。

## 向量语义检索

系统默认使用本地 `BAAI/bge-small-zh-v1.5` 模型。首次在资料后台点击“更新语义索引”时会下载模型；索引按项目保存在各自的 `99_系统配置/vector_index`，后续只重新处理新增或修改过的 Markdown。问答时会把语义检索结果与关键词、项目别名结果合并排序。

## 精确引用

PDF、PPT 和视频入库后，系统会在 `90_AI输出/_引用证据` 中生成一份加密证据索引。它保留未经 AI 改写的原始定位信息：PDF 使用“第 N 页”，PPT 使用“幻灯片 N”，视频语音和画面使用 `HH:MM:SS–HH:MM:SS` 时间段。员工问答时，右侧引用卡片会显示原始文件名、位置和证据片段，回答提示词也会要求 AI 使用相同位置。

旧资料无需重新上传。网站启动或管理员点击“更新语义索引”时，会根据已有的 `*_解析结果.md` 自动补建引用证据；随后重建一次语义索引即可让旧资料参与精确引用。定位准确度取决于原始解析结果：文字型 PDF/PPT 通常可直接定位，扫描件依赖 OCR，视频时间点精度取决于语音分段和关键帧采样间隔。

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

## 大文件断点续传

正式上传会把文件拆成 8 MB 分片，并最多同时上传 3 个分片。网络中断后，重新选择同一批文件并再次点击上传，网页会读取服务器上的上传会话并跳过已经完成的分片。文件大小本身不设上限；每个请求只携带一个小分片，避免把整个视频一次性放进服务器内存。

可在 `.env` 调整：

```text
UPLOAD_CHUNK_SIZE=8388608
UPLOAD_SESSION_RETENTION_HOURS=72
```

未完成的分片默认保留 72 小时，不会出现在资料列表或项目备份中。上传全部完成后，服务器先校验分片数量和合并后文件大小，再创建解析整理任务。

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
