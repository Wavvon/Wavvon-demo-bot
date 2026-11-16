import { createHmac, timingSafeEqual } from "node:crypto";
import { ok } from "@wavvon/sdk";
import { channelSetting } from "../channel-setting.js";

const KEY = "releases.channel";
const MAX_NOTES = 800;

/** GitHub's X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256(secret, raw body). */
export function verifyGithubSignature(secret, rawBody, header) {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const sent = Buffer.from(header ?? "");
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

/** Cuts release notes to a chat-sized excerpt, at a line break where there is one. */
export function trimNotes(body, max = MAX_NOTES) {
  const text = (body ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  return `${(lastBreak > max / 2 ? cut.slice(0, lastBreak) : cut).trimEnd()}\n…`;
}

export function announcement({ repository, release }) {
  const title = release.name?.trim() || release.tag_name;
  const kind = release.prerelease ? "pre-release" : "release";
  const notes = trimNotes(release.body);
  return [
    `**${repository.full_name}** ${kind} **${title}** (${release.tag_name})`,
    notes,
    release.html_url,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function github(req, { config, hubs }) {
  if (!config.githubSecret) return new Response("GITHUB_WEBHOOK_SECRET is not set", { status: 404 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifyGithubSignature(config.githubSecret, raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("bad signature", { status: 401 });
  }
  if (req.headers.get("x-github-event") !== "release") return new Response(null, { status: 204 });
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("body is not JSON", { status: 400 });
  }
  if (payload.action !== "published" || !payload.release || !payload.repository) {
    return new Response(null, { status: 204 });
  }

  const content = announcement(payload);
  const targets = hubs.filter(({ hubUrl, store }) => store.get(hubUrl, KEY));
  const results = await Promise.allSettled(
    targets.map(async ({ hubUrl, client, store }) =>
      ok(
        await client.rest.POST("/channels/{channel_id}/messages", {
          params: { path: { channel_id: store.get(hubUrl, KEY) } },
          body: { content },
        }),
      ),
    ),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`${targets[i].hubUrl}: release not posted, ${r.reason?.message}`);
  });
  const posted = results.filter((r) => r.status === "fulfilled").length;
  // A failure on every hub is worth a red delivery in GitHub's log; a partial one is logged here.
  return new Response(`posted to ${posted} of ${targets.length} hubs`, {
    status: targets.length > 0 && posted === 0 ? 502 : 200,
  });
}

export default {
  commands: [
    {
      name: "releases",
      description: "Announce GitHub releases: /releases set #channel, /releases off",
      args: "set #channel | off",
      privileged: true,
    },
  ],
  slash: {
    releases: channelSetting({ command: "releases", key: KEY, what: "release announcements" }),
  },
  routes: { "/github": github },
};
