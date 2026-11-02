-- 纯前端版的卡密：联网激活，每个卡密限制设备数
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  max_devices INTEGER NOT NULL DEFAULT 2,
  note TEXT NOT NULL DEFAULT '',
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE license_devices (
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (license_id, device_id)
);
