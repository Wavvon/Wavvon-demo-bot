# Wavvon demo bot

One bot that shows what a program can do on [Wavvon](https://github.com/Wavvon):
slash commands, buttons, and per-hub settings, built on
[`@wavvon/sdk`](https://www.npmjs.com/package/@wavvon/sdk). It runs on the
official and demo hubs, and one process can serve several hubs at once.

| Command | Shows |
|---|---|
| `/roll <NdM>` | A slash command with arguments, answered in the channel (up to 100 dice, 2 to 1000 sides). A bad spec is answered to you alone. |
| `/coin` | The smallest slash command there is. |
| `/faq` | A reply with buttons; a click is answered to the person who clicked. |
| `/docs <topic>` | Links the matching page of the [Wavvon docs](https://github.com/Wavvon/Wavvon-docs). `/docs` alone lists the topics. |
| `/welcome set [#channel]`, `/welcome off` | Hub events: greets each new member in the chosen channel (the current one if none is named). Needs a hub advertising `events.member.joined`. |

Commands that change the bot's settings are registered as *privileged*: the hub
itself refuses them to anyone without `messages.manage`, so the bot never has
to decide who is in charge.

A program on Wavvon is a client like any other: an Ed25519 key, the same login,
the same permissions. What lets it register commands is a role carrying
`apps.register` ([apps.md](https://github.com/Wavvon/Wavvon-docs/blob/main/docs/apps.md)).

## Run it

Node 22.13 or later (it uses the built-in `node:sqlite`).

```sh
npm ci
WAVVON_HUB_URL=https://hub.example \
WAVVON_SEED=$(cat seed.hex) \
WAVVON_INVITE=<code, first run only> \
PUBLIC_BASE_URL=https://bot.example \
npm start
```

| Variable | Meaning |
|---|---|
| `WAVVON_HUB_URL` | The hub, or several separated by commas. |
| `WAVVON_SEED` | The bot's identity: a 32-byte Ed25519 seed, hex. It never leaves this process. |
| `WAVVON_INVITE` | An invite code for the first login on an invite-only hub. With several hubs, one per hub in the same order (`code1,,code3`). |
| `PUBLIC_BASE_URL` | Where the hubs reach this bot. The hub POSTs commands and button clicks to `<PUBLIC_BASE_URL>/hook`. |
| `PORT` | HTTP port, default `8080`. |
| `DATA_DIR` | Where the SQLite file lives, default `./data`. |

Settings are stored per hub, keyed by the hub URL as written in `WAVVON_HUB_URL`.

## Give it an identity

1. Make a seed and keep it like a password:
   ```sh
   openssl rand -hex 32 > seed.hex && chmod 600 seed.hex
   ```
2. **Invite it.** In the hub, create an invite (Settings, Invites) and pass its
   code as `WAVVON_INVITE` on the first run. An invite bound to the bot's
   public key also lets it past the admission challenge, which a program cannot
   solve. The bot prints its public key once it is in.
3. **Grant `apps.register`.** Create a role (for example "Apps") with the
   `apps.register` permission and give it to the bot. Without it the bot logs
   in but cannot register its commands; restart it after granting the role.

A hub only calls webhooks over https on a public address. To try the bot against
a hub on your own machine, start that hub with
`WAVVON_ALLOW_PRIVATE_WEBHOOKS=true` and use `PUBLIC_BASE_URL=http://localhost:8080`.

## Deploy

A systemd unit, with the settings in `/etc/wavvon-demo-bot.env`:

```ini
[Unit]
Description=Wavvon demo bot
After=network-online.target
Wants=network-online.target

[Service]
User=wavvon-bot
WorkingDirectory=/opt/wavvon-demo-bot
EnvironmentFile=/etc/wavvon-demo-bot.env
Environment=DATA_DIR=/var/lib/wavvon-demo-bot
StateDirectory=wavvon-demo-bot
ExecStart=/usr/bin/node src/main.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Caddy in front of it, for TLS:

```caddy
bot.example {
	reverse_proxy localhost:8080
}
```

## Develop

```sh
npm test          # unit tests
npm run smoke     # drives a running bot through a real hub; see CLAUDE.md
```

A new feature is one module in `src/features/`, listed in
`src/features/index.js`. See `src/router.js` for its shape.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
