/** Ad text checks before anything is sent to the platform (ad-creatives spec). */
export const AD_LIMITS = { title: 56, title2: 30, text: 81 } as const;

export interface CreativeIssue {
  code: "TOO_LONG" | "EMPTY" | "SUPERLATIVE" | "MEDICAL_PROMISE" | "GUARANTEE" | "CAPS" | "NO_FACT";
  message: string;
}

const SUPERLATIVES = /(^|[^а-яё])(лучш\p{L}*|самы[йеая]\p{L}*|№\s?1|номер\s+один|первы[йе]\s+в\s+городе|непревзойд\p{L}*)/iu;
const MEDICAL = /(вылечи\p{L}*|излечи\p{L}*|исцел\p{L}*|избавит\p{L}*\s+от\s+болезн\p{L}*|без\s+побочн\p{L}*)/iu;
const GUARANTEE = /(гарантир\p{L}*\s+результат\p{L}*|100\s?%\s+результат\p{L}*|результат\s+гарантир\p{L}*)/iu;
// `\b` is ASCII-only in JS, so word boundaries are written with Unicode lookarounds.
const CAPS_WORD = /(?<!\p{L})\p{Lu}{4,}(?!\p{L})/u;
const ALLOWED_ABBREVIATIONS = /(?<!\p{L})(СПА|SPA|МКАД)(?!\p{L})/gu;

/** Validates one ad. `facts` are card facts (prices, district, services, hours); at least one must appear. */
export const validateAdText = (ad: { title: string; text: string; title2?: string }, facts: readonly string[] = []): CreativeIssue[] => {
  const issues: CreativeIssue[] = [];
  const fields: [keyof typeof AD_LIMITS, string | undefined][] = [
    ["title", ad.title],
    ["title2", ad.title2],
    ["text", ad.text],
  ];
  for (const [field, value] of fields) {
    if (value === undefined) {
      continue;
    }
    if (value.trim() === "") {
      issues.push({ code: "EMPTY", message: `поле «${field}» пустое` });
    } else if (value.length > AD_LIMITS[field]) {
      issues.push({ code: "TOO_LONG", message: `поле «${field}» длиннее ${AD_LIMITS[field]} символов` });
    }
  }
  const all = [ad.title, ad.title2 ?? "", ad.text].join(" ");
  if (SUPERLATIVES.test(all)) {
    issues.push({ code: "SUPERLATIVE", message: "превосходная степень без подтверждения запрещена законом о рекламе" });
  }
  if (MEDICAL.test(all)) {
    issues.push({ code: "MEDICAL_PROMISE", message: "медицинские обещания запрещены" });
  }
  if (GUARANTEE.test(all)) {
    issues.push({ code: "GUARANTEE", message: "нельзя гарантировать результат" });
  }
  if (CAPS_WORD.test(all.replace(ALLOWED_ABBREVIATIONS, ""))) {
    issues.push({ code: "CAPS", message: "слова целиком заглавными буквами не пропустит модерация" });
  }
  const normalized = all.toLowerCase().replace(/[  ]/g, " ");
  if (facts.length > 0 && !facts.some((f) => normalized.includes(f.toLowerCase().replace(/[  ]/g, " ")))) {
    issues.push({ code: "NO_FACT", message: "в объявлении нет ни одного факта из карточки бизнеса" });
  }
  return issues;
};
