# Wavvon radio

A small Rust program, separate from the Node bot, that joins a voice channel and
plays one audio source into it. It is standalone: nothing here talks to the bot.

## Run it

```sh
cd radio
WAVVON_HUB_URL=https://hub.example \
WAVVON_SEED=<64 hex> \
WAVVON_INVITE=<code, first run only> \
RADIO_CHANNEL=<voice channel id> \
RADIO_SOURCE=<tone | path/to/file.opus | https://host/stream.opus> \
cargo run --release
```

| Variable | Meaning |
|---|---|
| `WAVVON_HUB_URL`, `WAVVON_SEED`, `WAVVON_INVITE` | As for the bot: the radio's own identity, and an invite for its first login. |
| `RADIO_CHANNEL` | Id of the voice channel to play in. |
| `RADIO_SOURCE` | `tone` (a 440 Hz sine synthesised at runtime, for smoke tests), an Ogg Opus file (looped), or an `http(s)://` Ogg Opus stream. |
| `RADIO_POSITION` | Optional `x,y` (or `x,y,z`). If the room has a proximity zone, the radio stands there; a refusal is logged. |
| `RADIO_ZONE` | Optional zone id; the first zone of the room by default. |

The radio needs the permission to speak in the channel.

Opus packets of 20 ms are sent as they are. A stream with any other frame size
is decoded and re-framed to 20 ms. A dropped stream is reopened with a backoff
of 1 s doubling to 60 s; a dropped hub socket is rejoined by the SDK.

## Choose a legal source

This repository ships no audio, and the radio judges none. Play only what you
may redistribute:

- public domain or CC0 recordings;
- Creative Commons recordings that allow it (CC-BY and similar), with the
  attribution they ask for, for instance in the channel description;
- a station that expressly permits rebroadcast.

Whoever runs the radio is responsible for what it plays. Voice is end-to-end
encrypted, so the hub operator cannot see or filter what plays.

## Develop

```sh
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Smoke test against one running hub whose owner is the seed `5a` repeated
(`WAVVON_OWNER_PUBKEY`): `cargo build && WAVVON_SMOKE_HUB=http://localhost:3400 cargo run --example smoke`.
The radio plays the tone into a fresh room; the example decodes 100 frames
of it and checks the radio's position.

The SDK is a git dependency pinned by revision, because nothing is published.
