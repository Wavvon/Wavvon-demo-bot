import { DatabaseSync } from "node:sqlite";

/** Per-hub key/value settings in SQLite. `hub` is the hub URL the bot was configured with. */
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS settings (hub TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (hub, key))",
  );
  const get = db.prepare("SELECT value FROM settings WHERE hub = ? AND key = ?");
  const set = db.prepare(
    "INSERT INTO settings (hub, key, value) VALUES (?, ?, ?) ON CONFLICT (hub, key) DO UPDATE SET value = excluded.value",
  );
  const del = db.prepare("DELETE FROM settings WHERE hub = ? AND key = ?");
  return {
    get: (hub, key) => get.get(hub, key)?.value,
    set: (hub, key, value) => void set.run(hub, key, value),
    delete: (hub, key) => void del.run(hub, key),
  };
}
