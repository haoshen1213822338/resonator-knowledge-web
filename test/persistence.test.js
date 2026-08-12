import assert from "node:assert/strict";
import test from "node:test";
import { DataType, newDb } from "pg-mem";
import { createPersistence } from "../lib/persistence.js";

async function createTestPersistence(workerId = "test-worker") {
  const memory = newDb();
  memory.public.registerFunction({
    name: "current_database",
    returns: DataType.text,
    implementation: () => "resonator_test",
  });
  memory.public.registerFunction({
    name: "version",
    returns: DataType.text,
    implementation: () => "PostgreSQL test adapter",
  });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  const persistence = createPersistence({ poolOverride: pool, workerId });
  await persistence.initialize();
  return { persistence, pool };
}

test("persists authentication, chats, logs and import jobs", async () => {
  const { persistence } = await createTestPersistence();
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const authStore = {
    version: 2,
    sessionSecret: "test-secret",
    users: [{
      id: "user-1",
      username: "admin",
      displayName: "Admin",
      role: "admin",
      spaces: ["space-1"],
      disabled: false,
      passwordSalt: "salt",
      passwordHash: "hash",
      createdAt: now,
      updatedAt: now,
    }],
    sessions: [{ id: "session-1", userId: "user-1", createdAt: now, expiresAt: future }],
  };
  await persistence.saveAuthStore(authStore);
  const loadedAuth = await persistence.loadAuthStore({ users: [], sessions: [] });
  assert.equal(loadedAuth.users[0].username, "admin");
  assert.equal(loadedAuth.sessions[0].id, "session-1");

  const chat = {
    id: "chat-1", space: "space-1", ownerId: "user-1", title: "测试对话",
    messages: [{ role: "user", content: "你好" }], createdAt: now, updatedAt: now,
  };
  await persistence.writeChatSession(chat);
  assert.equal((await persistence.readChatSession("space-1", "chat-1")).title, "测试对话");
  assert.equal((await persistence.listChatSessions("space-1", "user-1"))[0].messageCount, 1);

  await persistence.appendAuditLog({
    id: "audit-1", createdAt: now, userId: "user-1", username: "admin",
    action: "test", space: "space-1", target: "target", detail: "detail", ip: "127.0.0.1",
  });
  assert.equal((await persistence.readAuditLogs(10))[0].action, "test");

  const job = {
    id: "job-1", space: "space-1", status: "queued", project: "测试项目",
    createdAt: now, updatedAt: now, savedFiles: [],
  };
  await persistence.writeImportJob(job);
  assert.equal((await persistence.readImportJob("space-1", "job-1")).project, "测试项目");
  assert.equal((await persistence.listImportJobs("space-1", 10)).length, 1);

  await persistence.writeUploadSession({
    id: "upload-1", space: "space-1", ownerId: "user-1", status: "uploading",
    files: [], createdAt: now, updatedAt: now,
  });
  assert.equal((await persistence.readUploadSession("space-1", "upload-1")).status, "uploading");
  assert.equal(await persistence.countActiveUploadSessions("space-1"), 1);
  await persistence.deleteExpiredUploadSessions(new Date(Date.now() + 60_000).toISOString());
  assert.equal(await persistence.readUploadSession("space-1", "upload-1"), null);

  const health = await persistence.health();
  assert.equal(health.database, "resonator_test");
  await persistence.close();
});

test("keeps login sessions from concurrent snapshots", async () => {
  const { persistence } = await createTestPersistence();
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const user = {
    id: "user-1", username: "member", displayName: "Member", role: "member",
    spaces: [], disabled: false, passwordSalt: "salt", passwordHash: "hash",
    createdAt: now, updatedAt: now,
  };
  await persistence.saveAuthStore({
    sessionSecret: "secret", users: [user],
    sessions: [{ id: "session-a", userId: user.id, createdAt: now, expiresAt: future }],
  });
  await persistence.saveAuthStore({
    sessionSecret: "secret", users: [user],
    sessions: [{ id: "session-b", userId: user.id, createdAt: now, expiresAt: future }],
  });
  const loaded = await persistence.loadAuthStore({ users: [], sessions: [] });
  assert.deepEqual(loaded.sessions.map((item) => item.id).sort(), ["session-a", "session-b"]);
  await persistence.deleteAuthSession("session-a");
  assert.deepEqual(
    (await persistence.loadAuthStore({ users: [], sessions: [] })).sessions.map((item) => item.id),
    ["session-b"]
  );
  await persistence.close();
});

test("claims one durable queue task and tracks its lifecycle", async () => {
  const { persistence } = await createTestPersistence("queue-worker");
  const now = new Date().toISOString();
  await persistence.writeImportJob({
    id: "job-queue", space: "space-1", status: "queued",
    createdAt: now, updatedAt: now,
  });
  assert.equal(await persistence.ensureTask("space-1", "job-queue"), true);
  assert.equal(await persistence.ensureTask("space-1", "job-queue"), false);
  const task = await persistence.claimTask();
  assert.equal(task.jobId, "job-queue");
  assert.equal(await persistence.claimTask(), null);
  await persistence.heartbeatTask(task.id);
  assert.equal((await persistence.queueStats("space-1")).running, 1);
  await persistence.finishTask(task.id);
  assert.deepEqual(await persistence.queueStats("space-1"), {});
  await persistence.close();
});

test("stores one-time migration markers", async () => {
  const { persistence } = await createTestPersistence("migration-worker");
  assert.equal(await persistence.getSetting("legacy_files_migrated_v1"), null);
  await persistence.setSetting("legacy_files_migrated_v1", {
    completedAt: "2026-08-12T00:00:00.000Z",
    chats: 3,
  });
  assert.deepEqual(await persistence.getSetting("legacy_files_migrated_v1"), {
    completedAt: "2026-08-12T00:00:00.000Z",
    chats: 3,
  });
  await persistence.close();
});
