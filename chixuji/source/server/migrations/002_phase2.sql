-- 第 2 阶段：图片、记忆、模型调用记录、隐藏（被重新生成替换的）消息

ALTER TABLE events ADD COLUMN hidden_at TEXT;

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_images_character ON images(character_id);

-- 记忆：anchor_seq 指向一条 memory_commit 事件，可见范围与聊天消息完全一致（按世界线隔离、不倒灌）
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  anchor_seq INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- fact 事实 / plan 计划约定 / opinion 角色的主观看法
  holder TEXT NOT NULL,          -- 谁说的/谁的看法：user / character / both
  content TEXT NOT NULL,
  source_seqs TEXT NOT NULL,     -- 来源消息编号（JSON 数组）
  important INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,          -- active 生效 / pending 待你确认 / invalid 已作废
  invalid_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_memories_branch ON memories(branch_id, anchor_seq);

-- 每一次模型调用都记一笔，方便算钱和排查
CREATE TABLE model_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  character_id TEXT,
  branch_id TEXT,
  purpose TEXT NOT NULL,         -- reply 回复 / vision 看图 / memory 记忆整理
  model TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  prompt_hit_tokens INTEGER,
  prompt_miss_tokens INTEGER,
  completion_tokens INTEGER,
  cost_micro_yuan INTEGER,       -- 估算花费，单位：百万分之一元
  ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_model_calls_user ON model_calls(user_id, created_at);
CREATE INDEX idx_model_calls_time ON model_calls(created_at);
