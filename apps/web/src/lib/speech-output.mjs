const initialState = Object.freeze({ owner: null, status: "idle", fallback: false, message: "" });

export function createSpeechCoordinator({ loadAudio, makeAudio, speakDevice }) {
  let generation = 0, controller = null, output = null, state = initialState;
  let menuTimer, explicitMenuUntil = 0;
  const listeners = new Set();
  function publish(next) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  function release() {
    output?.stop();
    output?.dispose();
    output = null;
  }
  function stop(owner) {
    if (!owner || owner === "menu") cancelQueuedMenu();
    if (owner && state.owner !== owner) return;
    generation++;
    controller?.abort();
    controller = null;
    release();
    state = initialState;
    for (const listener of listeners) listener();
  }
  function cancelQueuedMenu() { clearTimeout(menuTimer); menuTimer = undefined; }
  function queueMenu(request, canPlay = () => true, delay = 150) {
    // Resizing or opening a popup can move another element under the pointer.
    // That passive hover must not replace the user's explicit choice.
    if (!request.interrupt && Date.now() < explicitMenuUntil) return;
    if (request.interrupt) explicitMenuUntil = Date.now() + 700;
    cancelQueuedMenu();
    menuTimer = setTimeout(() => {
      menuTimer = undefined;
      if (canPlay()) void play({ ...request, owner: "menu" });
    }, delay);
  }
  async function play(request) {
    if (request.owner === "menu" && !request.interrupt && state.owner && state.owner !== "menu"
      && ["loading", "playing", "paused"].includes(state.status)) return;
    stop();
    const ticket = generation;
    controller = new AbortController();
    const signal = controller.signal;
    let finished = false;
    publish({ owner: request.owner, status: "loading", fallback: false, message: "" });
    const ended = () => {
      if (ticket !== generation) return;
      finished = true;
      release();
      publish({ status: "idle" });
    };
    const current = () => ticket === generation && !signal.aborted;
    const failed = (error) => {
      if (!current()) return;
      finished = true;
      release();
      publish({ status: error?.name === "NotAllowedError" ? "blocked" : "error",
        message: error?.name === "NotAllowedError" ? "Tekan Dengarkan untuk mengaktifkan suara."
          : request.engine === "app"
            ? "Suara KODMOD belum tersedia. Coba lagi atau pilih suara perangkat."
            : "Suara perangkat belum tersedia. Kamu tetap bisa membaca teks." });
    };
    try {
      if (request.engine === "device") {
        output = speakDevice(request, ended, failed);
        await output.play();
      } else {
        const audio = await loadAudio(request, signal);
        if (!current()) return;
        output = makeAudio(audio, ended, failed);
        await output.play();
      }
      if (current() && !finished) publish({ status: "playing" });
    } catch (error) {
      if (!finished) failed(error);
    }
  }
  async function togglePause(owner) {
    if (owner && owner !== state.owner) return;
    if (state.status === "playing") {
      output?.pause();
      publish({ status: "paused" });
    } else if (state.status === "paused") {
      const ticket = generation;
      try {
        await output?.resume();
        if (ticket === generation) publish({ status: "playing" });
      } catch {
        if (ticket === generation) publish({ status: "blocked", message: "Tekan Dengarkan untuk mengaktifkan suara." });
      }
    }
  }
  return { play, stop, queueMenu, cancelQueuedMenu, togglePause, getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
