/**
 * NEA's PSI and PM2.5 bands and the matching health advisory, in English
 * and Chinese. Source: NEA haze information pages (24-hr PSI bands and the
 * 1-hr PM2.5 concentration bands used as an indicator for the coming hours).
 */

export type Lang = "en" | "zh";

export interface Band {
  key: "good" | "moderate" | "unhealthy" | "very_unhealthy" | "hazardous";
  label: string;
  range: string;
  /** Advisory for the general population */
  general: string;
  /** Advisory for the elderly, pregnant women and children */
  sensitive: string;
  /** Advisory for people with chronic lung or heart disease */
  chronic: string;
  /** NEA's note on N95 masks for this band, if any */
  mask?: string;
}

const PSI_BANDS: Record<Lang, Band[]> = {
  en: [
    { key: "good", label: "Good", range: "0–50", general: "Normal activities.", sensitive: "Normal activities.", chronic: "Normal activities." },
    { key: "moderate", label: "Moderate", range: "51–100", general: "Normal activities.", sensitive: "Normal activities.", chronic: "Normal activities." },
    {
      key: "unhealthy", label: "Unhealthy", range: "101–200",
      general: "Reduce prolonged or strenuous outdoor physical exertion.",
      sensitive: "Minimise prolonged or strenuous outdoor physical exertion.",
      chronic: "Avoid prolonged or strenuous outdoor physical exertion.",
    },
    {
      key: "very_unhealthy", label: "Very Unhealthy", range: "201–300",
      general: "Avoid prolonged or strenuous outdoor physical exertion.",
      sensitive: "Minimise outdoor activity.",
      chronic: "Avoid outdoor activity.",
    },
    {
      key: "hazardous", label: "Hazardous", range: "> 300",
      general: "Minimise outdoor activity.",
      sensitive: "Avoid outdoor activity.",
      chronic: "Avoid outdoor activity.",
      mask: "Anyone who must stay outdoors for several hours should wear an N95 mask.",
    },
  ],
  zh: [
    { key: "good", label: "良好", range: "0–50", general: "可正常活动。", sensitive: "可正常活动。", chronic: "可正常活动。" },
    { key: "moderate", label: "中等", range: "51–100", general: "可正常活动。", sensitive: "可正常活动。", chronic: "可正常活动。" },
    {
      key: "unhealthy", label: "不健康", range: "101–200",
      general: "减少长时间或剧烈的户外活动。",
      sensitive: "尽量减少长时间或剧烈的户外活动。",
      chronic: "避免长时间或剧烈的户外活动。",
    },
    {
      key: "very_unhealthy", label: "非常不健康", range: "201–300",
      general: "避免长时间或剧烈的户外活动。",
      sensitive: "尽量减少户外活动。",
      chronic: "避免户外活动。",
    },
    {
      key: "hazardous", label: "危险", range: "> 300",
      general: "尽量减少户外活动。",
      sensitive: "避免户外活动。",
      chronic: "避免户外活动。",
      mask: "需要在户外停留数小时的人应佩戴 N95 口罩。",
    },
  ],
};

export function psiBand(psi: number, lang: Lang = "en"): Band {
  const bands = PSI_BANDS[lang];
  if (psi <= 50) return bands[0];
  if (psi <= 100) return bands[1];
  if (psi <= 200) return bands[2];
  if (psi <= 300) return bands[3];
  return bands[4];
}

export interface Pm25Band {
  key: "normal" | "elevated" | "high" | "very_high";
  band: "I" | "II" | "III" | "IV";
  label: string;
  range: string;
}

const PM25_BANDS: Record<Lang, Pm25Band[]> = {
  en: [
    { key: "normal", band: "I", label: "Normal", range: "0–55 µg/m³" },
    { key: "elevated", band: "II", label: "Elevated", range: "56–150 µg/m³" },
    { key: "high", band: "III", label: "High", range: "151–250 µg/m³" },
    { key: "very_high", band: "IV", label: "Very High", range: "> 250 µg/m³" },
  ],
  zh: [
    { key: "normal", band: "I", label: "正常", range: "0–55 µg/m³" },
    { key: "elevated", band: "II", label: "偏高", range: "56–150 µg/m³" },
    { key: "high", band: "III", label: "高", range: "151–250 µg/m³" },
    { key: "very_high", band: "IV", label: "非常高", range: "> 250 µg/m³" },
  ],
};

export function pm25Band(ugm3: number, lang: Lang = "en"): Pm25Band {
  const bands = PM25_BANDS[lang];
  if (ugm3 <= 55) return bands[0];
  if (ugm3 <= 150) return bands[1];
  if (ugm3 <= 250) return bands[2];
  return bands[3];
}

/** Does a forecast string from NEA describe rain? */
export function isRainy(forecastText: string | undefined): boolean {
  return /rain|shower|thunder/i.test(forecastText ?? "");
}
