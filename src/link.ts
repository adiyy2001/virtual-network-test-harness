import type { Prng } from './prng.ts';
import type { Clock } from './virtual-clock.ts';

export interface LinkConfig {
  readonly latencyMs: number;
  readonly jitterMs: number;
  readonly lossRate: number;
  readonly duplicateRate: number;
}

export const LINK_PROFILES = {
  clean: { latencyMs: 5, jitterMs: 0, lossRate: 0, duplicateRate: 0 },
  lossy: { latencyMs: 60, jitterMs: 40, lossRate: 0.2, duplicateRate: 0.05 },
  chaotic: { latencyMs: 150, jitterMs: 300, lossRate: 0.3, duplicateRate: 0.3 },
} satisfies Record<string, LinkConfig>;

export interface LinkStats {
  sent: number;
  delivered: number;
  lost: number;
  duplicated: number;
  partitioned: number;
}

export function validateLinkConfig(config: LinkConfig): LinkConfig {
  const rates = [config.lossRate, config.duplicateRate];
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)) {
    throw new RangeError('link rates must be between 0 and 1');
  }
  const durations = [config.latencyMs, config.jitterMs];
  if (durations.some((duration) => !Number.isFinite(duration) || duration < 0)) {
    throw new RangeError('link durations must not be negative');
  }
  return config;
}

export class SimulatedLink<T> {
  readonly stats: LinkStats = { sent: 0, delivered: 0, lost: 0, duplicated: 0, partitioned: 0 };
  private config: LinkConfig;
  private isPartitioned = false;
  private readonly clock: Clock;
  private readonly random: Prng;
  private readonly deliver: (message: T) => void;

  constructor(
    clock: Clock,
    random: Prng,
    deliver: (message: T) => void,
    config: LinkConfig = LINK_PROFILES.clean,
  ) {
    this.clock = clock;
    this.random = random;
    this.deliver = deliver;
    this.config = validateLinkConfig(config);
  }

  get partitioned(): boolean {
    return this.isPartitioned;
  }

  configure(config: LinkConfig): void {
    this.config = validateLinkConfig(config);
  }

  setPartitioned(partitioned: boolean): void {
    this.isPartitioned = partitioned;
  }

  send(message: T): void {
    this.stats.sent += 1;
    if (this.isPartitioned) {
      this.stats.partitioned += 1;
      return;
    }
    if (this.random.chance(this.config.lossRate)) {
      this.stats.lost += 1;
      return;
    }
    this.scheduleArrival(message);
    if (this.random.chance(this.config.duplicateRate)) {
      this.stats.duplicated += 1;
      this.scheduleArrival(message);
    }
  }

  private scheduleArrival(message: T): void {
    const delay = this.config.latencyMs + this.random.between(0, this.config.jitterMs);
    this.clock.setTimeout(() => {
      this.arrive(message);
    }, delay);
  }

  private arrive(message: T): void {
    if (this.isPartitioned) {
      this.stats.partitioned += 1;
      return;
    }
    this.stats.delivered += 1;
    this.deliver(message);
  }
}
