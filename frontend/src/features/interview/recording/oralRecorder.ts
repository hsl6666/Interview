export type RecordingPhase = "idle" | "requesting" | "recording" | "stopping";
type QuestionContext = { questionIndex: number; questionText: string };
export type CapturedAnswer = QuestionContext & { blob: Blob; durationSeconds: number };
type Options = {
  getStream: () => Promise<MediaStream>;
  makeRecorder: (stream: MediaStream) => MediaRecorder;
  onState: (phase: RecordingPhase) => void;
  onCapture: (answer: CapturedAnswer) => void;
  onError: (error: unknown) => void;
  now?: () => number;
};

/** Owns one microphone capture, including permission and shutdown races. */
export function createOralRecorder(options: Options) {
  const now = options.now || Date.now;
  let phase: RecordingPhase = "idle";
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let startedAt = 0;
  let stoppedAt = 0;
  let disposed = false;
  const setPhase = (next: RecordingPhase) => {
    phase = next;
    if (!disposed) options.onState(next);
  };
  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
    }
    recorder = null;
  };
  return {
    get state() {
      return phase;
    },
    async start(context: QuestionContext) {
      if (disposed || phase !== "idle") return;
      setPhase("requesting");
      try {
        const granted = await options.getStream();
        if (disposed) {
          granted.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = granted;
        const active = options.makeRecorder(granted);
        recorder = active;
        const chunks: BlobPart[] = [];
        active.ondataavailable = (event) => {
          if (!disposed && event.data.size) chunks.push(event.data);
        };
        active.onstop = () => {
          const durationSeconds = Math.max(1, Math.round(((stoppedAt || now()) - startedAt) / 1000));
          const blob = new Blob(chunks, { type: active.mimeType || "audio/webm" });
          release();
          if (disposed) return;
          setPhase("idle");
          if (!blob.size) {
            options.onError(new Error("未采集到录音，请检查麦克风后重新录制。"));
            return;
          }
          options.onCapture({ ...context, blob, durationSeconds });
        };
        active.onerror = () => {
          release();
          if (active.state !== "inactive") active.stop();
          setPhase("idle");
          if (!disposed) options.onError(new Error("录音中断，请检查麦克风后重新录制。原有答案仍保留。"));
        };
        startedAt = now();
        stoppedAt = 0;
        active.start(1000);
        setPhase("recording");
      } catch (error) {
        release();
        setPhase("idle");
        if (!disposed) options.onError(error);
      }
    },
    stop() {
      if (phase !== "recording" || !recorder || recorder.state === "inactive") return;
      stoppedAt = now();
      setPhase("stopping");
      recorder.stop();
    },
    dispose() {
      disposed = true;
      const active = recorder;
      release();
      if (active && active.state !== "inactive") active.stop();
      phase = "idle";
    },
  };
}
