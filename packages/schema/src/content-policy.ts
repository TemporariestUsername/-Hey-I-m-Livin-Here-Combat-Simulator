export interface ContentFinding {
  path: string;
  category: "prohibited-field" | "active-markup" | "remote-resource" | "procedural-instruction" | "anatomical-harm" | "certification-claim";
  message: string;
}

const PROHIBITED_FIELD = /^(?:anatomy|anatomicaltarget|bodypart|targetbodypart|injurymechanism|technique|techniquesteps|proceduralsteps|instructions|realworldoptimization|weaponuse)$/;
const ACTIVE_MARKUP = /<\/?[a-z][^>]*>/i;
const REMOTE_RESOURCE = /\b(?:https?|ftp):\/\/|\bdata:text\/html\b/i;
const PROCEDURAL_TEXT = /(?:^|\n)\s*(?:step\s*\d+[.:)]?|[1-9]\d*[.)])\s+\S/i;
const ANATOMY = /\b(?:eye|throat|neck|head|groin|kidney|joint|spine)\b/i;
const HARM = /\b(?:attack|break|damage|disable|injure|stab|strike|target)\b/i;
const CERTIFICATION_CLAIM = /\b(?:legally correct|legal advice|safety certif(?:ied|ication)|guaranteed (?:effective|effectiveness|safe|safety)|predicts? (?:an |the )?(?:actual|real[- ]world) encounter)\b/i;

const normalizeKey = (key: string): string => key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

export function lintProhibitedContent(input: unknown): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const pending: Array<{ value: unknown; path: string; key?: string }> = [{ value: input, path: "$" }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.key && PROHIBITED_FIELD.test(normalizeKey(current.key))) {
      findings.push({ path: current.path, category: "prohibited-field", message: "field is prohibited by the safety abstraction policy" });
    }
    if (typeof current.value === "string") {
      if (ACTIVE_MARKUP.test(current.value)) findings.push({ path: current.path, category: "active-markup", message: "HTML or script-like markup is prohibited" });
      if (REMOTE_RESOURCE.test(current.value)) findings.push({ path: current.path, category: "remote-resource", message: "remote resources are prohibited in imported content" });
      if (PROCEDURAL_TEXT.test(current.value)) findings.push({ path: current.path, category: "procedural-instruction", message: "stepwise procedural instructions are prohibited" });
      if (ANATOMY.test(current.value) && HARM.test(current.value)) findings.push({ path: current.path, category: "anatomical-harm", message: "anatomy-specific harm content is prohibited" });
      if (CERTIFICATION_CLAIM.test(current.value)) findings.push({ path: current.path, category: "certification-claim", message: "legal, certification, guarantee, and real-encounter prediction claims are prohibited" });
    } else if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => pending.push({ value, path: `${current.path}[${index}]` }));
    } else if (current.value && typeof current.value === "object") {
      for (const [key, value] of Object.entries(current.value)) pending.push({ value, key, path: `${current.path}.${key}` });
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.category.localeCompare(b.category));
}
