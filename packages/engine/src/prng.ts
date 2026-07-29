/** PCG32 with explicit unsigned 64-bit arithmetic for cross-platform vectors. */
export class Pcg32 {
  private state = 0n;
  private readonly increment: bigint;
  private static readonly MASK = (1n << 64n) - 1n;
  constructor(seed: number, stream = 0) {
    this.increment = ((BigInt(stream) << 1n) | 1n) & Pcg32.MASK;
    this.nextUint32();
    this.state = (this.state + BigInt(seed)) & Pcg32.MASK;
    this.nextUint32();
  }
  nextUint32(): number {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.increment) & Pcg32.MASK;
    const shifted = Number(((old >> 18n) ^ old) >> 27n) >>> 0;
    const rotation = Number(old >> 59n);
    return ((shifted >>> rotation) | (shifted << ((-rotation) & 31))) >>> 0;
  }
  nextFloat(): number { return this.nextUint32() / 0x1_0000_0000; }
}

const STREAMS = { sensing: 1, movement: 2, contact: 3, morale: 4, policy: 5 } as const;
export type StreamName = keyof typeof STREAMS;
export function namedStream(seed: number, name: StreamName): Pcg32 { return new Pcg32(seed, STREAMS[name]); }
