import { ok } from "@wavvon/sdk";

/** "@Ada", "Ada" or a public key -> the one member it names; undefined when none, or several share the name. */
export async function findMember(client, text) {
  const q = (text ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!q || q.length > 64) return undefined;
  const users = ok(await client.rest.GET("/users", { params: { query: { q, limit: 500 } } }));
  const byKey = users.find((u) => u.public_key.toLowerCase() === q);
  if (byKey) return byKey;
  const named = users.filter((u) => u.display_name?.toLowerCase() === q);
  return named.length === 1 ? named[0] : undefined;
}

export const displayName = (pubkey, name) => name || `${pubkey.slice(0, 8)}…`;
