// زرّ الصوت: الميكروفون يعمل بين ضغطتين فقط، والتسجيل يُفرَّغ على خادم محلي عبر المضيف.
//
// الإذن يطلبه المتصفّح المضمّن نفسه عند أول ضغطة. لا تسجيل في الخلفية، ولا حفظ للصوت: يُرمَّز
// WAV في الذاكرة، ويُرسل مرة، ويُهمل. حين لا يكون خادم التفريغ مضبوطًا يقول الزرّ ذلك ولا يسجّل.

import { useRef, useState } from "react";

import { useTranslator } from "../../app/context";
import type { Phase08Client } from "../../ipc/p08-client";
import { bytesToBase64 } from "../../p08/files";
import { concat, downsample, encodeWav, MAX_SECONDS } from "../../p08/wav";
import { Icon } from "../../ui/components/Icon";

type Phase = "IDLE" | "RECORDING" | "TRANSCRIBING" | "FAILED";

interface Recorder {
  stop(): Float32Array;
  rate: number;
}

async function startRecorder(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor قديم لكنه متاح بلا ملف عامل منفصل (سياسة CSP تمنع blob:).
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination);
  return {
    rate: context.sampleRate,
    stop() {
      processor.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
      return concat(chunks);
    },
  };
}

export function VoiceButton({ phase08, configured, onText }: { readonly phase08?: Phase08Client | undefined; readonly configured: boolean; onText(text: string): void }) {
  const translator = useTranslator();
  const [phase, setPhase] = useState<Phase>("IDLE");
  const recorder = useRef<Recorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const available = phase08 !== undefined && configured && typeof navigator !== "undefined" && navigator.mediaDevices !== undefined;

  async function stop(): Promise<void> {
    if (timer.current !== null) clearTimeout(timer.current);
    const r = recorder.current;
    recorder.current = null;
    if (r === null || phase08 === undefined) return;
    const samples = downsample(r.stop(), r.rate);
    setPhase("TRANSCRIBING");
    const wav = encodeWav(samples);
    const result = await phase08.transcribe(bytesToBase64(wav), translator.locale);
    if (result.ok && result.value.text !== "") {
      onText(result.value.text);
      setPhase("IDLE");
    } else {
      setPhase("FAILED");
    }
  }

  async function toggle(): Promise<void> {
    if (!available) return;
    if (phase === "RECORDING") {
      await stop();
      return;
    }
    try {
      recorder.current = await startRecorder();
      setPhase("RECORDING");
      timer.current = setTimeout(() => void stop(), MAX_SECONDS * 1000);
    } catch {
      setPhase("FAILED");
    }
  }

  const labelKey = !available ? "p08.voice.unavailable" : phase === "RECORDING" ? "p08.voice.stop" : phase === "TRANSCRIBING" ? "p08.voice.transcribing" : phase === "FAILED" ? "p08.voice.failed" : "p08.voice.start";
  return (
    <button
      type="button"
      className={`icon-button voice${phase === "RECORDING" ? " is-recording" : ""}`}
      disabled={!available || phase === "TRANSCRIBING"}
      aria-pressed={phase === "RECORDING"}
      aria-label={translator.t(labelKey)}
      title={translator.t(labelKey)}
      onClick={() => void toggle()}
    >
      {phase === "RECORDING" ? <span className="voice__stop" aria-hidden="true" /> : <Icon name="mic" />}
    </button>
  );
}
