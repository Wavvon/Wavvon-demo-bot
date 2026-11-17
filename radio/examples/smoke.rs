//! Smoke test against one running hub: the radio plays its generated tone
//! into a room and this program, a listener in the same room, must decode
//! at least 100 frames with tone energy and see the radio stand at its
//! position. Nothing touches an audio device.
//!
//!   WAVVON_SMOKE_HUB=http://localhost:3400 cargo run --example smoke
//!
//! The seed identity (default `5a` repeated) must be a hub owner. Build the
//! radio first (`cargo build`); the example starts it from the same target
//! directory.

use std::time::Duration;

use wavvon_sdk::voice::VoiceEvent;
use wavvon_sdk::{Client, ConnectOptions, Identity};

type Out = Result<(), Box<dyn std::error::Error>>;

#[tokio::main]
async fn main() -> Out {
    let hub = std::env::var("WAVVON_SMOKE_HUB").map_err(|_| "set WAVVON_SMOKE_HUB")?;
    let owner_seed = std::env::var("WAVVON_SMOKE_SEED").unwrap_or_else(|_| "5a".repeat(32));
    let radio_seed = "7a".repeat(32);
    let owner = Client::connect(
        &hub,
        Identity::from_seed_hex(&owner_seed)?,
        ConnectOptions::default(),
    )
    .await?;
    let radio_key = Identity::from_seed_hex(&radio_seed)?.public_key_hex();

    let name = format!("radio-smoke-{}", &radio_key[..6]);
    {
        let name = name.clone();
        owner
            .call(|api| {
                let name = name.clone();
                async move {
                    api.create_channel()
                        .body_map(|x| x.name(name).channel_type("voice".to_string()))
                        .send()
                        .await
                }
            })
            .await?;
    }
    let channel = owner
        .call(|api| async move { api.list_channels().send().await })
        .await?
        .into_inner()
        .iter()
        .find(|c| c.name.as_deref() == Some(name.as_str()))
        .and_then(|c| c.id.clone())
        .ok_or("created voice channel is not listed")?;
    let invite = owner
        .call(|api| {
            let key = radio_key.clone();
            async move {
                api.create_invite()
                    .body_map(|b| b.bound_pubkey(key))
                    .send()
                    .await
            }
        })
        .await?
        .into_inner()
        .code
        .ok_or("no invite code")?;

    let voice = owner.join_voice(&channel).await?;
    voice
        .create_zone(
            "radio-zone",
            "radio",
            "2d",
            serde_json::json!({}),
            "any_channel_member",
        )
        .await?;

    let exe = std::env::current_exe()?;
    let bin = exe
        .parent()
        .and_then(|p| p.parent())
        .ok_or("no target dir")?
        .join(format!("wavvon-radio{}", std::env::consts::EXE_SUFFIX));
    let mut radio = tokio::process::Command::new(bin)
        .env("WAVVON_HUB_URL", &hub)
        .env("WAVVON_SEED", &radio_seed)
        .env("WAVVON_INVITE", invite)
        .env("RADIO_CHANNEL", &channel)
        .env("RADIO_SOURCE", "tone")
        .env("RADIO_POSITION", "3,4")
        .kill_on_drop(true)
        .spawn()?;

    let (mut loud, mut quiet, mut stood) = (0usize, 0usize, false);
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(ev) = voice.next().await {
            match ev? {
                VoiceEvent::Audio(a) if a.from == radio_key => {
                    let pcm = a.pcm.as_deref().unwrap_or_default();
                    let energy = pcm.iter().map(|x| x * x).sum::<f32>() / pcm.len().max(1) as f32;
                    if energy >= 1e-4 {
                        loud += 1;
                    } else {
                        quiet += 1;
                    }
                }
                VoiceEvent::Position {
                    public_key,
                    position,
                    ..
                } if public_key == radio_key && position == [3.0, 4.0] => stood = true,
                _ => {}
            }
            if loud >= 100 && stood {
                return Ok::<_, wavvon_sdk::Error>(());
            }
        }
        Ok(())
    })
    .await;
    radio.kill().await?;
    result.map_err(|_| format!("timed out: {loud} loud frames, stood: {stood}"))??;
    println!("decoded {loud} frames with tone energy ({quiet} quiet); radio stood at 3,4");
    println!("RADIO SMOKE OK");
    voice.leave().await?;
    Ok(())
}
