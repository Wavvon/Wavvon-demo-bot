# CLAUDE.md

Guidance for working in this repo: the Wavvon demo bot, one Node program on
[`@wavvon/sdk`](https://github.com/Wavvon/Wavvon-sdk-js) that shows every
program feature of Wavvon. Hub code is in
[Wavvon-server](https://github.com/Wavvon/Wavvon-server); the design of apps,
slash commands, events and mini-apps is in
[Wavvon-docs](https://github.com/Wavvon/Wavvon-docs) (`apps.md`, `sdk.md`,
`mini-apps.md`, `outgoing-webhooks.md`).

## Commands

```sh
npm ci
npm test          # node --test, no framework. Must pass before a commit.
npm start         # needs the environment in README.md
npm run smoke     # against a running hub and bot, below
```

Plain JavaScript, ESM, Node 22.13+, no build step. The only dependency is the SDK.

## Layout

- `src/main.js` wires it up: config, SQLite, one `WavvonClient` per hub,
  registration, the HTTP server.
- `src/app.js` the HTTP surface. `/hook` takes every hub's dispatches and picks
  the verifier by `X-Wavvon-Hub-Pubkey`, checked against the key pinned from
  that hub's `/info`, never trusted on its own.
- `src/router.js` joins features. **A feature is one module in
  `src/features/`**, listed in `src/features/index.js`; `router.js` documents
  its shape. A new feature should not need to touch any other.
- `src/store.js` per-hub key/value settings in `DATA_DIR/bot.sqlite`; its `db`
  is there for a feature that needs its own table (Cairn's leaderboard).
- `src/mini-app.js` the bot's mini-app sessions, one per channel. The hub opens
  the same `mini_app_url` for every launch card, so the frame learns which game
  it shows from the bot's first answer to its `hello`; a game feature handles
  its frames through the router's `games`.
- `frame/` the mini-app page, served at `/play/` by `src/features/frame.js`.
  Static ES modules, no build, nothing external (its CSP forbids it). It must
  read its context both ways: desktop injects `window.__WAVVON_*` globals, web
  `postMessage`s `wavvon_context` from the parent.

## Rules

- **Capabilities, never versions.** A feature that needs something new from a
  hub checks `/info.capabilities` and stays quiet where it is missing.
- **Use what the hub enforces.** Before inventing a policy (who may configure
  the bot, rate limits), look for the hub's own: a command's `privileged` flag,
  `cooldown_seconds`, the caller's permissions.
- If the SDK lacks something, open an issue on Wavvon-sdk-js and work around it
  minimally here.

## Smoke test

Unit tests cannot show that a hub reaches the bot. Against one local hub
(Wavvon-server's `run-hub` skill), with the bot's identity as owner:

```sh
SEED=$(openssl rand -hex 32)
# hub: WAVVON_OWNER_PUBKEY=<the bot's public key> WAVVON_ALLOW_PRIVATE_WEBHOOKS=true
WAVVON_HUB_URL=http://localhost:3000 WAVVON_SEED=$SEED PUBLIC_BASE_URL=http://localhost:8080 npm start
WAVVON_HUB_URL=http://localhost:3000 WAVVON_SEED=$SEED npm run smoke
```

`scripts/smoke.mjs` invites a second member with the bot's key, sends every
command as that member and clicks a `/faq` button over the socket, plays a
full `/tictactoe` game against a third member through two scoped mini-app
sockets (`app_join`, then `/ws?token=`), submits an impossible and a
plausible Cairn score and reads them back with `/leaderboard`, checks the
hub refuses `/welcome` to that member, then has a newcomer join and
waits for the greeting. Give both the bot and the script the same
`GITHUB_WEBHOOK_SECRET` and it also delivers the recorded release in
`test/fixtures/` to the bot's `/github` and waits for the announcement. The bot's
public key: `node -e "import('@wavvon/sdk').then(m=>console.log(m.identityFromSeed(process.argv[1]).publicKey))" $SEED`.

## Conventions

- Code comments in English, only where the why is not obvious.
- No comments in GitHub Actions workflow files; explain choices in the commit message.
- Branch from `develop`, one PR per issue, `Fixes #N` in the body, squash-merge.
  Commits carry a `Co-Authored-By` trailer when an assistant wrote them.
