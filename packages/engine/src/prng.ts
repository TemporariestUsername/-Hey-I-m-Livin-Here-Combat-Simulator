/** PCG32 with explicit unsigned 64-bit arithmetic for cross-platform vectors. */
export class Pcg32 {
  private state = 0n;
  private increment: bigint;
  private draws = 0;
  private static readonly MASK = (1n << 64n) - 1n;
  constructor(seed: number, stream = 0) {
    this.increment = ((BigInt(stream) << 1n) | 1n) & Pcg32.MASK;
    this.nextUint32();
    this.state = (this.state + BigInt(seed)) & Pcg32.MASK;
    this.nextUint32();
    this.draws = 0;
  }
  nextUint32(): number {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.increment) & Pcg32.MASK;
    this.draws += 1;
    const shifted = Number(((old >> 18n) ^ old) >> 27n) >>> 0;
    const rotation = Number(old >> 59n);
    return ((shifted >>> rotation) | (shifted << ((-rotation) & 31))) >>> 0;
  }
  nextFloat(): number { return this.nextUint32() / 0x1_0000_0000; }
  snapshot(): Pcg32Snapshot {
    return {
      state: this.state.toString(16).padStart(16, "0"),
      increment: this.increment.toString(16).padStart(16, "0"),
      draws: this.draws,
    };
  }
  static fromSnapshot(snapshot: Pcg32Snapshot): Pcg32 {
    if (!/^[a-f0-9]{16}$/u.test(snapshot.state) || !/^[a-f0-9]{15}[13579bdf]$/u.test(snapshot.increment) ||
        !Number.isSafeInteger(snapshot.draws) || snapshot.draws < 0 || snapshot.draws > 100_000_000) {
      throw new Error("invalid PCG32 snapshot");
    }
    const restored = new Pcg32(0);
    restored.state = BigInt(`0x${snapshot.state}`) & Pcg32.MASK;
    restored.increment = BigInt(`0x${snapshot.increment}`) & Pcg32.MASK;
    restored.draws = snapshot.draws;
    return restored;
  }
}

export interface Pcg32Snapshot { state: string; increment: string; draws: number }

const STREAMS = { sensing: 1, movement: 2, contact: 3, morale: 4, policy: 5 } as const;
export type StreamName = keyof typeof STREAMS;
export function namedStream(seed: number, name: StreamName): Pcg32 { return new Pcg32(seed, STREAMS[name]); }
export function initialStreamSnapshots(seed: number): Record<StreamName, Pcg32Snapshot> {
  return Object.fromEntries((Object.keys(STREAMS) as StreamName[]).map(name => [name, namedStream(seed, name).snapshot()])) as Record<StreamName, Pcg32Snapshot>;
}
