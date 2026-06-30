// Supported languages for the multilingual chat.
// `code` is the ISO 639-1 code stored in the database and sent to the AI.
export interface Language {
  code: string;
  name: string; // English name (used in AI prompts)
  native: string; // Native label shown in the UI
  flag: string; // Emoji flag for quick visual scanning
}

// "auto" lets the AI detect the language of whatever the user types.
export const AUTO_DETECT: Language = {
  code: "auto",
  name: "Auto-detect",
  native: "Auto-detect",
  flag: "🌐",
};

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English", flag: "🇬🇧" },
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "fr", name: "French", native: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "zh", name: "Chinese", native: "中文", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", native: "日本語", flag: "🇯🇵" },
  { code: "ar", name: "Arabic", native: "العربية", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", native: "हिन्दी", flag: "🇮🇳" },
  { code: "pt", name: "Portuguese", native: "Português", flag: "🇵🇹" },
  { code: "ru", name: "Russian", native: "Русский", flag: "🇷🇺" },
];

const ALL = [AUTO_DETECT, ...LANGUAGES];

/** Resolve a language code to its English name for AI prompts. */
export function languageName(code: string | null | undefined): string {
  if (!code) return "English";
  return ALL.find((l) => l.code === code)?.name ?? code;
}

/** Resolve a language code to a display object (for badges / labels). */
export function languageMeta(code: string | null | undefined): Language {
  if (!code) return LANGUAGES[0];
  return ALL.find((l) => l.code === code) ?? { code, name: code, native: code, flag: "🏳️" };
}

/** Languages that are valid as a "preferred response language" (excludes auto). */
export const PREFERRED_LANGUAGES = LANGUAGES;

/** RTL languages for correct text alignment. */
export const RTL_CODES = new Set(["ar", "he", "fa", "ur"]);
export function isRtl(code: string | null | undefined): boolean {
  return !!code && RTL_CODES.has(code);
}