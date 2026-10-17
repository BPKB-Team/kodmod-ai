import assert from "node:assert/strict";
import test from "node:test";
import { createSpeechCoordinator } from "../src/lib/speech-output.mjs";

function setup(loadAudio) {
  const played = [], stopped = [];
  const coordinator = createSpeechCoordinator({ loadAudio, makeAudio: (blob) => ({
    play: async () => played.push(blob), pause() {}, resume() {},
    stop: () => stopped.push(blob), dispose() {},
  }), speakDevice: () => { throw new Error("Unavailable"); } });
  return { coordinator, played, stopped };
}

test("stop rejects playback that arrives after an outstanding request", async () => {
  let resolve;
  const { coordinator, played } = setup(() => new Promise(r => { resolve = r; }));
  const request = coordinator.play({ owner: "a", text: "First", engine: "app", language: "id" });
  coordinator.stop();
  resolve("first");
  await request;
  assert.deepEqual(played, []);
  assert.equal(coordinator.getState().status, "idle");
});

test("new output interrupts previous output and old owners cannot stop new output", async () => {
  const { coordinator, played, stopped } = setup(async request => request.text);
  await coordinator.play({ owner: "a", text: "First", engine: "app", language: "id" });
  await coordinator.play({ owner: "b", text: "Second", engine: "app", language: "en" });
  coordinator.stop("a");
  assert.deepEqual(played, ["First", "Second"]);
  assert.deepEqual(stopped, ["First"]);
  assert.equal(coordinator.getState().owner, "b");
});

test("autoplay rejection settles in a state with replay available", async () => {
  const coordinator = createSpeechCoordinator({ loadAudio: async () => "audio", makeAudio: () => ({
    play: async () => { throw Object.assign(new Error("blocked"), { name: "NotAllowedError" }); },
    stop() {}, dispose() {}, pause() {}, resume() {},
  }), speakDevice() { throw new Error("Unavailable"); } });
  await coordinator.play({ owner: "tutor", text: "Answer", language: "id", engine: "app" });
  assert.equal(coordinator.getState().status, "blocked");
});

test("KODMOD request failures never switch to local device speech", async () => {
  let deviceCalls = 0;
  const coordinator = createSpeechCoordinator({
    loadAudio: async () => { throw new Error("KODMOD unavailable"); },
    makeAudio: () => { throw new Error("audio should not be created"); },
    speakDevice: () => { deviceCalls++; return { play: async () => {}, stop() {}, dispose() {} }; },
  });

  await coordinator.play({ owner: "tutor", text: "Answer", language: "id", engine: "app" });

  assert.equal(deviceCalls, 0);
  assert.equal(coordinator.getState().status, "error");
  assert.equal(coordinator.getState().fallback, false);
  assert.match(coordinator.getState().message, /KODMOD/);
});

test("KODMOD playback failures never switch to local device speech", async () => {
  let deviceCalls = 0;
  const coordinator = createSpeechCoordinator({
    loadAudio: async () => "audio",
    makeAudio: () => ({ play: async () => { throw new Error("audio output unavailable"); }, stop() {}, dispose() {} }),
    speakDevice: () => { deviceCalls++; return { play: async () => {}, stop() {}, dispose() {} }; },
  });

  await coordinator.play({ owner: "tutor", text: "Answer", language: "id", engine: "app" });

  assert.equal(deviceCalls, 0);
  assert.equal(coordinator.getState().status, "error");
  assert.equal(coordinator.getState().fallback, false);
});

test("audio that finishes before its start promise resolves remains finished", async () => {
  const coordinator = createSpeechCoordinator({ loadAudio: async () => "audio", makeAudio: (_blob, ended) => ({
    play: async () => ended(), stop() {}, dispose() {}, pause() {}, resume() {},
  }), speakDevice() { throw new Error("Unavailable"); } });
  await coordinator.play({ owner: "guide", text: "Short guide", language: "id", engine: "app" });
  assert.equal(coordinator.getState().status, "idle");
});

test("an output error after playback starts releases the audio and offers text", async () => {
  let fail, stopped = false;
  const coordinator = createSpeechCoordinator({ loadAudio: async () => "audio", makeAudio: (_blob, _ended, failed) => {
    fail = failed;
    return { play: async () => {}, stop() { stopped = true; }, dispose() {}, pause() {}, resume() {} };
  }, speakDevice() { throw new Error("Unavailable"); } });
  await coordinator.play({ owner: "tutor", text: "Answer", language: "en", engine: "app" });
  fail(new Error("Audio device disconnected"));
  assert.equal(coordinator.getState().status, "error");
  assert.equal(stopped, true);
  assert.match(coordinator.getState().message, /KODMOD/);
});

test("local device speech runs only when the device engine is selected", async () => {
  let deviceCalls = 0, apiCalls = 0;
  const coordinator = createSpeechCoordinator({
    loadAudio: async () => { apiCalls++; return "audio"; },
    makeAudio: () => ({ play: async () => {}, stop() {}, dispose() {} }),
    speakDevice: () => { deviceCalls++; return { play: async () => {}, stop() {}, dispose() {} }; },
  });

  await coordinator.play({ owner: "tutor", text: "Answer", language: "id", engine: "device" });

  assert.equal(deviceCalls, 1);
  assert.equal(apiCalls, 0);
  assert.equal(coordinator.getState().status, "playing");
});

test("delayed menu reading cannot replace a loading, playing or paused Tutor or preview", async () => {
  for (const owner of ["tutor", "voice-setup"]) {
    let resolve;
    const { coordinator, played } = setup(request => new Promise(r => { resolve = () => r(request.text); }));
    const started = coordinator.play({ owner, text: "Answer", language: "id", engine: "app" });
    const complete = resolve;
    const late = coordinator.play({ owner: "menu", text: "Late menu", language: "id", engine: "app" });
    assert.equal(coordinator.getState().owner, owner);
    await late;
    complete(); await started;
    await coordinator.play({ owner: "menu", text: "Late menu", language: "id", engine: "app" });
    assert.equal(coordinator.getState().owner, owner);
    await coordinator.togglePause(owner);
    await coordinator.play({ owner: "menu", text: "Late menu", language: "id", engine: "app" });
    assert.equal(coordinator.getState().status, "paused");
    assert.deepEqual(played, ["Answer"]);
  }
});

test("global stop or a new Tutor cancels queued menu reading; recording is checked at playback time", async () => {
  const { coordinator, played } = setup(async request => request.text);
  const menu = { owner: "menu", text: "Menu", language: "id", engine: "app" };
  coordinator.queueMenu(menu, () => true, 10);
  coordinator.stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(played, []);
  coordinator.queueMenu(menu, () => true, 10);
  await coordinator.play({ ...menu, owner: "tutor", text: "Answer" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(played, ["Answer"]);
  coordinator.stop();
  coordinator.queueMenu(menu, () => false, 10);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(played, ["Answer"]);
});
