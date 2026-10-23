import "server-only";
import { cookies } from "next/headers";
import { DISPLAY_COOKIE, VOICE_SETTINGS_COOKIE, parseDisplaySettings, parseVoiceSettings } from "./speech-preferences.mjs";
export async function serverVoiceSettings() {
  try { return parseVoiceSettings(decodeURIComponent((await cookies()).get(VOICE_SETTINGS_COOKIE)?.value ?? "")); }
  catch { return null; }
}
export async function serverDisplaySettings() {
  try { return parseDisplaySettings(JSON.parse(decodeURIComponent((await cookies()).get(DISPLAY_COOKIE)?.value ?? "{}"))); }
  catch { return parseDisplaySettings(); }
}
