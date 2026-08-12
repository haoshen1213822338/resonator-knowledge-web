import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL,
  spaces jsonb NOT NULL DEFAULT '[]'::jsonb,
  disabled boolean NOT NULL DEFAULT false,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id text PRIMARY KEY,
  space text NOT NULL,
  owner_id text NOT NULL DEFAULT '',
  title text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_sessions_space_owner_idx
  ON chat_sessions(space, owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  user_id text NOT NULL DEFAULT '',
  username text NOT NULL,
  action text NOT NULL,
  space text NOT NULL DEFAULT '',
  target text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_space_idx ON audit_logs(space, created_at DESC);

CREATE TABLE IF NOT EXISTS import_jobs (
  id text PRIMARY KEY,
  space text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS import_jobs_space_updated_idx
  ON import_jobs(space, updated_at DESC);
CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id text PRIMARY KEY,
  space text NOT NULL,
  owner_id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS upload_sessions_space_updated_idx
  ON upload_sessions(space, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_queue (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  space text NOT NULL,
  job_id text NOT NULL UNIQUE REFERENCES import_jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text NOT NULL DEFAULT '',
  locked_at timestamptz,
  heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_queue_claim_idx
  ON task_queue(status, available_at, created_at);
`;

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value || "");
}

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    spaces: Array.isArray(row.spaces) ? row.spaces : [],
    disabled: Boolean(row.disabled),
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapAuthSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}

export function createPersistence({ databaseUrl = "", ssl = false, workerId = "", poolOverride = null } = {}) {
  const enabled = Boolean(poolOverride || String(databaseUrl || "").trim());
  const testPool = Boolean(poolOverride);
  const instanceId = workerId || `worker_${process.pid}_${randomUUID().slice(0, 8)}`;
  let lastQueueRecoveryAt = 0;
  const pool = poolOverride || (enabled
    ? new Pool({
      connectionString: databaseUrl,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: Math.max(2, Number(process.env.DATABASE_POOL_SIZE || 10)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
    : null);

  async function initialize() {
    if (!pool) return { enabled: false };
    await pool.query(SCHEMA_SQL);
    await pool.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
    await recoverStaleTasks();
    return { enabled: true, workerId: instanceId };
  }

  async function recoverStaleTasks() {
    if (!pool) return 0;
    const result = await pool.query(
      `UPDATE task_queue
       SET status = 'queued', locked_by = '', locked_at = NULL, heartbeat_at = NULL,
           available_at = now(), updated_at = now()
       WHERE status = 'running'
         AND COALESCE(heartbeat_at, locked_at, updated_at) < now() - interval '2 hours'`
    );
    lastQueueRecoveryAt = Date.now();
    return Number(result.rowCount || 0);
  }

  async function getSetting(key) {
    if (!pool) return null;
    const result = await pool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
    return result.rows[0]?.value ?? null;
  }

  async function setSetting(key, value, client = pool) {
    if (!pool) return;
    await client.query(
      `INSERT INTO app_settings(key, value, updated_at) VALUES($1, $2::jsonb, now())
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }

  async function loadAuthStore(fallbackStore) {
    if (!pool) return fallbackStore;
    const [secret, usersResult, sessionsResult] = await Promise.all([
      getSetting("session_secret"),
      pool.query("SELECT * FROM users ORDER BY created_at"),
      pool.query("SELECT * FROM auth_sessions WHERE expires_at > now() ORDER BY created_at"),
    ]);
    if (usersResult.rows.length === 0 && fallbackStore?.users?.length) {
      await saveAuthStore(fallbackStore);
      return fallbackStore;
    }
    const sessionSecret = secret || fallbackStore?.sessionSecret;
    if (!secret && sessionSecret) await setSetting("session_secret", sessionSecret);
    return {
      version: 2,
      sessionSecret,
      users: usersResult.rows.map(mapUser),
      sessions: sessionsResult.rows.map(mapAuthSession),
    };
  }

  async function saveAuthStore(store) {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setSetting("session_secret", store.sessionSecret, client);
      for (const user of store.users || []) {
        await client.query(
          `INSERT INTO users(
             id, username, display_name, role, spaces, disabled, password_salt,
             password_hash, created_at, updated_at
           ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
           ON CONFLICT(id) DO UPDATE SET
             username=EXCLUDED.username, display_name=EXCLUDED.display_name,
             role=EXCLUDED.role, spaces=EXCLUDED.spaces, disabled=EXCLUDED.disabled,
             password_salt=EXCLUDED.password_salt, password_hash=EXCLUDED.password_hash,
             updated_at=EXCLUDED.updated_at`,
          [
            user.id, user.username, user.displayName, user.role,
            JSON.stringify(user.spaces || []), Boolean(user.disabled),
            user.passwordSalt, user.passwordHash, user.createdAt, user.updatedAt,
          ]
        );
      }
      for (const session of store.sessions || []) {
        await client.query(
          `INSERT INTO auth_sessions(id, user_id, created_at, expires_at)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,
             created_at=EXCLUDED.created_at, expires_at=EXCLUDED.expires_at`,
          [session.id, session.userId, session.createdAt, session.expiresAt]
        );
      }
      await client.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function writeChatSession(session) {
    if (!pool) return;
    await pool.query(
      `INSERT INTO chat_sessions(id, space, owner_id, title, messages, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT(id) DO UPDATE SET space=EXCLUDED.space, owner_id=EXCLUDED.owner_id,
         title=EXCLUDED.title, messages=EXCLUDED.messages, updated_at=EXCLUDED.updated_at`,
      [session.id, session.space, session.ownerId || "", session.title,
        JSON.stringify(session.messages || []), session.createdAt, session.updatedAt]
    );
  }

  async function deleteAuthSession(sessionId) {
    if (!pool) return;
    await pool.query("DELETE FROM auth_sessions WHERE id=$1", [sessionId]);
  }

  async function deleteUserSessions(userId) {
    if (!pool) return;
    await pool.query("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
  }

  async function readChatSession(space, id) {
    if (!pool) return null;
    const result = await pool.query(
      "SELECT * FROM chat_sessions WHERE space=$1 AND id=$2",
      [space, id]
    );
    const row = result.rows[0];
    return row ? {
      id: row.id, space: row.space, ownerId: row.owner_id, title: row.title,
      messages: row.messages || [], createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
    } : null;
  }

  async function listChatSessions(space, ownerId, includeUnowned = false) {
    if (!pool) return [];
    const result = await pool.query(
      `SELECT id, title, messages, created_at, updated_at
       FROM chat_sessions
       WHERE space=$1 AND (owner_id=$2 OR ($3::boolean AND owner_id=''))
       ORDER BY updated_at DESC`,
      [space, ownerId || "", includeUnowned]
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      messageCount: Array.isArray(row.messages) ? row.messages.length : 0,
    }));
  }

  async function appendAuditLog(record) {
    if (!pool) return;
    await pool.query(
      `INSERT INTO audit_logs(id, created_at, user_id, username, action, space, target, detail, ip)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
      [record.id, record.createdAt, record.userId, record.username, record.action,
        record.space, record.target, record.detail, record.ip]
    );
  }

  async function readAuditLogs(limit) {
    if (!pool) return [];
    const result = await pool.query(
      "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1",
      [Math.min(Math.max(Number(limit) || 100, 1), 500)]
    );
    return result.rows.map((row) => ({
      id: row.id, createdAt: toIso(row.created_at), userId: row.user_id,
      username: row.username, action: row.action, space: row.space,
      target: row.target, detail: row.detail, ip: row.ip,
    }));
  }

  async function writeImportJob(job) {
    if (!pool) return;
    await pool.query(
      `INSERT INTO import_jobs(id, space, status, payload, created_at, updated_at)
       VALUES($1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT(id) DO UPDATE SET space=EXCLUDED.space, status=EXCLUDED.status,
         payload=EXCLUDED.payload, updated_at=EXCLUDED.updated_at`,
      [job.id, job.space, job.status, JSON.stringify(job), job.createdAt, job.updatedAt]
    );
  }

  async function readImportJob(space, id) {
    if (!pool) return null;
    const result = await pool.query(
      "SELECT payload FROM import_jobs WHERE space=$1 AND id=$2",
      [space, id]
    );
    return result.rows[0]?.payload || null;
  }

  async function listImportJobs(space, limit) {
    if (!pool) return [];
    const result = await pool.query(
      "SELECT payload FROM import_jobs WHERE space=$1 ORDER BY updated_at DESC LIMIT $2",
      [space, Math.min(Math.max(Number(limit) || 30, 1), 500)]
    );
    return result.rows.map((row) => row.payload);
  }

  async function writeUploadSession(session) {
    if (!pool) return;
    await pool.query(
      `INSERT INTO upload_sessions(id, space, owner_id, status, payload, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status, payload=EXCLUDED.payload,
         updated_at=EXCLUDED.updated_at`,
      [session.id, session.space, session.ownerId || "", session.status,
        JSON.stringify(session), session.createdAt, session.updatedAt]
    );
  }

  async function readUploadSession(space, id) {
    if (!pool) return null;
    const result = await pool.query(
      "SELECT payload FROM upload_sessions WHERE space=$1 AND id=$2",
      [space, id]
    );
    return result.rows[0]?.payload || null;
  }

  async function deleteUploadSession(space, id) {
    if (!pool) return;
    await pool.query("DELETE FROM upload_sessions WHERE space=$1 AND id=$2", [space, id]);
  }

  async function deleteExpiredUploadSessions(threshold) {
    if (!pool) return 0;
    const result = await pool.query(
      "DELETE FROM upload_sessions WHERE updated_at < $1",
      [threshold]
    );
    return Number(result.rowCount || 0);
  }

  async function countActiveUploadSessions(space) {
    if (!pool) return 0;
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM upload_sessions WHERE space=$1 AND status <> 'completed'",
      [space]
    );
    return Number(result.rows[0]?.count || 0);
  }

  async function enqueueTask(space, jobId, delayMs = 0) {
    if (!pool) return;
    await pool.query(
      `INSERT INTO task_queue(id, kind, space, job_id, status, available_at)
       VALUES($1,'import',$2,$3,'queued',now() + ($4::text || ' milliseconds')::interval)
       ON CONFLICT(job_id) DO UPDATE SET status='queued',
         available_at=EXCLUDED.available_at, locked_by='', locked_at=NULL,
         heartbeat_at=NULL, updated_at=now()`,
      [randomUUID(), space, jobId, Math.max(0, Number(delayMs || 0))]
    );
  }

  async function ensureTask(space, jobId, availableAt = "") {
    if (!pool) return false;
    const existing = await pool.query(
      "SELECT 1 FROM task_queue WHERE job_id=$1 LIMIT 1",
      [jobId]
    );
    if (existing.rows.length > 0) return false;
    const result = await pool.query(
      `INSERT INTO task_queue(id, kind, space, job_id, status, available_at)
       VALUES($1,'import',$2,$3,'queued',COALESCE($4::timestamptz, now()))
       ON CONFLICT(job_id) DO NOTHING
       RETURNING id`,
      [randomUUID(), space, jobId, availableAt || null]
    );
    return result.rows.length > 0;
  }

  async function claimTask() {
    if (!pool) return null;
    if (Date.now() - lastQueueRecoveryAt >= 60_000) {
      await recoverStaleTasks();
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT id, space, job_id FROM task_queue
         WHERE status='queued' AND available_at <= now()
         ORDER BY available_at, created_at
         LIMIT 1 FOR UPDATE${testPool ? "" : " SKIP LOCKED"}`
      );
      const task = selected.rows[0];
      if (!task) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `UPDATE task_queue SET status='running', locked_by=$2, locked_at=now(),
           heartbeat_at=now(), updated_at=now() WHERE id=$1`,
        [task.id, instanceId]
      );
      await client.query("COMMIT");
      return { id: task.id, spaceId: task.space, jobId: task.job_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function heartbeatTask(taskId) {
    if (!pool || !taskId) return;
    await pool.query(
      "UPDATE task_queue SET heartbeat_at=now(), updated_at=now() WHERE id=$1 AND locked_by=$2",
      [taskId, instanceId]
    );
  }

  async function finishTask(taskId) {
    if (!pool || !taskId) return;
    await pool.query(
      `UPDATE task_queue SET status='completed', locked_by='', locked_at=NULL,
       heartbeat_at=NULL, updated_at=now() WHERE id=$1`,
      [taskId]
    );
  }

  async function queueStats(space) {
    if (!pool) return null;
    const result = await pool.query(
      `SELECT status, count(*)::int AS count FROM task_queue
       WHERE space=$1 AND status IN ('queued','running') GROUP BY status`,
      [space]
    );
    return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
  }

  async function health() {
    if (!pool) return { enabled: false, ok: true };
    const started = Date.now();
    try {
      const result = await pool.query("SELECT current_database() AS name, version() AS version");
      return {
        enabled: true,
        ok: true,
        database: result.rows[0].name,
        latencyMs: Date.now() - started,
        workerId: instanceId,
      };
    } catch (error) {
      return {
        enabled: true,
        ok: false,
        latencyMs: Date.now() - started,
        workerId: instanceId,
        error: String(error.message || error),
      };
    }
  }

  return {
    enabled,
    workerId: instanceId,
    initialize,
    close: () => pool?.end(),
    health,
    getSetting,
    setSetting,
    loadAuthStore,
    saveAuthStore,
    deleteAuthSession,
    deleteUserSessions,
    writeChatSession,
    readChatSession,
    listChatSessions,
    appendAuditLog,
    readAuditLogs,
    writeImportJob,
    readImportJob,
    listImportJobs,
    writeUploadSession,
    readUploadSession,
    deleteUploadSession,
    deleteExpiredUploadSessions,
    countActiveUploadSessions,
    enqueueTask,
    ensureTask,
    claimTask,
    heartbeatTask,
    finishTask,
    queueStats,
  };
}
