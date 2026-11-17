//! A minimal Ogg demuxer: bytes in, packets out. It reads from any point of a
//! live stream (it resynchronises on the next `OggS`) and does not check page
//! CRCs; TCP already did.

const CAPTURE: &[u8] = b"OggS";
const HEADER: usize = 27;

#[derive(Default)]
pub struct Demuxer {
    buf: Vec<u8>,
    partial: Vec<u8>,
    skip_next: bool,
}

impl Demuxer {
    /// Feeds bytes and returns every packet completed by them.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            match self.buf.windows(4).position(|w| w == CAPTURE) {
                Some(0) => {}
                Some(n) => {
                    self.buf.drain(..n);
                }
                None => {
                    let keep = self.buf.len().saturating_sub(3);
                    self.buf.drain(..keep);
                    return out;
                }
            }
            if self.buf.len() < HEADER {
                return out;
            }
            let nseg = self.buf[26] as usize;
            if self.buf.len() < HEADER + nseg {
                return out;
            }
            let body: usize = self.buf[HEADER..HEADER + nseg]
                .iter()
                .map(|&l| l as usize)
                .sum();
            let total = HEADER + nseg + body;
            if self.buf.len() < total {
                return out;
            }
            let page: Vec<u8> = self.buf.drain(..total).collect();
            let continued = page[5] & 1 != 0;
            if continued && self.partial.is_empty() {
                self.skip_next = true;
            }
            if !continued {
                self.partial.clear();
            }
            let mut at = HEADER + nseg;
            for &lace in &page[HEADER..HEADER + nseg] {
                let lace = lace as usize;
                self.partial.extend_from_slice(&page[at..at + lace]);
                at += lace;
                if lace < 255 {
                    let packet = std::mem::take(&mut self.partial);
                    if std::mem::take(&mut self.skip_next) {
                        continue;
                    }
                    out.push(packet);
                }
            }
        }
    }
}

#[cfg(test)]
pub fn page(continued: bool, packets: &[&[u8]], last_open: bool) -> Vec<u8> {
    let mut lacing = Vec::new();
    let mut body = Vec::new();
    for (i, p) in packets.iter().enumerate() {
        let mut n = p.len();
        while n >= 255 {
            lacing.push(255);
            n -= 255;
        }
        if !(last_open && i == packets.len() - 1) {
            lacing.push(n as u8);
        }
        body.extend_from_slice(p);
    }
    let mut v = b"OggS".to_vec();
    v.push(0);
    v.push(u8::from(continued));
    v.extend_from_slice(&[0; 20]);
    v.push(lacing.len() as u8);
    v.extend(lacing);
    v.extend(body);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packets_across_pages_and_chunks() {
        let big = vec![7u8; 600];
        let mut stream = page(false, &[b"OpusHead", b"abc"], false);
        stream.extend(page(false, &[&big[..255]], true));
        stream.extend(page(true, &[&big[255..], b"xy"], false));
        let mut d = Demuxer::default();
        let mut got = Vec::new();
        for chunk in stream.chunks(5) {
            got.extend(d.push(chunk));
        }
        assert_eq!(
            got,
            vec![b"OpusHead".to_vec(), b"abc".to_vec(), big, b"xy".to_vec()]
        );
    }

    #[test]
    fn exact_255_multiple_packet_ends_with_zero_lacing() {
        let p = vec![1u8; 255];
        let mut d = Demuxer::default();
        assert_eq!(d.push(&page(false, &[&p], false)), vec![p]);
    }

    #[test]
    fn joining_mid_stream_drops_the_torn_packet_and_the_garbage() {
        let mut stream = b"garbage".to_vec();
        stream.extend(page(true, &[b"tail", b"whole"], false));
        let mut d = Demuxer::default();
        assert_eq!(d.push(&stream), vec![b"whole".to_vec()]);
    }
}
