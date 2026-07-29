export interface ContentLintResult { valid: boolean; errors: string[] }

const PROHIBITED_FIELDS = new Set([
  "anatomicaltarget",
  "anatomytarget",
  "targetanatomy",
  "techniquesteps",
  "harmoptimization",
  "realworldoptimization",
  "weaponconstruction",
]);

const normalize = (field: string): string => field.toLowerCase().replace(/[^a-z0-9]/g, "");
const unsafeText = (value: string): string | undefined => {
  if (/<\/?[a-z][^>]*>/i.test(value)) return "executable markup is prohibited by the content policy";
  if (/\b(?:https?:)?\/\//i.test(value)) return "remote asset references are prohibited by the content policy";
  return undefined;
};

/** Rejects reserved harmful-content structures at any depth before schema parsing. */
export function lintProhibitedContent(input: unknown): ContentLintResult {
  const errors: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === "string") {
      const reason = unsafeText(value);
      if (reason) errors.push(`${path || "value"}: ${reason}`);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [field, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${field}` : field;
      if (PROHIBITED_FIELDS.has(normalize(field))) errors.push(`${childPath} is prohibited by the content policy`);
      visit(child, childPath);
    }
  };
  visit(input, "");
  return { valid: errors.length === 0, errors };
}
