const UINT32_RANGE = 4294967296;

export function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Prng {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new RangeError('seed must be an integer');
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let mixed = this.state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  }

  next(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  int(limit: number): number {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('limit must be a positive integer');
    }
    return Math.floor(this.next() * limit);
  }

  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new RangeError('cannot pick from an empty list');
    return item;
  }

  fork(label: string): Prng {
    const mixed = Math.imul(this.seed ^ hashLabel(label), 0x9e3779b1) + 0x85ebca6b;
    return new Prng(mixed >>> 0);
  }
}
