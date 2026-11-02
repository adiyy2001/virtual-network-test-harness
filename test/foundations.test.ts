import { describe, expect, it } from 'vitest';
import { Prng } from '../src/prng.ts';
import {
  formatFailure,
  replayCase,
  runProperty,
  type Property,
} from '../src/property.ts';
import { VirtualClock, VirtualClockOverflowError } from '../src/virtual-clock.ts';

function draw(random: Prng, count: number): number[] {
  return Array.from({ length: count }, () => random.nextUint32());
}

describe('Prng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(draw(new Prng(42), 20)).toEqual(draw(new Prng(42), 20));
  });

  it('produces different sequences for different seeds', () => {
    expect(draw(new Prng(1), 10)).not.toEqual(draw(new Prng(2), 10));
  });

  it('keeps floats in the half open range from zero to one', () => {
    const random = new Prng(9);
    for (let index = 0; index < 1000; index += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps integers below the limit and rejects invalid limits', () => {
    const random = new Prng(3);
    for (let index = 0; index < 1000; index += 1) {
      expect(random.int(6)).toBeLessThan(6);
    }
    expect(() => random.int(0)).toThrow(RangeError);
    expect(() => random.int(1.5)).toThrow(RangeError);
    expect(() => random.pick([])).toThrow(RangeError);
  });

  it('handles certain and impossible chances', () => {
    const random = new Prng(5);
    for (let index = 0; index < 200; index += 1) {
      expect(random.chance(1)).toBe(true);
      expect(random.chance(0)).toBe(false);
    }
  });

  it('forks streams that do not depend on how much the parent has been used', () => {
    const fresh = new Prng(11);
    const used = new Prng(11);
    draw(used, 50);
    expect(draw(fresh.fork('links'), 5)).toEqual(draw(used.fork('links'), 5));
    expect(draw(fresh.fork('links'), 5)).not.toEqual(draw(fresh.fork('timers'), 5));
  });
});

describe('VirtualClock', () => {
  it('runs timers in time order and breaks ties by insertion order', () => {
    const clock = new VirtualClock();
    const order: string[] = [];
    clock.setTimeout(() => order.push('late'), 20);
    clock.setTimeout(() => order.push('first'), 10);
    clock.setTimeout(() => order.push('second'), 10);
    clock.advance(20);
    expect(order).toEqual(['first', 'second', 'late']);
  });

  it('only runs timers that are due and moves time to the target', () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(clock.now()), 10);
    clock.setTimeout(() => fired.push(clock.now()), 30);
    expect(clock.advance(15)).toBe(1);
    expect(fired).toEqual([10]);
    expect(clock.now()).toBe(15);
    expect(clock.pending).toBe(1);
  });

  it('runs timers scheduled by callbacks when they fall inside the advance', () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(() => {
      fired.push(clock.now());
      clock.setTimeout(() => fired.push(clock.now()), 5);
    }, 10);
    clock.advance(20);
    expect(fired).toEqual([10, 15]);
  });

  it('does not run cancelled timers', () => {
    const clock = new VirtualClock();
    let fired = false;
    const handle = clock.setTimeout(() => {
      fired = true;
    }, 10);
    clock.clearTimeout(handle);
    clock.clearTimeout(handle);
    clock.advance(100);
    expect(fired).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it('reports a timer that keeps rescheduling itself', () => {
    const clock = new VirtualClock();
    const loop = (): void => {
      clock.setTimeout(loop, 1);
    };
    loop();
    expect(() => clock.runUntilIdle(100)).toThrow(VirtualClockOverflowError);
  });

  it('rejects negative and non finite durations', () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.setTimeout(() => {}, Number.NaN)).toThrow(RangeError);
  });
});

describe('runProperty', () => {
  it('passes when the property holds for every case', () => {
    const report = runProperty(() => {}, { runs: 25 });
    expect(report.runs).toBe(25);
    expect(report.failure).toBeUndefined();
  });

  it('reports a failing seed that replays to the same message', () => {
    const property: Property = ({ seed }) => {
      if (new Prng(seed).int(4) === 0) throw new Error(`unlucky seed ${seed}`);
    };
    const report = runProperty(property, { runs: 200 });
    const failure = report.failure;
    expect(failure).toBeDefined();
    if (failure === undefined) return;
    expect(failure.message).toBe(`unlucky seed ${failure.seed}`);
    expect(replayCase(property, { seed: failure.seed, size: failure.size })).toBe(failure.message);
  });

  it('shrinks the size of a failing case', () => {
    const property: Property = ({ size }) => {
      if (size >= 3) throw new Error(`size ${size} is too big`);
    };
    const failure = runProperty(property, { runs: 50, maxSize: 20 }).failure;
    expect(failure?.size).toBe(3);
    expect(failure?.originalSize).toBeGreaterThanOrEqual(3);
    expect(failure?.message).toBe('size 3 is too big');
  });

  it('gives the same report for the same base seed', () => {
    const property: Property = ({ seed }) => {
      if (seed % 7 === 0) throw new Error('divisible');
    };
    const first = runProperty(property, { runs: 100, baseSeed: 99 });
    const second = runProperty(property, { runs: 100, baseSeed: 99 });
    expect(second).toEqual(first);
  });

  it('formats a failure with the seed needed to replay it', () => {
    const text = formatFailure({
      run: 4,
      seed: 123,
      size: 2,
      originalSize: 9,
      message: 'broken',
    });
    expect(text).toContain('property failed on run 5: broken');
    expect(text).toContain('seed=123 size=2');
  });

  it('rejects invalid options and passes thrown non errors through', () => {
    expect(() => runProperty(() => {}, { runs: 0 })).toThrow(RangeError);
    expect(() => runProperty(() => {}, { runs: 1, maxSize: 0 })).toThrow(RangeError);
    const message = replayCase(
      () => {
        throw 'plain text';
      },
      { seed: 1, size: 1 },
    );
    expect(message).toBe('plain text');
  });
});
