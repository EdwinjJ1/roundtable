import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import type { Pool as PgPool, PoolClient, PoolConfig } from 'pg';
import type {
  Artifact,
  AgentRuntimeConfig,
  AgentRuntimeConversation,
  AgentRuntimeDefaultConfig,
  BreakoutMessage,
  BreakoutRoom,
  Chat,
  ExecutionRun,
  Handoff,
  LocalTurn,
  Message,
  Mission,
  RoundtableSettings,
  TaskAttempt,
  UserProfile,
  Workflow,
  WorkflowRevision,
  Workbench,
  WorkbenchPin,
} from './types.js';

export type RoundtableData = {
  version: 1;
  users: Array<{ id: string; email: string; name: string | null; createdAt: string }>;
  workbenches: Workbench[];
  chats: Chat[];
  messages: Message[];
  breakoutRooms: BreakoutRoom[];
  breakoutMessages: BreakoutMessage[];
  artifacts: Artifact[];
  handoffs: Handoff[];
  profiles: UserProfile[];
  workbenchPins: WorkbenchPin[];
  turns: LocalTurn[];
  missions: Mission[];
  workflows: Workflow[];
  workflowRevisions: WorkflowRevision[];
  executionRuns: ExecutionRun[];
  taskAttempts: TaskAttempt[];
  agentRuntimeConfigs: AgentRuntimeConfig[];
  agentRuntimeDefaults: AgentRuntimeDefaultConfig[];
  agentRuntimeConversations: AgentRuntimeConversation[];
  settings: RoundtableSettings;
};

const { Pool } = pg;
const POSTGRES_TABLE = 'roundtable_store';
const DEFAULT_STORE_KEY = 'default';

let pool: PgPool | null = null;
let postgresReady: Promise<void> | null = null;
let normalizedPostgresReady: Promise<void> | null = null;

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function dataPath(): string {
  return resolve(process.env.ROUNDTABLE_DATA_PATH || '.roundtable/data.json');
}

export async function readData(): Promise<RoundtableData> {
  if (useNormalizedPostgresStore()) return readNormalizedPostgresData();
  if (usePostgresStore()) return readPostgresData();
  return readJsonData();
}

export async function writeData(data: RoundtableData): Promise<void> {
  if (useNormalizedPostgresStore()) {
    await writeNormalizedPostgresData(data);
    return;
  }
  if (usePostgresStore()) {
    await writePostgresData(data);
    return;
  }
  await withJsonLock(() => writeJsonData(data));
}

export async function mutateData<T>(fn: (data: RoundtableData) => T | Promise<T>): Promise<T> {
  if (useNormalizedPostgresStore()) return mutateNormalizedPostgresData(fn);
  if (usePostgresStore()) return mutatePostgresData(fn);
  return withJsonLock(async () => {
    const data = await readJsonData();
    const result = await fn(data);
    await writeJsonData(data);
    return result;
  });
}

// The JSON store is one shared file mutated by read-modify-write: concurrent
// callers (parallel scheduler waves, runtime-conversation updates from several
// agents) would silently drop each other's changes — and interleaved writes to
// the shared temp file tear it into invalid JSON. Serialize every mutation
// through an in-process promise chain.
let jsonLock: Promise<unknown> = Promise.resolve();

function withJsonLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = jsonLock.then(fn);
  // A failed mutation must not wedge the chain for every later caller.
  jsonLock = run.catch(() => undefined);
  return run;
}

export async function resetData(): Promise<void> {
  await writeData(emptyData());
}

async function readJsonData(): Promise<RoundtableData> {
  try {
    const raw = await readFile(dataPath(), 'utf8');
    return normalizeData(JSON.parse(raw) as Partial<RoundtableData>);
  } catch (error) {
    if (isNotFound(error)) return emptyData();
    throw error;
  }
}

let writeSeq = 0;

async function writeJsonData(data: RoundtableData): Promise<void> {
  const target = dataPath();
  await mkdir(dirname(target), { recursive: true });
  // Unique per write: a pid-only name collides when two writers in the same
  // process interleave (or two dev processes share the file), tearing the temp
  // file before the atomic rename.
  const temp = `${target}.${process.pid}.${++writeSeq}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

async function readPostgresData(): Promise<RoundtableData> {
  await ensurePostgresStore();
  const result = await getPool().query<{ data: Partial<RoundtableData> }>(
    `SELECT data FROM ${POSTGRES_TABLE} WHERE id = $1`,
    [storeKey()],
  );
  return normalizeData(result.rows[0]?.data ?? {});
}

async function writePostgresData(data: RoundtableData): Promise<void> {
  await ensurePostgresStore();
  await getPool().query(
    `INSERT INTO ${POSTGRES_TABLE} (id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [storeKey(), normalizeData(data)],
  );
}

async function mutatePostgresData<T>(fn: (data: RoundtableData) => T | Promise<T>): Promise<T> {
  await ensurePostgresStore();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await ensurePostgresRow(client);
    const result = await client.query<{ data: Partial<RoundtableData> }>(
      `SELECT data FROM ${POSTGRES_TABLE} WHERE id = $1 FOR UPDATE`,
      [storeKey()],
    );
    const data = normalizeData(result.rows[0]?.data ?? {});
    const output = await fn(data);
    await client.query(
      `UPDATE ${POSTGRES_TABLE} SET data = $2::jsonb, updated_at = now() WHERE id = $1`,
      [storeKey(), data],
    );
    await client.query('COMMIT');
    return output;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readNormalizedPostgresData(): Promise<RoundtableData> {
  await ensureNormalizedPostgresStore();
  return readNormalizedDataFrom(getPool());
}

async function writeNormalizedPostgresData(data: RoundtableData): Promise<void> {
  await ensureNormalizedPostgresStore();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockNormalizedStore(client);
    await writeNormalizedDataTo(client, data);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function mutateNormalizedPostgresData<T>(fn: (data: RoundtableData) => T | Promise<T>): Promise<T> {
  await ensureNormalizedPostgresStore();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockNormalizedStore(client);
    const data = await readNormalizedDataFrom(client);
    const output = await fn(data);
    await writeNormalizedDataTo(client, data);
    await client.query('COMMIT');
    return output;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensurePostgresStore(): Promise<void> {
  postgresReady ??= (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${POSTGRES_TABLE} (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await getPool().query(
      `INSERT INTO ${POSTGRES_TABLE} (id, data)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [storeKey(), emptyData()],
    );
  })().catch((error: unknown) => {
    postgresReady = null;
    throw error;
  });
  await postgresReady;
}

async function ensureNormalizedPostgresStore(): Promise<void> {
  normalizedPostgresReady ??= (async () => {
    for (const statement of NORMALIZED_TABLE_STATEMENTS) {
      await getPool().query(statement);
    }
    for (const statement of NORMALIZED_INDEX_STATEMENTS) {
      await getPool().query(statement);
    }
    for (const statement of NORMALIZED_CONSTRAINT_STATEMENTS) {
      await getPool().query(statement);
    }
  })().catch((error: unknown) => {
    normalizedPostgresReady = null;
    throw error;
  });
  await normalizedPostgresReady;
}

async function ensurePostgresRow(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO ${POSTGRES_TABLE} (id, data)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [storeKey(), emptyData()],
  );
}

type StoreUser = RoundtableData['users'][number];
type PgQueryable = {
  query<T = Record<string, unknown>>(
    statement: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

type NormalizedTableColumn<T> = {
  name: string;
  value: (row: T) => unknown;
};

type NormalizedTableSpec<T> = {
  table: string;
  idColumn: string;
  rows: (data: RoundtableData) => T[];
  assign: (data: RoundtableData, rows: T[]) => void;
  id: (row: T) => string;
  orderBy: string;
  columns: Array<NormalizedTableColumn<T>>;
};

function makeTableSpec<T>(spec: NormalizedTableSpec<T>): NormalizedTableSpec<T> {
  return spec;
}

const NORMALIZED_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS roundtable_users (
    store_key text NOT NULL,
    id text NOT NULL,
    email text NOT NULL,
    name text,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_workbenches (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    name text NOT NULL,
    workspace_path text NOT NULL,
    created_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_chats (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    workbench_id text NOT NULL,
    title text NOT NULL,
    created_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_messages (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    chat_id text NOT NULL,
    author_type text NOT NULL,
    author_id text NOT NULL,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_breakout_rooms (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    chat_id text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_breakout_messages (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    room_id text NOT NULL,
    author_type text NOT NULL,
    author_id text NOT NULL,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_artifacts (
    store_key text NOT NULL,
    id text NOT NULL,
    chat_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    owner_agent_id text NOT NULL,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_handoffs (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    chat_id text NOT NULL,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_profiles (
    store_key text NOT NULL,
    user_id text NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_user_skills (
    store_key text NOT NULL,
    id text NOT NULL,
    user_id text NOT NULL,
    key text NOT NULL,
    scope text NOT NULL,
    target_chat_id text,
    enabled boolean NOT NULL,
    source text NOT NULL,
    created_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_workbench_pins (
    store_key text NOT NULL,
    id text NOT NULL,
    user_id text NOT NULL,
    workbench_id text NOT NULL,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_turns (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text,
    local_chat_id text,
    mission_id text NOT NULL,
    workflow_template_id text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_missions (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text,
    chat_id text,
    source_turn_id text NOT NULL,
    status text NOT NULL,
    workflow_template_id text NOT NULL,
    created_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_workflows (
    store_key text NOT NULL,
    storage_id text NOT NULL,
    owner_id text NOT NULL,
    workflow_id text NOT NULL,
    latest_revision_id text NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, storage_id),
    UNIQUE (store_key, owner_id, workflow_id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_workflow_revisions (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    workflow_storage_id text NOT NULL,
    revision integer NOT NULL,
    content_hash text NOT NULL,
    created_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id),
    UNIQUE (store_key, workflow_storage_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_execution_runs (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    mission_id text NOT NULL,
    turn_id text NOT NULL,
    workflow_revision_id text,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_task_attempts (
    store_key text NOT NULL,
    id text NOT NULL,
    owner_id text NOT NULL,
    execution_run_id text NOT NULL,
    task_id text NOT NULL,
    attempt integer NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id),
    UNIQUE (store_key, execution_run_id, task_id, attempt)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_agent_runtime_configs (
    store_key text NOT NULL,
    agent_id text NOT NULL,
    runtime text NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, agent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_agent_runtime_defaults (
    store_key text NOT NULL,
    runtime text NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, runtime)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_agent_runtime_conversations (
    store_key text NOT NULL,
    id text NOT NULL,
    agent_id text NOT NULL,
    turn_id text,
    task_id text,
    status text NOT NULL,
    started_at timestamptz NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
  `CREATE TABLE IF NOT EXISTS roundtable_settings (
    store_key text NOT NULL,
    id text NOT NULL,
    record_updated_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_key, id)
  )`,
];

const NORMALIZED_INDEX_STATEMENTS = [
  'CREATE UNIQUE INDEX IF NOT EXISTS roundtable_users_email_unique_idx ON roundtable_users (store_key, lower(email))',
  'CREATE INDEX IF NOT EXISTS roundtable_workbenches_owner_idx ON roundtable_workbenches (store_key, owner_id)',
  'CREATE INDEX IF NOT EXISTS roundtable_chats_owner_workbench_idx ON roundtable_chats (store_key, owner_id, workbench_id)',
  'CREATE INDEX IF NOT EXISTS roundtable_messages_chat_created_idx ON roundtable_messages (store_key, chat_id, created_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_breakout_rooms_chat_updated_idx ON roundtable_breakout_rooms (store_key, chat_id, record_updated_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_breakout_messages_room_created_idx ON roundtable_breakout_messages (store_key, room_id, created_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_artifacts_chat_created_idx ON roundtable_artifacts (store_key, chat_id, created_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_handoffs_chat_created_idx ON roundtable_handoffs (store_key, chat_id, created_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_user_skills_user_idx ON roundtable_user_skills (store_key, user_id, enabled)',
  'CREATE INDEX IF NOT EXISTS roundtable_user_skills_target_chat_idx ON roundtable_user_skills (store_key, target_chat_id)',
  'CREATE INDEX IF NOT EXISTS roundtable_workbench_pins_user_workbench_idx ON roundtable_workbench_pins (store_key, user_id, workbench_id)',
  'CREATE INDEX IF NOT EXISTS roundtable_turns_chat_created_idx ON roundtable_turns (store_key, local_chat_id, created_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_missions_chat_created_idx ON roundtable_missions (store_key, chat_id, created_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_missions_status_idx ON roundtable_missions (store_key, status)',
  'CREATE INDEX IF NOT EXISTS roundtable_workflows_owner_updated_idx ON roundtable_workflows (store_key, owner_id, record_updated_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_workflow_revisions_workflow_idx ON roundtable_workflow_revisions (store_key, workflow_storage_id, revision)',
  'CREATE INDEX IF NOT EXISTS roundtable_execution_runs_mission_idx ON roundtable_execution_runs (store_key, mission_id, created_at)',
  'CREATE INDEX IF NOT EXISTS roundtable_task_attempts_run_task_idx ON roundtable_task_attempts (store_key, execution_run_id, task_id, attempt)',
  'CREATE INDEX IF NOT EXISTS roundtable_agent_runtime_conversations_turn_idx ON roundtable_agent_runtime_conversations (store_key, turn_id)',
];

const NORMALIZED_CONSTRAINT_STATEMENTS = [
  'ALTER TABLE "roundtable_artifacts" DROP CONSTRAINT IF EXISTS "roundtable_artifacts_chat_fk"',
  normalizedConstraint('roundtable_workbenches_owner_fk', 'roundtable_workbenches', '(store_key, owner_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_chats_owner_fk', 'roundtable_chats', '(store_key, owner_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_chats_workbench_fk', 'roundtable_chats', '(store_key, workbench_id)', 'roundtable_workbenches', '(store_key, id)'),
  normalizedConstraint('roundtable_messages_chat_fk', 'roundtable_messages', '(store_key, chat_id)', 'roundtable_chats', '(store_key, id)'),
  normalizedConstraint('roundtable_breakout_rooms_chat_fk', 'roundtable_breakout_rooms', '(store_key, chat_id)', 'roundtable_chats', '(store_key, id)'),
  normalizedConstraint('roundtable_breakout_messages_room_fk', 'roundtable_breakout_messages', '(store_key, room_id)', 'roundtable_breakout_rooms', '(store_key, id)'),
  normalizedConstraint('roundtable_handoffs_chat_fk', 'roundtable_handoffs', '(store_key, chat_id)', 'roundtable_chats', '(store_key, id)'),
  normalizedConstraint('roundtable_profiles_user_fk', 'roundtable_profiles', '(store_key, user_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_user_skills_user_fk', 'roundtable_user_skills', '(store_key, user_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_workbench_pins_user_fk', 'roundtable_workbench_pins', '(store_key, user_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_workbench_pins_workbench_fk', 'roundtable_workbench_pins', '(store_key, workbench_id)', 'roundtable_workbenches', '(store_key, id)'),
  normalizedConstraint('roundtable_missions_chat_fk', 'roundtable_missions', '(store_key, chat_id)', 'roundtable_chats', '(store_key, id)'),
  normalizedConstraint('roundtable_workflows_owner_fk', 'roundtable_workflows', '(store_key, owner_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_workflow_revisions_owner_fk', 'roundtable_workflow_revisions', '(store_key, owner_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_workflow_revisions_workflow_fk', 'roundtable_workflow_revisions', '(store_key, workflow_storage_id)', 'roundtable_workflows', '(store_key, storage_id)'),
  normalizedConstraint('roundtable_execution_runs_owner_fk', 'roundtable_execution_runs', '(store_key, owner_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_execution_runs_mission_fk', 'roundtable_execution_runs', '(store_key, mission_id)', 'roundtable_missions', '(store_key, id)'),
  normalizedConstraint('roundtable_task_attempts_owner_fk', 'roundtable_task_attempts', '(store_key, owner_id)', 'roundtable_users', '(store_key, id)'),
  normalizedConstraint('roundtable_task_attempts_run_fk', 'roundtable_task_attempts', '(store_key, execution_run_id)', 'roundtable_execution_runs', '(store_key, id)'),
];

const NORMALIZED_TABLE_SPECS = [
  makeTableSpec<StoreUser>({
    table: 'roundtable_users',
    idColumn: 'id',
    rows: (data) => data.users,
    assign: (data, rows) => {
      data.users = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'email', value: (row) => row.email },
      { name: 'name', value: (row) => row.name },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<Workbench>({
    table: 'roundtable_workbenches',
    idColumn: 'id',
    rows: (data) => data.workbenches,
    assign: (data, rows) => {
      data.workbenches = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'name', value: (row) => row.name },
      { name: 'workspace_path', value: (row) => row.workspacePath },
      { name: 'created_at', value: (row) => row.createdAt },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<Chat>({
    table: 'roundtable_chats',
    idColumn: 'id',
    rows: (data) => data.chats,
    assign: (data, rows) => {
      data.chats = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'workbench_id', value: (row) => row.workbenchId },
      { name: 'title', value: (row) => row.title },
      { name: 'created_at', value: (row) => row.createdAt },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<Message>({
    table: 'roundtable_messages',
    idColumn: 'id',
    rows: (data) => data.messages,
    assign: (data, rows) => {
      data.messages = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'chat_id', value: (row) => row.chatId },
      { name: 'author_type', value: (row) => row.authorType },
      { name: 'author_id', value: (row) => row.authorId },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<BreakoutRoom>({
    table: 'roundtable_breakout_rooms',
    idColumn: 'id',
    rows: (data) => data.breakoutRooms,
    assign: (data, rows) => {
      data.breakoutRooms = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'chat_id', value: (row) => row.chatId },
      { name: 'status', value: (row) => row.status },
      { name: 'created_at', value: (row) => row.createdAt },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<BreakoutMessage>({
    table: 'roundtable_breakout_messages',
    idColumn: 'id',
    rows: (data) => data.breakoutMessages,
    assign: (data, rows) => {
      data.breakoutMessages = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'room_id', value: (row) => row.roomId },
      { name: 'author_type', value: (row) => row.authorType },
      { name: 'author_id', value: (row) => row.authorId },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<Artifact>({
    table: 'roundtable_artifacts',
    idColumn: 'id',
    rows: (data) => data.artifacts,
    assign: (data, rows) => {
      data.artifacts = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'chat_id', value: (row) => row.chatId },
      { name: 'kind', value: (row) => row.kind },
      { name: 'title', value: (row) => row.title },
      { name: 'owner_agent_id', value: (row) => row.ownerAgentId },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<Handoff>({
    table: 'roundtable_handoffs',
    idColumn: 'id',
    rows: (data) => data.handoffs,
    assign: (data, rows) => {
      data.handoffs = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'chat_id', value: (row) => row.chatId },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<UserProfile>({
    table: 'roundtable_profiles',
    idColumn: 'user_id',
    rows: (data) => data.profiles,
    assign: (data, rows) => {
      data.profiles = rows;
    },
    id: (row) => row.userId,
    orderBy: 'user_id ASC',
    columns: [{ name: 'record_updated_at', value: (row) => row.updatedAt }],
  }),
  makeTableSpec<WorkbenchPin>({
    table: 'roundtable_workbench_pins',
    idColumn: 'id',
    rows: (data) => data.workbenchPins,
    assign: (data, rows) => {
      data.workbenchPins = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'user_id', value: (row) => row.userId },
      { name: 'workbench_id', value: (row) => row.workbenchId },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<LocalTurn>({
    table: 'roundtable_turns',
    idColumn: 'id',
    rows: (data) => data.turns,
    assign: (data, rows) => {
      data.turns = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'local_chat_id', value: (row) => row.localChatId },
      { name: 'mission_id', value: (row) => row.missionId },
      { name: 'workflow_template_id', value: (row) => row.workflowTemplateId },
      { name: 'status', value: (row) => row.status },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<Mission>({
    table: 'roundtable_missions',
    idColumn: 'id',
    rows: (data) => data.missions,
    assign: (data, rows) => {
      data.missions = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'chat_id', value: (row) => row.chatId },
      { name: 'source_turn_id', value: (row) => row.sourceTurnId },
      { name: 'status', value: (row) => row.status },
      { name: 'workflow_template_id', value: (row) => row.workflowTemplateId },
      { name: 'created_at', value: (row) => row.createdAt },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<Workflow>({
    table: 'roundtable_workflows',
    idColumn: 'storage_id',
    rows: (data) => data.workflows,
    assign: (data, rows) => {
      data.workflows = rows;
    },
    id: (row) => row.storageId,
    orderBy: 'record_updated_at DESC, storage_id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'workflow_id', value: (row) => row.id },
      { name: 'latest_revision_id', value: (row) => row.latestRevisionId },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<WorkflowRevision>({
    table: 'roundtable_workflow_revisions',
    idColumn: 'id',
    rows: (data) => data.workflowRevisions,
    assign: (data, rows) => {
      data.workflowRevisions = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'workflow_storage_id', value: (row) => row.workflowStorageId },
      { name: 'revision', value: (row) => row.revision },
      { name: 'content_hash', value: (row) => row.contentHash },
      { name: 'created_at', value: (row) => row.createdAt },
    ],
  }),
  makeTableSpec<ExecutionRun>({
    table: 'roundtable_execution_runs',
    idColumn: 'id',
    rows: (data) => data.executionRuns,
    assign: (data, rows) => {
      data.executionRuns = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'mission_id', value: (row) => row.missionId },
      { name: 'turn_id', value: (row) => row.turnId },
      { name: 'workflow_revision_id', value: (row) => row.workflowRevisionId },
      { name: 'status', value: (row) => row.status },
      { name: 'created_at', value: (row) => row.createdAt },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<TaskAttempt>({
    table: 'roundtable_task_attempts',
    idColumn: 'id',
    rows: (data) => data.taskAttempts,
    assign: (data, rows) => {
      data.taskAttempts = rows;
    },
    id: (row) => row.id,
    orderBy: 'created_at ASC, id ASC',
    columns: [
      { name: 'owner_id', value: (row) => row.ownerId },
      { name: 'execution_run_id', value: (row) => row.executionRunId },
      { name: 'task_id', value: (row) => row.taskId },
      { name: 'attempt', value: (row) => row.attempt },
      { name: 'status', value: (row) => row.status },
      { name: 'created_at', value: (row) => row.createdAt },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<AgentRuntimeConfig>({
    table: 'roundtable_agent_runtime_configs',
    idColumn: 'agent_id',
    rows: (data) => data.agentRuntimeConfigs,
    assign: (data, rows) => {
      data.agentRuntimeConfigs = rows;
    },
    id: (row) => row.agentId,
    orderBy: 'agent_id ASC',
    columns: [
      { name: 'runtime', value: (row) => row.runtime },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<AgentRuntimeDefaultConfig>({
    table: 'roundtable_agent_runtime_defaults',
    idColumn: 'runtime',
    rows: (data) => data.agentRuntimeDefaults,
    assign: (data, rows) => {
      data.agentRuntimeDefaults = rows;
    },
    id: (row) => row.runtime,
    orderBy: 'runtime ASC',
    columns: [
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<AgentRuntimeConversation>({
    table: 'roundtable_agent_runtime_conversations',
    idColumn: 'id',
    rows: (data) => data.agentRuntimeConversations,
    assign: (data, rows) => {
      data.agentRuntimeConversations = rows;
    },
    id: (row) => row.id,
    // The in-memory list is kept newest-first (runtime-actions prepends);
    // reads must preserve that so newest-per-task lookups stay correct.
    orderBy: 'started_at DESC, id DESC',
    columns: [
      { name: 'agent_id', value: (row) => row.agentId },
      { name: 'turn_id', value: (row) => row.turnId },
      { name: 'task_id', value: (row) => row.taskId },
      { name: 'status', value: (row) => row.status },
      { name: 'started_at', value: (row) => row.startedAt },
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
  makeTableSpec<RoundtableSettings>({
    table: 'roundtable_settings',
    idColumn: 'id',
    rows: (data) => [data.settings],
    assign: (data, rows) => {
      data.settings = rows[0] ?? data.settings;
    },
    id: () => 'settings',
    orderBy: 'id ASC',
    columns: [
      { name: 'record_updated_at', value: (row) => row.updatedAt },
    ],
  }),
];

async function readNormalizedDataFrom(queryable: PgQueryable): Promise<RoundtableData> {
  const data = emptyData();
  for (const tableSpec of NORMALIZED_TABLE_SPECS) {
    const spec = tableSpec as NormalizedTableSpec<unknown>;
    const rows = await readNormalizedRows(queryable, spec);
    spec.assign(data, rows);
  }
  return normalizeData(data);
}

async function writeNormalizedDataTo(queryable: PgQueryable, data: RoundtableData): Promise<void> {
  const normalized = normalizeData(data);
  for (const tableSpec of NORMALIZED_TABLE_SPECS) {
    const spec = tableSpec as NormalizedTableSpec<unknown>;
    await upsertNormalizedRows(queryable, spec, spec.rows(normalized));
  }
  for (const tableSpec of [...NORMALIZED_TABLE_SPECS].reverse()) {
    const spec = tableSpec as NormalizedTableSpec<unknown>;
    await deleteMissingNormalizedRows(queryable, spec, spec.rows(normalized));
  }
}

async function readNormalizedRows<T>(queryable: PgQueryable, spec: NormalizedTableSpec<T>): Promise<T[]> {
  const result = await queryable.query<{ data: T }>(
    `SELECT data FROM ${identifier(spec.table)} WHERE store_key = $1 ORDER BY ${spec.orderBy}`,
    [storeKey()],
  );
  return result.rows.map((row) => row.data);
}

async function upsertNormalizedRows<T>(
  queryable: PgQueryable,
  spec: NormalizedTableSpec<T>,
  rows: T[],
): Promise<void> {
  const table = identifier(spec.table);
  const idColumn = identifier(spec.idColumn);
  const columnNames = spec.columns.map((column) => identifier(column.name));
  const insertColumns = ['store_key', spec.idColumn, ...spec.columns.map((column) => column.name), 'data', 'updated_at']
    .map(identifier)
    .join(', ');
  const assignments = [...columnNames.map((name) => `${name} = EXCLUDED.${name}`), 'data = EXCLUDED.data', 'updated_at = now()']
    .join(', ');

  for (const row of rows) {
    const values = [storeKey(), spec.id(row), ...spec.columns.map((column) => column.value(row)), row];
    const placeholders = values.map((_, index) => (index === values.length - 1 ? `$${index + 1}::jsonb` : `$${index + 1}`));
    await queryable.query(
      `INSERT INTO ${table} (${insertColumns})
       VALUES (${[...placeholders, 'now()'].join(', ')})
       ON CONFLICT (store_key, ${idColumn})
       DO UPDATE SET ${assignments}`,
      values,
    );
  }
}

async function deleteMissingNormalizedRows<T>(
  queryable: PgQueryable,
  spec: NormalizedTableSpec<T>,
  rows: T[],
): Promise<void> {
  const rowIds = rows.map((row) => spec.id(row));
  const table = identifier(spec.table);
  const idColumn = identifier(spec.idColumn);
  if (rowIds.length === 0) {
    await queryable.query(`DELETE FROM ${table} WHERE store_key = $1`, [storeKey()]);
    return;
  }

  await queryable.query(`DELETE FROM ${table} WHERE store_key = $1 AND NOT (${idColumn} = ANY($2::text[]))`, [
    storeKey(),
    rowIds,
  ]);
}

async function lockNormalizedStore(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`roundtable:${storeKey()}`]);
}

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function normalizedConstraint(
  constraint: string,
  table: string,
  columns: string,
  targetTable: string,
  targetColumns: string,
): string {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${constraint}'
      ) THEN
        ALTER TABLE ${identifier(table)}
        ADD CONSTRAINT ${identifier(constraint)}
        FOREIGN KEY ${columns}
        REFERENCES ${identifier(targetTable)} ${targetColumns}
        ON DELETE CASCADE
        NOT VALID;
      END IF;
    END
    $$`;
}

function getPool(): PgPool {
  if (!pool) {
    const max = Number(process.env.ROUNDTABLE_POSTGRES_POOL_SIZE || 10);
    const config: PoolConfig = { max: Number.isFinite(max) && max > 0 ? max : 10 };
    if (process.env.DATABASE_URL) config.connectionString = process.env.DATABASE_URL;
    pool = new Pool(config);
  }
  return pool;
}

type StoreDriver = 'json' | 'postgres' | 'postgres_normalized';

function storeDriver(): StoreDriver {
  const driver = process.env.ROUNDTABLE_STORE_DRIVER?.trim().toLowerCase();
  if (driver === 'postgres_normalized' || driver === 'normalized') return 'postgres_normalized';
  if (driver === 'postgres') return 'postgres';
  if (driver === 'json') return 'json';
  return process.env.NODE_ENV !== 'test' && Boolean(process.env.DATABASE_URL) ? 'postgres_normalized' : 'json';
}

function useNormalizedPostgresStore(): boolean {
  return storeDriver() === 'postgres_normalized';
}

function usePostgresStore(): boolean {
  return storeDriver() === 'postgres';
}

function storeKey(): string {
  return process.env.ROUNDTABLE_STORE_KEY?.trim() || DEFAULT_STORE_KEY;
}

function emptyData(): RoundtableData {
  return {
    version: 1,
    users: [],
    workbenches: [],
    chats: [],
    messages: [],
    breakoutRooms: [],
    breakoutMessages: [],
    artifacts: [],
    handoffs: [],
    profiles: [],
    workbenchPins: [],
    turns: [],
    missions: [],
    workflows: [],
    workflowRevisions: [],
    executionRuns: [],
    taskAttempts: [],
    agentRuntimeConfigs: [],
    agentRuntimeDefaults: [],
    agentRuntimeConversations: [],
    settings: emptySettings(),
  };
}

function normalizeData(raw: Partial<RoundtableData>): RoundtableData {
  return {
    version: 1,
    users: Array.isArray(raw.users) ? raw.users : [],
    workbenches: Array.isArray(raw.workbenches) ? raw.workbenches : [],
    chats: Array.isArray(raw.chats) ? raw.chats : [],
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    breakoutRooms: Array.isArray(raw.breakoutRooms) ? raw.breakoutRooms : [],
    breakoutMessages: Array.isArray(raw.breakoutMessages) ? raw.breakoutMessages : [],
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    handoffs: Array.isArray(raw.handoffs) ? raw.handoffs : [],
    profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    workbenchPins: Array.isArray(raw.workbenchPins) ? raw.workbenchPins : [],
    turns: Array.isArray(raw.turns) ? raw.turns.map(normalizeTurn) : [],
    missions: Array.isArray(raw.missions) ? raw.missions.map(normalizeMission) : [],
    workflows: Array.isArray(raw.workflows) ? raw.workflows.map(normalizeWorkflow) : [],
    workflowRevisions: Array.isArray(raw.workflowRevisions)
      ? raw.workflowRevisions.map((revision) => normalizeWorkflowRevision(revision, raw.workflows ?? []))
      : [],
    executionRuns: Array.isArray(raw.executionRuns)
      ? raw.executionRuns.map((run) => normalizeExecutionRun(run, raw.turns ?? []))
      : [],
    taskAttempts: Array.isArray(raw.taskAttempts) ? raw.taskAttempts : [],
    agentRuntimeConfigs: Array.isArray(raw.agentRuntimeConfigs)
      ? raw.agentRuntimeConfigs.map(normalizeRuntimeConfig)
      : [],
    agentRuntimeDefaults: Array.isArray(raw.agentRuntimeDefaults)
      ? raw.agentRuntimeDefaults.map(normalizeRuntimeDefault)
      : [],
    agentRuntimeConversations: Array.isArray(raw.agentRuntimeConversations) ? raw.agentRuntimeConversations : [],
    settings: normalizeSettings(raw.settings),
  };
}

function normalizeTurn(turn: LocalTurn): LocalTurn {
  return {
    ...turn,
    workflowRevisionId: turn.workflowRevisionId ?? null,
    activeExecutionRunId: turn.activeExecutionRunId ?? null,
  };
}

function normalizeMission(mission: Mission): Mission {
  return {
    ...mission,
    workflowRevisionId: mission.workflowRevisionId ?? null,
    workflowContentHash: mission.workflowContentHash ?? null,
  };
}

function normalizeWorkflow(workflow: Workflow): Workflow {
  return {
    ...workflow,
    storageId: workflow.storageId ?? legacyWorkflowStorageId(workflow.ownerId, workflow.id),
    archivedAt: workflow.archivedAt ?? null,
  };
}

function normalizeWorkflowRevision(revision: WorkflowRevision, workflows: Workflow[]): WorkflowRevision {
  const workflow = workflows.find((item) => item.ownerId === revision.ownerId && item.id === revision.workflowId);
  return {
    ...revision,
    workflowStorageId: revision.workflowStorageId
      ?? workflow?.storageId
      ?? legacyWorkflowStorageId(revision.ownerId, revision.workflowId),
  };
}

function normalizeExecutionRun(run: ExecutionRun, turns: LocalTurn[]): ExecutionRun {
  const turn = turns.find((item) => item.id === run.turnId);
  const planSnapshot = run.planSnapshot ?? turn?.plan ?? { summary: 'Legacy execution', tasks: [] };
  return {
    ...run,
    workflowId: run.workflowId ?? turn?.workflowTemplateId ?? 'unknown',
    workflowRevisionId: run.workflowRevisionId ?? turn?.workflowRevisionId ?? null,
    workflowContentHash: run.workflowContentHash ?? turn?.mission?.workflowContentHash ?? '',
    workflowSnapshot: run.workflowSnapshot ?? turn?.workflow as ExecutionRun['workflowSnapshot'],
    planSnapshot,
    taskSnapshots: run.taskSnapshots ?? structuredClone(planSnapshot.tasks),
    workerFinishedAt: run.workerFinishedAt ?? null,
  };
}

function legacyWorkflowStorageId(ownerId: string, workflowId: string): string {
  const digest = createHash('sha256').update(JSON.stringify([ownerId, workflowId])).digest('hex').slice(0, 24);
  return `workflow_legacy_${digest}`;
}

function normalizeRuntimeConfig(config: AgentRuntimeConfig): AgentRuntimeConfig {
  return {
    ...config,
    modelProvider: config.modelProvider ?? null,
    interactionMode: config.interactionMode ?? null,
    effort: config.effort ?? null,
  };
}

function normalizeRuntimeDefault(config: AgentRuntimeDefaultConfig): AgentRuntimeDefaultConfig {
  return {
    ...config,
    modelProvider: config.modelProvider ?? null,
    interactionMode: config.interactionMode ?? null,
    effort: config.effort ?? null,
  };
}

function emptySettings(): RoundtableSettings {
  return {
    defaultAgentAdapter: null,
    modelProviders: [],
    workflowTemplates: [],
    updatedAt: nowIso(),
  };
}

function normalizeSettings(raw: Partial<RoundtableSettings> | undefined): RoundtableSettings {
  if (!raw || typeof raw !== 'object') return emptySettings();
  return {
    defaultAgentAdapter: typeof raw.defaultAgentAdapter === 'string' ? raw.defaultAgentAdapter : null,
    modelProviders: Array.isArray(raw.modelProviders) ? raw.modelProviders : [],
    workflowTemplates: Array.isArray(raw.workflowTemplates) ? raw.workflowTemplates : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
