import type { Point } from "../../schema/src/index.ts";

export const PERSISTED_DECIMAL_PLACES = 6;
const SCALE = 10 ** PERSISTED_DECIMAL_PLACES;

/**
 * Normalizes every finite derived number before it enters persisted state or an
 * event payload. Integers remain integers and negative zero is canonicalized.
 */
export function persistedNumber(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("persisted numbers must be finite");
  const rounded = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * SCALE) / SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function persistedPoint(point: Readonly<Point>): Point {
  return { x: persistedNumber(point.x), y: persistedNumber(point.y) };
}

export function persistedValue<T>(value: T): T {
  if (typeof value === "number") return persistedNumber(value) as T;
  if (Array.isArray(value)) return value.map(item => persistedValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, persistedValue(item)]),
    ) as T;
  }
  return value;
}
