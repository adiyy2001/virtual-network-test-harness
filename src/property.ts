import { Prng } from './prng.ts';

export interface PropertyCase {
  readonly seed: number;
  readonly size: number;
}

export type Property = (testCase: PropertyCase) => void;

export interface PropertyOptions {
  readonly runs: number;
  readonly baseSeed?: number;
  readonly maxSize?: number;
}

export interface PropertyFailure {
  readonly run: number;
  readonly seed: number;
  readonly size: number;
  readonly originalSize: number;
  readonly message: string;
}

export interface PropertyReport {
  readonly runs: number;
  readonly baseSeed: number;
  readonly failure: PropertyFailure | undefined;
}

export function replayCase(property: Property, testCase: PropertyCase): string | undefined {
  try {
    property(testCase);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function caseForRun(baseSeed: number, run: number, maxSize: number): PropertyCase {
  const seed = new Prng(baseSeed).fork(`run:${run}`).seed;
  const size = 1 + new Prng(seed).fork('size').int(maxSize);
  return { seed, size };
}

function smallestFailingSize(
  property: Property,
  failing: PropertyCase,
  message: string,
): { size: number; message: string } {
  for (let size = 1; size < failing.size; size += 1) {
    const candidateMessage = replayCase(property, { seed: failing.seed, size });
    if (candidateMessage !== undefined) return { size, message: candidateMessage };
  }
  return { size: failing.size, message };
}

export function runProperty(property: Property, options: PropertyOptions): PropertyReport {
  const baseSeed = options.baseSeed ?? 1;
  const maxSize = options.maxSize ?? 20;
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new RangeError('runs must be a positive integer');
  }
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new RangeError('maxSize must be a positive integer');
  }
  for (let run = 0; run < options.runs; run += 1) {
    const testCase = caseForRun(baseSeed, run, maxSize);
    const message = replayCase(property, testCase);
    if (message !== undefined) {
      const smallest = smallestFailingSize(property, testCase, message);
      return {
        runs: run + 1,
        baseSeed,
        failure: {
          run,
          seed: testCase.seed,
          size: smallest.size,
          originalSize: testCase.size,
          message: smallest.message,
        },
      };
    }
  }
  return { runs: options.runs, baseSeed, failure: undefined };
}

export function formatFailure(failure: PropertyFailure): string {
  return [
    `property failed on run ${failure.run + 1}: ${failure.message}`,
    `replay with seed=${failure.seed} size=${failure.size}`,
    `first found at size ${failure.originalSize}`,
  ].join('\n');
}
