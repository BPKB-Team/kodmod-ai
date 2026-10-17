const targets = "[data-voice-menu],a,button,summary,input,select,textarea,[role=option],[role=button],[role=menuitem],[role=combobox],.lp-capability,.lp-access-chips > span,.lp-floating,details,.kodmod-dialog-title,.kodmod-dialog-body,.swal2-title,.swal2-html-container";
const fieldKeys = { username: "username", password: "password", full_name: "full-name", role: "role" };

export function attachMenuNarration({ document, speech, language, engine, pathname }) {
  if (engine === "off") return () => {};
  const dialogTarget = document.defaultView ?? document;
  let last = null, lastAt = 0;
  const closestMenu = node => {
    const voiced = node?.closest?.("[data-voice-menu]");
    if (voiced) return voiced;
    return node?.closest?.(targets) ?? node?.parentElement?.closest?.(targets);
  };
  const canPlay = () => !document.querySelector(".voice-panel[data-recording=true]");
  function narrate(event, hover = false) {
    if (hover && event.pointerType === "touch") return;
    const element = closestMenu(event.target);
    // NativeSelect owns the confirmation text. A document-level click label
    // would replace its queued "{option} dipilih" message.
    if (event.type === "click" && element?.matches?.("[role=option]")) return;
    if (hover && element?.contains(event.relatedTarget)) return;
    const activeModal = document.querySelector(".swal2-container.swal2-shown, dialog[open]");
    const insideModal = Boolean(activeModal && element?.closest?.(".swal2-container, dialog[open]"));
    if (activeModal && !insideModal) {
      speech.cancelQueuedMenu(); return;
    }
    if (!element || element.closest("[data-voice-ignore],[aria-hidden=true]")
      || element.matches?.(":disabled,[aria-disabled=true]") || !canPlay()) {
      speech.cancelQueuedMenu(); return;
    }
    const current = speech.getState();
    if (current.owner && current.owner !== "menu" && ["loading", "playing", "paused"].includes(current.status)) {
      speech.cancelQueuedMenu(); return;
    }
    const now = Date.now();
    if (last === element && now - lastAt < 600) return;
    const menuKey = element.dataset?.voiceMenu ?? fieldKeys[element.getAttribute?.("name") ?? ""];
    // Only labels are narrated. User-entered values never become speech requests.
    const label = element.getAttribute?.("aria-label") ?? element.labels?.[0]?.textContent ?? element.innerText ?? element.textContent;
    const text = label?.trim().replace(/\s+/g, " ").slice(0, 300);
    if (!text || (!menuKey && !insideModal && !/^\/(siswa|guru|admin)(\/|$)/.test(pathname))) {
      speech.cancelQueuedMenu(); return;
    }
    last = element; lastAt = now;
    speech.queueMenu({ owner: "menu", text, engine, language, menuKey }, canPlay, hover ? 300 : 150);
  }
  const focus = event => narrate(event);
  const hover = event => narrate(event, true);
  const leave = event => {
    const element = closestMenu(event.target);
    if (!element || element.contains(event.relatedTarget)) return;
    if (last === element) { speech.cancelQueuedMenu(); last = null; }
  };
  const onDialogAnnounce = event => {
    const text = event?.detail?.text?.trim();
    if (!text || !canPlay()) return;
    speech.play({ owner: "menu", text, engine, language });
  };
  dialogTarget.addEventListener("kodmod:dialog-announce", onDialogAnnounce);
  document.addEventListener("focusin", focus);
  document.addEventListener("click", focus);
  document.addEventListener("pointerover", hover);
  document.addEventListener("pointerout", leave);
  return () => {
    dialogTarget.removeEventListener("kodmod:dialog-announce", onDialogAnnounce);
    document.removeEventListener("focusin", focus);
    document.removeEventListener("click", focus);
    document.removeEventListener("pointerover", hover);
    document.removeEventListener("pointerout", leave);
    speech.stop("menu");
  };
}

export function announceLanguageChange(speech, language, { engine, enabled, recording = false }) {
  if (!enabled || recording || !["id", "en"].includes(language)) return Promise.resolve();
  return speech.play({ owner: "language", engine, language, menuKey: "language-changed",
    text: language === "en" ? "Language changed to English." : "Bahasa telah berubah ke Bahasa Indonesia." });
}

export function announcePageNavigation({
  document,
  speech,
  language,
  engine,
  enabled,
  previousPathname,
  pathname,
}) {
  if (previousPathname === pathname || !(pathname === "/siswa" || pathname.startsWith("/siswa/"))) return;
  const heading = document.querySelector("main h1") ?? document.querySelector("h1");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus();
  const text = heading.textContent?.trim().replace(/\s+/g, " ").slice(0, 300);
  if (enabled && engine !== "off" && text) {
    void speech.play({ owner: "menu", text, engine, language });
  }
}
