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
| `/releases set [#channel]`, `/releases off` | An endpoint of the bot's own: GitHub's `release` webhook, signature checked, announced in the chosen channel. |
| `/tictactoe @member` | A mini-app: a launch card in the channel opens a two-player board. The bot holds the game, checks every move and decides the result; anyone else who joins watches. |
| `/cairn` | A single-player mini-app: Cairn, a falling-stones puzzle. Scores go to the bot, which keeps one leaderboard per hub. |
| `/leaderboard` | This hub's top 10 Cairn players, each by their best run. |
| `/loam [minutes]` | A multiplayer mini-app with proximity voice: Loam, worms in a garden plot whose voices fade as they drift apart. Rounds of 1 to 5 minutes, 3 by default. |

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
| `GITHUB_WEBHOOK_SECRET` | Turns on `<PUBLIC_BASE_URL>/github`; without it that endpoint does not exist. |

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

## Mini-apps

The games run in a *mini-app*: a page this bot serves at
`<PUBLIC_BASE_URL>/play/`, which the Wavvon client opens in a frame when someone
presses Join on a launch card. The frame talks to the bot only through the hub's
WebSocket (`mini_app_message`), with a token the hub scoped to that one channel,
and the bot answers each player separately. It is plain HTML and JavaScript in
`frame/`, with nothing loaded from anywhere else; keyboard players can do
everything a mouse can.

The web client loads mini-apps over https only, so behind a local
`PUBLIC_BASE_URL=http://…` the games open in the desktop client but not on the
web.

One game runs per channel at a time; a game nobody touches for ten minutes is
closed. Games live in memory and end when the bot restarts.

### Cairn

Stones fall into a ravine nine cells wide; fill a row and it clears. What makes
it Cairn:

- Six stones of one to five cells, from the single pebble to the arch.
- Some stones carry a gem. A cleared row holding a gem scores double.
- Every eight rows the ravine deepens: stones fall faster and every clear is
  worth more.
- Clearing more rows with one stone pays more: 10, 30 or 60 points for one,
  two or three rows, times the depth.

Arrows move, Up or X turns, Space drops, P pauses; on a touch screen, the
buttons under the ravine do the same.

**A client-side game cannot be made cheat-proof.** The game runs in the
player's frame, so a player who edits the page or speaks the protocol by hand
can send any score. The bot checks what it can: that it saw the run start,
that the score is one the rules can produce from that many rows, and that the
rows could have been cleared in the time between start and finish. That stops
an impossible score, not a patient forger. Treat the leaderboard as a toy.

### Loam

Up to eight worms share a garden plot, 40 cells square. Dew drops appear
around it; a worm that reaches one grows by a segment. Touch a wall or any
worm, your own tail included, and you curl up: you keep half your length,
the other half is left behind as dew for whoever gets there first, and you
rest for a moment before setting off again. Nobody is knocked out. When the
time is up the longest worm wins, and the bot posts the standings in the
channel.

Arrows or WASD steer, Enter starts a round; on a touch screen, the buttons
under the plot. Anyone who presses Join gets a worm, until the plot is full;
later arrivals watch.

The bot runs the plot. Each frame only sends its player's turns, and reports
its own worm's place to its own Wavvon client, which stands that player there
in the channel's proximity voice. To hear it:

1. Run `/loam` in a **voice channel**: the client moves you only in the voice
   of the channel the game was opened in.
2. Someone who can manage channels turns on that channel's **room map** in the
   voice panel. That creates the zone the worms are mapped onto.
3. Everyone joins the channel's voice, then presses Join on the card.

Without any of these the game plays the same and the frame says why voice is
not following the worms: not in this channel's voice, no room map, or a client
without the mini-app voice bridge.

## Announce GitHub releases

1. Make a secret (`openssl rand -hex 32`) and set it as `GITHUB_WEBHOOK_SECRET`.
2. In the GitHub repository (or organization): Settings, Webhooks, Add webhook.
   Payload URL `<PUBLIC_BASE_URL>/github`, content type `application/json`, the
   same secret, and "Let me select individual events": **Releases** only.
3. In each hub, `/releases set #announcements`.

Only `release` events with action `published` are announced, to every hub
served by this process that has picked a channel. Everything else is accepted
and ignored.

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
