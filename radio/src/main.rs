//! Plays an Ogg Opus file, an HTTP(S) Ogg Opus stream, or a generated test
//! tone into a Wavvon voice channel, optionally standing at a point of the
//! room's proximity zone. See the README for the environment and the licence
//! note: the program carries audio and judges none of it.

mod ogg;

use std::time::Duration;

use audiopus::coder::Decoder;
use audiopus::{Channels, SampleRate};
use wavvon_sdk::voice::{Voice, VoiceEvent};
use wavvon_sdk::{Client, ConnectOptions, Identity};

type Out = Result<(), Box<dyn std::error::Error>>;

const FRAME: usize = 960;
const STALL: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq)]
enum Source {
    Tone,
    File(String),
    Stream(String),
}

fn parse_source(s: &str) -> Source {
    if s == "tone" {
        Source::Tone
    } else if s.starts_with("http://") || s.starts_with("https://") {
        Source::Stream(s.to_string())
    } else {
        Source::File(s.to_string())
    }
}

fn parse_position(s: &str) -> Result<Vec<f64>, String> {
    let p: Result<Vec<f64>, _> = s.split(',').map(|n| n.trim().parse::<f64>()).collect();
    match p {
        Ok(p) if (2..=3).contains(&p.len()) => Ok(p),
        _ => Err(format!(
            "RADIO_POSITION must be \"x,y\" or \"x,y,z\", got {s:?}"
        )),
    }
}

/// 1 s, 2 s, 4 s ... capped at 60 s.
fn backoff(attempt: u32) -> Duration {
    Duration::from_secs((1u64 << attempt.min(6)).min(60))
}

/// Duration of an Opus packet in microseconds, from its TOC byte (RFC 6716 3.1).
fn duration_us(packet: &[u8]) -> Option<u32> {
    let toc = *packet.first()?;
    let config = (toc >> 3) as usize;
    let frame_us = match config {
        0..=11 => [10_000, 20_000, 40_000, 60_000][config % 4],
        12..=15 => [10_000, 20_000][config % 2],
        _ => [2_500, 5_000, 10_000, 20_000][config % 4],
    };
    let frames = match toc & 3 {
        0 => 1,
        1 | 2 => 2,
        _ => u32::from(packet.get(1)? & 0x3f),
    };
    (frames > 0).then_some(frame_us * frames)
}

/// Sends packets as they come: 20 ms ones as they are, anything else decoded
/// and cut into 20 ms frames, which is the one thing the SDK will send.
struct Sink {
    voice: Voice,
    decoder: Decoder,
    pcm: Vec<f32>,
    errors: u32,
}

impl Sink {
    fn new(voice: Voice) -> Result<Self, audiopus::Error> {
        Ok(Self {
            voice,
            decoder: Decoder::new(SampleRate::Hz48000, Channels::Stereo)?,
            pcm: Vec::new(),
            errors: 0,
        })
    }

    async fn packet(&mut self, packet: &[u8]) -> Out {
        if packet.starts_with(b"OpusHead") || packet.starts_with(b"OpusTags") {
            return Ok(());
        }
        let r = if duration_us(packet) == Some(20_000) {
            self.voice.send_opus(packet).await
        } else {
            let mut out = vec![0f32; 5760 * 2];
            let n = match self.decoder.decode_float(Some(packet), &mut out[..], false) {
                Ok(n) => n,
                Err(e) => {
                    eprintln!("radio: undecodable packet skipped: {e}");
                    return Ok(());
                }
            };
            self.pcm
                .extend(out[..n * 2].chunks(2).map(|c| (c[0] + c[1]) / 2.0));
            let mut r = Ok(());
            while r.is_ok() && self.pcm.len() >= FRAME {
                let frame: Vec<f32> = self.pcm.drain(..FRAME).collect();
                r = self.voice.send_pcm(&frame).await;
            }
            r
        };
        self.after_send(r).await
    }

    /// Mid-rejoin the room is briefly gone; a room that stays gone ends the
    /// program so a supervisor can restart it.
    async fn after_send(&mut self, r: wavvon_sdk::Result<()>) -> Out {
        match r {
            Ok(()) => self.errors = 0,
            Err(e) => {
                self.errors += 1;
                if self.errors > 50 {
                    return Err(e.into());
                }
                eprintln!("radio: send failed: {e}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
        Ok(())
    }
}

/// Feeds bytes through the demuxer; returns how many packets they carried.
async fn play_bytes(
    sink: &mut Sink,
    demux: &mut ogg::Demuxer,
    bytes: &[u8],
) -> Result<u64, Box<dyn std::error::Error>> {
    let mut n = 0;
    for p in demux.push(bytes) {
        sink.packet(&p).await?;
        n += 1;
    }
    Ok(n)
}

async fn play_file(sink: &mut Sink, path: &str) -> Out {
    let bytes = tokio::fs::read(path).await?;
    let mut demux = ogg::Demuxer::default();
    let mut n = 0;
    for chunk in bytes.chunks(16 * 1024) {
        n += play_bytes(sink, &mut demux, chunk).await?;
    }
    if n == 0 {
        return Err(format!("{path}: no Ogg Opus packets").into());
    }
    Ok(())
}

/// Plays a stream until it ends or fails, counting its packets.
async fn play_stream(sink: &mut Sink, url: &str, packets: &mut u64) -> Out {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let mut resp = client.get(url).send().await?.error_for_status()?;
    let mut demux = ogg::Demuxer::default();
    while let Some(chunk) = tokio::time::timeout(STALL, resp.chunk()).await?? {
        *packets += play_bytes(sink, &mut demux, &chunk).await?;
    }
    Ok(())
}

async fn play_tone(sink: &mut Sink) -> Out {
    for i in 0usize.. {
        let pcm: Vec<f32> = (0..FRAME)
            .map(|n| {
                let t = ((i * FRAME + n) % 48_000) as f32 / 48_000.0;
                0.3 * (2.0 * std::f32::consts::PI * 440.0 * t).sin()
            })
            .collect();
        let r = sink.voice.send_pcm(&pcm).await;
        sink.after_send(r).await?;
    }
    Ok(())
}

async fn run(sink: &mut Sink, source: &Source) -> Out {
    match source {
        Source::Tone => play_tone(sink).await,
        Source::File(path) => loop {
            play_file(sink, path).await?;
        },
        Source::Stream(url) => {
            let mut attempt = 0;
            loop {
                let mut packets = 0;
                match play_stream(sink, url, &mut packets).await {
                    Ok(()) => eprintln!("radio: stream ended after {packets} packets"),
                    Err(e) => eprintln!("radio: stream failed after {packets} packets: {e}"),
                }
                attempt = if packets > 0 { 0 } else { attempt + 1 };
                let wait = backoff(attempt);
                eprintln!("radio: reconnecting in {} s", wait.as_secs());
                tokio::time::sleep(wait).await;
            }
        }
    }
}

fn apply_position(voice: &Voice, zone: &Option<String>, position: &[f64]) {
    let zones = voice.zones();
    let Some(z) = zones
        .iter()
        .find(|z| zone.as_ref().is_none_or(|id| *id == z.zone_id))
    else {
        return;
    };
    if let Err(e) = voice.set_position(&z.zone_id, position) {
        eprintln!("radio: cannot stand in zone {}: {e}", z.zone_id);
    }
}

#[tokio::main]
async fn main() -> Out {
    let env = |k: &str| std::env::var(k).map_err(|_| format!("set {k}"));
    let hub = env("WAVVON_HUB_URL")?;
    let channel = env("RADIO_CHANNEL")?;
    let source = parse_source(&env("RADIO_SOURCE")?);
    let position = std::env::var("RADIO_POSITION")
        .ok()
        .map(|p| parse_position(&p))
        .transpose()?;
    let zone = std::env::var("RADIO_ZONE").ok();
    let identity = Identity::from_seed_hex(&env("WAVVON_SEED")?)?;
    let opts = ConnectOptions {
        invite_code: std::env::var("WAVVON_INVITE")
            .ok()
            .filter(|s| !s.is_empty()),
        ..Default::default()
    };
    let client = Client::connect(&hub, identity, opts).await?;
    let voice = client.join_voice(&channel).await?;
    eprintln!("radio: joined {channel} as {}", client.public_key());

    let events = voice.clone();
    tokio::spawn(async move {
        if let Some(p) = &position {
            apply_position(&events, &zone, p);
        }
        while let Some(ev) = events.next().await {
            match ev {
                Ok(VoiceEvent::Zones(_)) | Ok(VoiceEvent::Rejoining) => {
                    if let Some(p) = &position {
                        apply_position(&events, &zone, p);
                    }
                }
                Ok(VoiceEvent::PositionRefused { reason }) => {
                    eprintln!("radio: position refused: {reason}")
                }
                Ok(VoiceEvent::KeySkipped { public_key, reason }) => {
                    eprintln!("radio: {public_key} cannot hear this room: {reason}")
                }
                Ok(_) => {}
                Err(e) => eprintln!("radio: voice: {e}"),
            }
        }
    });

    let mut sink = Sink::new(voice.clone())?;
    tokio::select! {
        r = run(&mut sink, &source) => r?,
        _ = tokio::signal::ctrl_c() => {}
    }
    voice.leave().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources() {
        assert_eq!(parse_source("tone"), Source::Tone);
        assert_eq!(
            parse_source("https://x/y.opus"),
            Source::Stream("https://x/y.opus".into())
        );
        assert_eq!(parse_source("a.opus"), Source::File("a.opus".into()));
    }

    #[test]
    fn positions() {
        assert_eq!(parse_position("10, 5.5"), Ok(vec![10.0, 5.5]));
        assert!(parse_position("1").is_err());
        assert!(parse_position("a,b").is_err());
    }

    #[test]
    fn frame_sizes() {
        assert_eq!(duration_us(&[0xF8]), Some(20_000));
        assert_eq!(duration_us(&[0xF0]), Some(10_000));
        assert_eq!(duration_us(&[0x09]), Some(40_000));
        assert_eq!(duration_us(&[0xFB, 3]), Some(60_000));
        assert_eq!(duration_us(&[0xFB, 0]), None);
        assert_eq!(duration_us(&[]), None);
    }

    #[test]
    fn backoff_doubles_and_caps() {
        let s: Vec<u64> = (0..9).map(|a| backoff(a).as_secs()).collect();
        assert_eq!(s, vec![1, 2, 4, 8, 16, 32, 60, 60, 60]);
    }
}
