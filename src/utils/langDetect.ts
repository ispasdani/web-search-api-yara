import { franc } from "franc";

// ISO 639-3 → ISO 639-1 for the most common languages.
// franc returns 639-3; we convert to the shorter 639-1 codes stored in Convex.
const ISO3_TO_1: Record<string, string> = {
  eng: "en", fra: "fr", deu: "de", spa: "es", ita: "it",
  por: "pt", rus: "ru", zho: "zh", jpn: "ja", kor: "ko",
  ara: "ar", nld: "nl", pol: "pl", swe: "sv", dan: "da",
  fin: "fi", nor: "no", tur: "tr", heb: "he", hin: "hi",
  vie: "vi", tha: "th", ind: "id", ukr: "uk", ces: "cs",
  ron: "ro", hun: "hu", cat: "ca", hrv: "hr", slk: "sk",
};

export function detectLang(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < 10) return "en"; // too short to detect reliably

  const iso3 = franc(text.slice(0, 1500)); // only need a sample
  if (iso3 === "und") return "en";         // undetermined → default to en

  return ISO3_TO_1[iso3] ?? iso3.slice(0, 2);
}
