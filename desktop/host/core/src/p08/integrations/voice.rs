// الإدخال الصوتي: تسجيل في العارض بإذن صريح، ثم تفريغ نصّي على خادم محلي على الجهاز.
//
// الخصوصية هي القيد الحاكم: الصوت لا يغادر الجهاز. نقطة النهاية يجب أن تكون حلقة محلية
// (خادم Whisper متوافق مع OpenAI مثل whisper.cpp أو faster-whisper)؛ عنوان بعيد يُرفض عند
// الضبط وعند الاستعمال. لا ميكروفون دائم: العارض يسجّل حين يضغط المستخدم ويتوقّف حين يتوقّف،
// والمضيف لا يرى إلا ملف WAV كاملًا يُفرَّغ ثم يُهمل ولا يُخزَّن.

use std::sync::Arc;
use std::time::{Duration, Instant};

use polaris_host_providers::net::endpoint::loopback;
use polaris_host_providers::net::{CancelToken, HttpClient, HttpRequest};
use serde::Serialize;

pub const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_AUDIO_SECONDS: u32 = 600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WavFacts {
    pub channels: u16,
    pub sample_rate: u32,
    pub bits_per_sample: u16,
    pub seconds: u32,
}

fn le16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
}
fn le32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// يتحقّق من ملف WAV (PCM) ويعيد حقائقه. ما ليس WAV سليمًا يُرفض قبل أي إرسال.
pub fn inspect_wav(bytes: &[u8]) -> Result<WavFacts, String> {
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err("the recording is larger than the limit".into());
    }
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("the recording is not a WAV file".into());
    }
    let mut at = 12;
    let mut format: Option<(u16, u16, u32, u16)> = None;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = le32(bytes, at + 4).ok_or("truncated chunk")? as usize;
        let body = at + 8;
        if id == b"fmt " {
            let tag = le16(bytes, body).ok_or("truncated fmt")?;
            let channels = le16(bytes, body + 2).ok_or("truncated fmt")?;
            let rate = le32(bytes, body + 4).ok_or("truncated fmt")?;
            let bits = le16(bytes, body + 14).ok_or("truncated fmt")?;
            format = Some((tag, channels, rate, bits));
        } else if id == b"data" {
            let (tag, channels, rate, bits) = format.ok_or("the data chunk precedes the format chunk")?;
            if tag != 1 || channels == 0 || channels > 2 || !(8_000..=48_000).contains(&rate) || !(bits == 16 || bits == 8) {
                return Err("only 8/16-bit PCM mono or stereo at 8–48 kHz is accepted".into());
            }
            let bytes_per_second = rate as usize * channels as usize * (bits as usize / 8);
            let data = size.min(bytes.len().saturating_sub(body));
            let seconds = (data / bytes_per_second.max(1)) as u32;
            if seconds > MAX_AUDIO_SECONDS {
                return Err("the recording is longer than ten minutes".into());
            }
            return Ok(WavFacts { channels, sample_rate: rate, bits_per_sample: bits, seconds });
        }
        at = body + size + (size & 1);
    }
    Err("the recording holds no audio data".into())
}

/// منفذ التفريغ.
pub trait Transcriber: Send + Sync {
    fn transcribe(&self, wav: &[u8], language: Option<&str>) -> Result<String, String>;
}

/// خادم تفريغ محلي بواجهة `/v1/audio/transcriptions` المتوافقة مع OpenAI.
pub struct LocalWhisperTranscriber {
    pub http: Arc<HttpClient>,
    pub endpoint: String,
    pub model: String,
}

impl Transcriber for LocalWhisperTranscriber {
    fn transcribe(&self, wav: &[u8], language: Option<&str>) -> Result<String, String> {
        inspect_wav(wav)?;
        let resolved = loopback(&self.endpoint).map_err(|e| format!("the transcription endpoint must be on this computer (loopback): {e:?}"))?;
        let boundary = format!("polaris-{}", crate::ids::new_uuid_v4().replace('-', ""));
        let mut body = Vec::new();
        let mut field = |name: &str, value: &str| {
            body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
        };
        field("model", &self.model);
        field("response_format", "json");
        if let Some(l) = language.filter(|l| l.len() <= 8 && l.chars().all(|c| c.is_ascii_alphabetic() || c == '-')) {
            field("language", l);
        }
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
        body.extend_from_slice(wav);
        body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
        let path = format!("{}/v1/audio/transcriptions", resolved.base_path.trim_end_matches('/'));
        let request = HttpRequest {
            idle: None,
            method: "POST",
            path: if path.starts_with('/') { path } else { format!("/{path}") },
            headers: vec![("Content-Type", format!("multipart/form-data; boundary={boundary}")), ("Accept", "application/json".into())],
            body: Some(body),
            deadline: Instant::now() + Duration::from_secs(180),
        };
        let mut response = self.http.send(&resolved, request, &CancelToken::new()).map_err(|e| format!("the transcription server could not be reached: {:?}", e.kind))?;
        let bytes = response.body.read_all(1024 * 1024).map_err(|e| format!("{:?}", e.kind))?;
        if response.status != 200 {
            return Err(format!("the transcription server answered {}", response.status));
        }
        let json: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "the transcription server did not answer JSON")?;
        let text = json.get("text").and_then(|t| t.as_str()).ok_or("the transcription holds no text")?;
        Ok(text.trim().chars().take(20_000).collect())
    }
}

#[cfg(test)]
pub(crate) fn test_wav(seconds: u32) -> Vec<u8> {
    let rate = 16_000u32;
    let data_len = rate * 2 * seconds;
    let mut w = Vec::new();
    w.extend(b"RIFF");
    w.extend((36 + data_len).to_le_bytes());
    w.extend(b"WAVEfmt ");
    w.extend(16u32.to_le_bytes());
    w.extend(1u16.to_le_bytes());
    w.extend(1u16.to_le_bytes());
    w.extend(rate.to_le_bytes());
    w.extend((rate * 2).to_le_bytes());
    w.extend(2u16.to_le_bytes());
    w.extend(16u16.to_le_bytes());
    w.extend(b"data");
    w.extend(data_len.to_le_bytes());
    w.extend(std::iter::repeat_n(0u8, data_len as usize));
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pcm_wav_is_accepted_and_anything_else_is_refused() {
        let facts = inspect_wav(&test_wav(2)).unwrap();
        assert_eq!((facts.channels, facts.sample_rate, facts.bits_per_sample, facts.seconds), (1, 16_000, 16, 2));
        assert!(inspect_wav(b"OggS....").is_err());
        let mut float = test_wav(1);
        float[20] = 3;
        assert!(inspect_wav(&float).is_err(), "IEEE float was accepted");
    }

    #[test]
    fn a_remote_transcription_endpoint_is_refused_before_any_byte_is_sent() {
        let t = LocalWhisperTranscriber { http: Arc::new(HttpClient::new()), endpoint: "https://api.example.com".into(), model: "whisper-1".into() };
        let err = t.transcribe(&test_wav(1), None).unwrap_err();
        assert!(err.contains("loopback"), "{err}");
    }
}
