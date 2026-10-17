import { translate } from "./i18n.mjs";

export function studyTimeLabel(value, language = "id") {
  const numericMinutes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (numericMinutes > 0 && numericMinutes < 0.5) return language === "en" ? "< 1 min" : "< 1 menit";
  const total = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return translate("{minutes} menit", language, { minutes });
  return minutes
    ? translate("{hours} jam {minutes} mnt", language, { hours, minutes })
    : translate("{hours} jam", language, { hours });
}

export function masteryLabel(value, language = "id") {
  const label = value >= 0.8 ? "Mantap"
    : value >= 0.6 ? "Berkembang"
    : value >= 0.4 ? "Perlu penguatan" : "Mulai dari dasar";
  return translate(label, language);
}

export function analyticsWindowLabel(window, language = "id") {
  const labels = { today: "Hari ini", week: "7 hari", month: "30 hari", all: "Semua waktu" };
  return translate(labels[window] || labels.week, language);
}
