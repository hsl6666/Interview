import test from "node:test";
import assert from "node:assert/strict";
import { createOralRecorder } from "../src/features/interview/recording/oralRecorder.ts";

function setup(permission) {
  const states = [],
    captures = [],
    errors = [];
  let stopped = 0,
    starts = 0,
    now = 1000;
  const track = {
    stop() {
      stopped++;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const stream = { getTracks: () => [track] };
  const recorder = {
    state: "inactive",
    mimeType: "audio/webm",
    ondataavailable: null,
    onstop: null,
    onerror: null,
    start() {
      starts++;
      this.state = "recording";
    },
    stop() {
      this.state = "inactive";
    },
  };
  const engine = createOralRecorder({
    getStream: () => (permission ? permission(stream) : Promise.resolve(stream)),
    makeRecorder: () => recorder,
    now: () => now,
    onState: (state) => states.push(state),
    onCapture: (value) => captures.push(value),
    onError: (error) => errors.push(error),
  });
  return {
    engine,
    recorder,
    states,
    captures,
    errors,
    stream,
    setNow: (value) => {
      now = value;
    },
    stopped: () => stopped,
    starts: () => starts,
  };
}

test("permission pending is locked; stop captures the original question once with accurate duration", async () => {
  let allow;
  const x = setup(
    (stream) =>
      new Promise((resolve) => {
        allow = () => resolve(stream);
      }),
  );
  const pending = x.engine.start({ questionIndex: 2, questionText: "第三题" });
  assert.equal(x.engine.state, "requesting");
  await x.engine.start({ questionIndex: 5, questionText: "第六题" });
  allow();
  await pending;
  assert.equal(x.starts(), 1);
  x.recorder.ondataavailable({ data: new Blob(["answer"]) });
  x.setNow(6500);
  x.engine.stop();
  x.engine.stop();
  assert.equal(x.engine.state, "stopping");
  x.setNow(9900);
  x.recorder.onstop();
  assert.equal(x.captures.length, 1);
  assert.equal(x.captures[0].questionIndex, 2);
  assert.equal(x.captures[0].durationSeconds, 6);
  assert.equal(x.captures[0].blob.size, 6);
  assert.equal(x.engine.state, "idle");
  assert.equal(x.stopped(), 1);
});

test("leaving while permission is pending releases the eventual stream without starting or saving", async () => {
  let allow;
  const x = setup(
    (stream) =>
      new Promise((resolve) => {
        allow = () => resolve(stream);
      }),
  );
  const pending = x.engine.start({ questionIndex: 0, questionText: "第一题" });
  x.engine.dispose();
  allow();
  await pending;
  assert.equal(x.starts(), 0);
  assert.equal(x.stopped(), 1);
  assert.equal(x.captures.length, 0);
  assert.deepEqual(x.states, ["requesting"]);
});

test("leaving during recording stops capture without uploading a partial answer", async () => {
  const x = setup();
  await x.engine.start({ questionIndex: 0, questionText: "第一题" });
  x.recorder.ondataavailable({ data: new Blob(["partial"]) });
  x.engine.dispose();
  x.engine.dispose();
  assert.equal(x.recorder.state, "inactive");
  assert.equal(x.recorder.onstop, null);
  assert.equal(x.stopped(), 1);
  assert.equal(x.captures.length, 0);
});

test("permission denial restores idle and a later attempt succeeds", async () => {
  let denied = true;
  const x = setup((stream) =>
    denied ? Promise.reject(new DOMException("Denied", "NotAllowedError")) : Promise.resolve(stream),
  );
  await x.engine.start({ questionIndex: 0, questionText: "第一题" });
  assert.equal(x.engine.state, "idle");
  assert.equal(x.errors[0].name, "NotAllowedError");
  denied = false;
  await x.engine.start({ questionIndex: 1, questionText: "第二题" });
  assert.equal(x.engine.state, "recording");
  assert.equal(x.starts(), 1);
  x.engine.dispose();
});

test("empty recording reports failure without replacing a saved answer", async () => {
  const x = setup();
  await x.engine.start({ questionIndex: 0, questionText: "第一题" });
  x.engine.stop();
  x.recorder.onstop();
  assert.equal(x.captures.length, 0);
  assert.match(x.errors[0].message, /未采集到录音/);
  assert.equal(x.engine.state, "idle");
  assert.equal(x.stopped(), 1);
});

test("recorder failure releases the microphone and permits a fresh attempt", async () => {
  const x = setup();
  await x.engine.start({ questionIndex: 0, questionText: "第一题" });
  x.recorder.ondataavailable({ data: new Blob(["broken"]) });
  x.recorder.onerror();
  assert.equal(x.captures.length, 0);
  assert.equal(x.engine.state, "idle");
  assert.equal(x.stopped(), 1);
  assert.equal(x.errors.length, 1);
  await x.engine.start({ questionIndex: 1, questionText: "第二题" });
  x.recorder.ondataavailable({ data: new Blob(["fresh"]) });
  x.engine.stop();
  x.recorder.onstop();
  assert.equal(await x.captures[0].blob.text(), "fresh");
  assert.equal(x.captures[0].questionIndex, 1);
});
