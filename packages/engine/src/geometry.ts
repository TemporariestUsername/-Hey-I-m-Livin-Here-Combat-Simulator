import type { Point, Rectangle } from "../../schema/src/index.ts";

const EPSILON = 1e-9;
const persisted = (value: number): number => Number(value.toFixed(6));

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Returns the smallest absolute difference between two headings, in degrees. */
export function angleDifference(a: number, b: number): number {
  const difference = ((a - b + 540) % 360) - 180;
  return Math.abs(difference);
}

export function bearing(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 360) % 360;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, point: Point): boolean {
  return Math.abs(orientation(a, b, point)) <= EPSILON &&
    point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON &&
    point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
}

function segmentIntersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
      ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function segmentIntersectsRectangle(start: Point, end: Point, rectangle: Rectangle): boolean {
  const left = rectangle.x;
  const right = rectangle.x + rectangle.width;
  const top = rectangle.y;
  const bottom = rectangle.y + rectangle.height;
  if ((start.x > left && start.x < right && start.y > top && start.y < bottom) ||
      (end.x > left && end.x < right && end.y > top && end.y < bottom)) return true;
  const corners = [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
  return corners.some((corner, index) => segmentIntersects(start, end, corner, corners[(index + 1) % corners.length]!));
}

export function hasLineOfSight(start: Point, end: Point, obstacles: readonly Rectangle[]): boolean {
  return !obstacles.some(obstacle => obstacle.blocksVision !== false && segmentIntersectsRectangle(start, end, obstacle));
}

export function isInsideMap(point: Point, map: { width: number; height: number }): boolean {
  return point.x >= 0 && point.x <= map.width && point.y >= 0 && point.y <= map.height;
}

/** Rejects a complete movement when its swept path crosses a blocking obstacle. */
export function resolveMovement(start: Point, proposed: Point, map: { width: number; height: number; obstacles?: Rectangle[] }): Point {
  const bounded = {
    x: persisted(Math.min(map.width, Math.max(0, proposed.x))),
    y: persisted(Math.min(map.height, Math.max(0, proposed.y))),
  };
  const blocked = (map.obstacles ?? []).some(obstacle => obstacle.blocksMovement !== false && segmentIntersectsRectangle(start, bounded, obstacle));
  return blocked ? { ...start } : bounded;
}
