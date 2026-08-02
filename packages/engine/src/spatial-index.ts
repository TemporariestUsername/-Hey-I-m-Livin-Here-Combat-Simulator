import type { Point } from "../../schema/src/index.ts";

export interface SpatialItem {
  id: string;
  position: Point;
}

/** Deterministic uniform-grid index. Query results are always returned in stable identifier order. */
export class UniformGridIndex<T extends SpatialItem> {
  readonly cellSize: number;
  #cells = new Map<string, T[]>();
  #items: T[];
  #bounds: { minimumX: number; maximumX: number; minimumY: number; maximumY: number } | null;

  constructor(items: readonly T[], cellSize = 2) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError("cellSize must be positive and finite");
    this.cellSize = cellSize;
    this.#items = [...items].sort((left, right) => left.id.localeCompare(right.id));
    this.#bounds = this.#items.length === 0 ? null : {
      minimumX: Math.min(...this.#items.map(item => item.position.x)), maximumX: Math.max(...this.#items.map(item => item.position.x)),
      minimumY: Math.min(...this.#items.map(item => item.position.y)), maximumY: Math.max(...this.#items.map(item => item.position.y)),
    };
    for (const item of this.#items) {
      const key = this.#key(item.position);
      const cell = this.#cells.get(key) ?? [];
      cell.push(item);
      this.#cells.set(key, cell);
    }
  }

  #coordinate(value: number): number { return Math.floor(value / this.cellSize); }
  #key(point: Point): string { return `${this.#coordinate(point.x)},${this.#coordinate(point.y)}`; }

  queryRadius(center: Point, radius: number): T[] {
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError("query radius must be finite and non-negative");
    const minimumX = this.#coordinate(center.x - radius);
    const maximumX = this.#coordinate(center.x + radius);
    const minimumY = this.#coordinate(center.y - radius);
    const maximumY = this.#coordinate(center.y + radius);
    const radiusSquared = radius * radius;
    if (!this.#bounds) return [];
    const corners = [
      [this.#bounds.minimumX, this.#bounds.minimumY], [this.#bounds.minimumX, this.#bounds.maximumY],
      [this.#bounds.maximumX, this.#bounds.minimumY], [this.#bounds.maximumX, this.#bounds.maximumY],
    ];
    if (corners.every(([x, y]) => (x! - center.x) ** 2 + (y! - center.y) ** 2 <= radiusSquared + 1e-12)) {
      return [...this.#items];
    }
    const matches: T[] = [];
    for (let x = minimumX; x <= maximumX; x += 1) {
      for (let y = minimumY; y <= maximumY; y += 1) {
        for (const item of this.#cells.get(`${x},${y}`) ?? []) {
          const dx = item.position.x - center.x;
          const dy = item.position.y - center.y;
          if (dx * dx + dy * dy <= radiusSquared + 1e-12) matches.push(item);
        }
      }
    }
    return matches.sort((left, right) => left.id.localeCompare(right.id));
  }
}
