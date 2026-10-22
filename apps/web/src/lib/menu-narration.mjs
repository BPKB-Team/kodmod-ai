const targets = "[data-voice-menu],a,button,summary,input,select,textarea,[role=option],[role=button],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=radio],[role=checkbox],[role=switch],[role=tab],[role=combobox],.lp-capability,.lp-access-chips > span,.lp-floating,.kodmod-dialog-title,.kodmod-dialog-body,.swal2-title,.swal2-html-container";
const fieldKeys = { username: "username", password: "password", full_name: "full-name", role: "role" };
const publicLinks = { "/": "home", "/masuk": "login", "/daftar": "register" };
const publicLabels = { Masuk: "login", "Sign in": "login", "Buat akun": "register", "Create account": "register", "Create an account": "register", "Kembali ke beranda": "back-home", "Back to home": "back-home" };
const modalSelector = "dialog[open],[role=dialog][aria-modal=true],[role=alertdialog]";
const liveSelector = '[role=alert],[role=status],[aria-live=polite],[aria-live=assertive]';
const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
function visibleText(element, fieldLabel = false) {
  if (!element) return "";
  const copy = element.cloneNode?.(true);
  if (!copy) return clean(element.innerText ?? element.textContent);
  copy.querySelectorAll?.('[aria-hidden=true],[hidden],script,style' + (fieldLabel ? ',input,select,textarea,button,[role=listbox]' : '')).forEach(node => node.remove());
  copy.querySelectorAll?.("span,strong,small").forEach(node => { node.prepend(" "); node.append(" "); });
  return clean(copy.textContent);
}
function referencedText(element, attribute, document) {
  return clean((element.getAttribute?.(attribute) ?? "").split(/\s+/).map(id => visibleText(document.getElementById?.(id))).join(" "));
}
function controlText(element, document, language) {
  const en = language === "en";
  const role = element.getAttribute?.("role"), type = element.getAttribute?.("type");
  const isRadio = type === "radio" || role === "radio";
  const rawAria = element.getAttribute?.("aria-label");
  const rawLabel = referencedText(element, "aria-labelledby", document) || rawAria
    || Array.from(element.labels ?? []).map(label => visibleText(label, true)).filter(Boolean).join(" ")
    || visibleText(element) || element.getAttribute?.("title") || element.getAttribute?.("placeholder");

  const checked = element.getAttribute?.("aria-checked") ?? (["radio", "checkbox"].includes(type) ? String(element.checked) : null);

  if (isRadio && checked !== null && checked !== undefined) {
    const quizOption = element.closest?.(".quiz-option, .quiz-options");
    const keyEl = quizOption?.querySelector?.(".quiz-option-key");
    const key = keyEl ? clean(keyEl.textContent) : null;
    let letter = key;
    let optionBody = "";

    const ariaMatch = (rawAria || "").match(/^(?:Pilihan|Option)\s+([A-Za-z0-9])(?:[:,]|\s+)(.*)$/i);
    const textMatch = clean(rawLabel).match(/^([A-Za-z0-9])[\.\)]\s+(.*)$/);

    if (ariaMatch) {
      letter = ariaMatch[1].toUpperCase();
      optionBody = clean(ariaMatch[2]);
    } else if (textMatch) {
      letter = textMatch[1].toUpperCase();
      optionBody = clean(textMatch[2]);
    } else if (key) {
      letter = key.toUpperCase();
      const bodyRegex = new RegExp(`^${key}\\s+`, "i");
      optionBody = clean(clean(rawLabel).replace(bodyRegex, ""));
    }

    if (letter && optionBody) {
      optionBody = optionBody.replace(/[.,;:]+$/, "").trim();
      const prefix = en ? `Option ${letter}` : `Pilihan ${letter}`;
      if (checked === "true") {
        return `${prefix}, ${optionBody} ${en ? "selected" : "dipilih"}.`;
      } else {
        return `${prefix}, ${optionBody}. ${en ? "Not selected" : "Belum dipilih"}.`;
      }
    }
  }

  const parts = [clean(rawLabel)];
  if (element.matches?.("select")) {
    const option = visibleText(element.options?.[element.selectedIndex]);
    if (option) parts.push(`${en ? "Current selection" : "Pilihan saat ini"}: ${option}`);
  } else if (role === "combobox") {
    const option = visibleText(element.querySelector?.(".kodmod-select-value"));
    if (option) parts.push(`${en ? "Current selection" : "Pilihan saat ini"}: ${option}`);
  }
  if (checked !== null && checked !== undefined) {
    if (checked === "mixed") parts.push(en ? "Partially checked" : "Dicentang sebagian");
    else if (role === "switch") parts.push(checked === "true" ? (en ? "On" : "Aktif") : (en ? "Off" : "Mati"));
    else if (type === "checkbox" || role === "checkbox" || role === "menuitemcheckbox") parts.push(checked === "true" ? (en ? "Checked" : "Dicentang") : (en ? "Not checked" : "Tidak dicentang"));
    else parts.push(checked === "true" ? (en ? "Selected" : "Dipilih") : (en ? "Not selected" : "Belum dipilih"));
  }
  const pressed = element.getAttribute?.("aria-pressed");
  if (pressed === "true" || pressed === "false") parts.push(pressed === "true" ? (en ? "On" : "Aktif") : (en ? "Off" : "Mati"));
  const selected = element.getAttribute?.("aria-selected");
  if (selected === "true" || selected === "false") parts.push(selected === "true" ? (en ? "Selected" : "Dipilih") : (en ? "Not selected" : "Belum dipilih"));
  const expanded = element.getAttribute?.("aria-expanded");
  if (expanded === "true" || expanded === "false") parts.push(expanded === "true" ? (en ? "Expanded" : "Dibuka") : (en ? "Collapsed" : "Ditutup"));
  return parts.filter(Boolean).join(". ").slice(0, 600);
}

export function attachMenuNarration({ document, speech, language, engine, pathname }) {
  if (engine === "off") return () => {};
  const dialogTarget = document.defaultView ?? document;
  const signedInArea = /^\/(siswa|guru|admin)(\/|$)/.test(pathname);
  let last = null, lastText = "", lastAt = 0, lastWasHover = false, focusGuardUntil = 0;
  const closestMenu = node => node?.closest?.(targets) ?? node?.parentElement?.closest?.(targets);
  const canPlay = () => !document.querySelector(".voice-panel[data-recording=true]");
  const ignored = element => !element || element.closest?.("[data-voice-ignore],[aria-hidden=true],[hidden],dialog:not([open])")
    || element.matches?.(":disabled,[aria-disabled=true]");
  function narrate(event, hover = false) {
    if (hover && event.pointerType === "touch") return;
    const element = closestMenu(event.target);
    const cancel = () => { if (!hover || lastWasHover) speech.cancelQueuedMenu(); };
    // Custom selects own opening, highlight and selection announcements.
    if (event.type !== "focusin" && element?.closest?.("[data-voice-managed]")) { last = null; lastWasHover = false; return; }
    if (event.type === "focusin" && element?.hasAttribute?.("data-voice-silent-focus")) return;
    if (event.type === "click" && (element?.matches?.("[role=option]") || element?.matches?.("input[type=radio],input[type=checkbox],select"))) return;
    if (event.type === "focusin" && element?.closest?.("[data-voice-managed]") && element.getAttribute?.("aria-expanded") === "true") return;
    if (event.type === "change" && !element?.matches?.("select,input[type=radio],input[type=checkbox],input[type=range]")) return;
    if (hover && element?.contains(event.relatedTarget)) return;
    const activeModal = document.querySelector(".swal2-container.swal2-shown, " + modalSelector);
    const insideModal = Boolean(activeModal && (activeModal.contains?.(element) ?? element?.closest?.(".swal2-container, dialog[open]")));
    if (activeModal && !insideModal) { cancel(); return; }
    if (ignored(element) || !canPlay()) { cancel(); return; }
    if ((event.type === "focusin" || hover) && Date.now() < focusGuardUntil) return;
    const interrupt = !hover && (event.type === "change" || insideModal
      || element.matches?.("input[type=radio],input[type=checkbox],[role=option],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[aria-pressed],[aria-expanded]"));
    const current = speech.getState();
    if (!interrupt && current.owner && current.owner !== "menu" && ["loading", "playing", "paused"].includes(current.status)) {
      cancel(); return;
    }
    const menuKey = element.dataset?.voiceMenu ?? fieldKeys[element.getAttribute?.("name") ?? ""]
      ?? publicLinks[element.getAttribute?.("href")] ?? publicLabels[visibleText(element)];
    // Only labels and controlled option state are narrated. Typed values are never sent to speech.
    let text = controlText(element, document, language);
    if (event.type === "change" && element.matches?.("select")) text = `${visibleText(element.options?.[element.selectedIndex])} ${language === "en" ? "selected" : "dipilih"}.`;
    if (!text || (!menuKey && !insideModal && !signedInArea)) { cancel(); return; }
    const now = Date.now();
    if (last === element && lastText === text && now - lastAt < 600 && (hover || !lastWasHover)) return;
    last = element; lastText = text; lastAt = now; lastWasHover = hover;
    speech.queueMenu({ owner: "menu", text, engine, language, menuKey, interrupt: Boolean(interrupt) }, canPlay, hover ? 300 : 150);
  }
  const focus = event => narrate(event);
  const click = event => {
    const element = closestMenu(event.target);
    if (element?.hasAttribute?.("aria-checked") || element?.hasAttribute?.("aria-pressed") || element?.hasAttribute?.("aria-selected") || element?.hasAttribute?.("aria-expanded")) queueMicrotask(() => narrate(event));
    else narrate(event);
  };
  const hover = event => narrate(event, true);
  const leave = event => {
    const element = closestMenu(event.target);
    if (!element || element.contains(event.relatedTarget)) return;
    if (last === element && lastWasHover) { speech.cancelQueuedMenu(); last = null; }
  };
  const releaseFocusGuard = () => { focusGuardUntil = 0; };
  const onDialogAnnounce = event => {
    const text = clean(event?.detail?.text);
    if (!text || !canPlay()) return;
    focusGuardUntil = Date.now() + 350;
    void speech.play({ owner: "menu", text, engine, language, menuKey: event.detail.menuKey, interrupt: true });
  };
  const modalOpen = new WeakSet();
  const liveText = new WeakMap();
  document.querySelectorAll?.(liveSelector).forEach(node => liveText.set(node, visibleText(node)));
  function announceModal(element) {
    if (modalOpen.has(element) || ignored(element) || element.matches?.(".swal2-popup,[data-voice-dialog-managed]")) return;
    modalOpen.add(element);
    const title = referencedText(element, "aria-labelledby", document) || element.getAttribute("aria-label") || visibleText(element.querySelector("h1,h2,h3"));
    const description = referencedText(element, "aria-describedby", document);
    const actions = [...element.querySelectorAll("button:not(:disabled)")].filter(node => !ignored(node)).map(node => controlText(node, document, language));
    onDialogAnnounce({ detail: { text: [title, description, ...actions].filter(Boolean).join(". ").slice(0, 1500), menuKey: element.dataset.voiceDialog } });
  }
  const Observer = document.defaultView?.MutationObserver;
  const observer = Observer && document.body ? new Observer(records => {
    const statuses = new Set();
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (node?.matches?.("dialog") && !node.open) modalOpen.delete(node);
      if (node?.matches?.(modalSelector)) announceModal(node);
      node?.querySelectorAll?.(modalSelector).forEach(announceModal);
      const live = node?.closest?.(liveSelector);
      if (live) statuses.add(live);
      node?.querySelectorAll?.(liveSelector).forEach(item => statuses.add(item));
    }
    for (const element of statuses) {
      if (ignored(element) || !canPlay() || element.closest("[role=log],[data-voice-player]")) continue;
      const text = visibleText(element).slice(0, 600), previous = liveText.get(element);
      liveText.set(element, text);
      if (!text || text === previous) continue;
      const urgent = element.getAttribute("role") === "alert" || element.getAttribute("aria-live") === "assertive";
      const current = speech.getState();
      if (!urgent && (Date.now() - lastAt < 600 || ["loading", "playing", "paused"].includes(current.status))) continue;
      if (document.querySelector(".swal2-container.swal2-shown, " + modalSelector)) continue;
      if (!signedInArea && !element.dataset.voiceMenu) continue;
      speech.queueMenu({ owner: "menu", text, engine, language, menuKey: element.dataset.voiceMenu, interrupt: urgent }, canPlay, 150);
    }
  }) : null;
  observer?.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open", "aria-hidden"] });
  dialogTarget.addEventListener("kodmod:dialog-announce", onDialogAnnounce);
  document.addEventListener("focusin", focus);
  document.addEventListener("click", click);
  document.addEventListener("change", focus);
  document.addEventListener("pointerover", hover);
  document.addEventListener("pointerout", leave);
  document.addEventListener("keydown", releaseFocusGuard);
  document.addEventListener("pointerdown", releaseFocusGuard);
  return () => {
    observer?.disconnect();
    dialogTarget.removeEventListener("kodmod:dialog-announce", onDialogAnnounce);
    document.removeEventListener("focusin", focus);
    document.removeEventListener("click", click);
    document.removeEventListener("change", focus);
    document.removeEventListener("pointerover", hover);
    document.removeEventListener("pointerout", leave);
    document.removeEventListener("keydown", releaseFocusGuard);
    document.removeEventListener("pointerdown", releaseFocusGuard);
    speech.stop("menu");
  };
}

export function announceLanguageChange(speech, language, { engine, enabled, recording = false }) {
  if (!enabled || recording || !["id", "en"].includes(language)) return Promise.resolve();
  return speech.play({ owner: "language", engine, language, menuKey: "language-changed",
    text: language === "en" ? "Language changed to English." : "Bahasa telah berubah ke Bahasa Indonesia." });
}

export function announcePageNavigation({ document, speech, language, engine, enabled, previousPathname, pathname }) {
  if (previousPathname === pathname || !/^\/(siswa|guru|admin|masuk|daftar)(\/|$)/.test(pathname)) return;
  const view = document.defaultView;
  let observer, timer, focusFrame;
  const cleanup = () => {
    observer?.disconnect(); clearTimeout(timer);
    if (focusFrame !== undefined) view?.cancelAnimationFrame(focusFrame);
  };
  const announce = () => {
    const heading = document.querySelector("main h1") ?? document.querySelector("h1");
    if (!heading) return false;
    cleanup();
    heading.setAttribute("tabindex", "-1"); heading.focus();
    if (view?.requestAnimationFrame) {
      focusFrame = view.requestAnimationFrame(() => {
        focusFrame = view.requestAnimationFrame(() => {
          if (heading.isConnected && document.activeElement === document.body) heading.focus({ preventScroll: true });
        });
      });
    }
    const text = clean(heading.textContent).slice(0, 300);
    const menuKey = pathname === "/masuk" ? "login" : pathname === "/daftar" ? "register" : undefined;
    if (enabled && engine !== "off" && text) void speech.play({ owner: "menu", text, engine, language, menuKey });
    return true;
  };
  if (!announce() && document.defaultView?.MutationObserver) {
    observer = new document.defaultView.MutationObserver(announce);
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(cleanup, 5000);
  }
  return cleanup;
}
