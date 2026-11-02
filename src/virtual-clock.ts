export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

interface ScheduledTimer {
  readonly id: number;
  readonly time: number;
  readonly callback: () => void;
}

export class VirtualClockOverflowError extends Error {
  readonly processed: number;

  constructor(processed: number) {
    super(`virtual clock did not go idle after ${processed} events`);
    this.name = 'VirtualClockOverflowError';
    this.processed = processed;
  }
}

export class VirtualClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers: ScheduledTimer[] = [];

  now(): number {
    return this.currentTime;
  }

  get pending(): number {
    return this.timers.length;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError('delay must be a finite number of milliseconds, zero or more');
    }
    const timer: ScheduledTimer = {
      id: this.nextId,
      time: this.currentTime + delayMs,
      callback,
    };
    this.nextId += 1;
    const position = this.timers.findIndex((existing) => existing.time > timer.time);
    if (position === -1) this.timers.push(timer);
    else this.timers.splice(position, 0, timer);
    return timer.id;
  }

  clearTimeout(handle: number): void {
    const position = this.timers.findIndex((existing) => existing.id === handle);
    if (position !== -1) this.timers.splice(position, 1);
  }

  advance(durationMs: number): number {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('duration must be a finite number of milliseconds, zero or more');
    }
    const target = this.currentTime + durationMs;
    let processed = 0;
    for (let timer = this.takeDue(target); timer !== undefined; timer = this.takeDue(target)) {
      this.currentTime = timer.time;
      timer.callback();
      processed += 1;
    }
    this.currentTime = target;
    return processed;
  }

  runUntilIdle(maxEvents = 100_000): number {
    let processed = 0;
    for (let timer = this.takeDue(Infinity); timer !== undefined; timer = this.takeDue(Infinity)) {
      if (processed >= maxEvents) throw new VirtualClockOverflowError(processed);
      this.currentTime = timer.time;
      timer.callback();
      processed += 1;
    }
    return processed;
  }

  private takeDue(limit: number): ScheduledTimer | undefined {
    const first = this.timers[0];
    if (first === undefined || first.time > limit) return undefined;
    this.timers.shift();
    return first;
  }
}
