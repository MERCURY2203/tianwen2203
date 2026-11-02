-- 世界（多个人物共用的世界观）、角色头像、人设草稿

CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lore TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_worlds_user ON worlds(user_id);

ALTER TABLE characters ADD COLUMN world_id TEXT REFERENCES worlds(id) ON DELETE SET NULL;
ALTER TABLE characters ADD COLUMN avatar_id TEXT;

CREATE TABLE avatars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_drafts_user ON drafts(user_id, updated_at);
