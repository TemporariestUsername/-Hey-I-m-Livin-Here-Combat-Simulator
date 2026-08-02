export const DEFAULT_IMPORT_LIMITS = Object.freeze({
  maxBytes: 1_048_576,
  maxDepth: 64,
});

export interface ImportLimits {
  maxBytes: number;
  maxDepth: number;
}

export function parseJsonDocument(text: string, limits: ImportLimits = DEFAULT_IMPORT_LIMITS): unknown {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > limits.maxBytes) throw new RangeError(`JSON input exceeds ${limits.maxBytes} bytes`);
  const parsed: unknown = JSON.parse(text);
  const pending: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 1 }];
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    if (depth > limits.maxDepth) throw new RangeError(`JSON input exceeds nesting depth ${limits.maxDepth}`);
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object") pending.push({ value: item, depth: depth + 1 });
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) if (item && typeof item === "object") pending.push({ value: item, depth: depth + 1 });
    }
  }
  return parsed;
}
