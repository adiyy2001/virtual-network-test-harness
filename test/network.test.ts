import { describe, expect, it } from 'vitest';
import { LINK_PROFILES, SimulatedLink, type LinkConfig } from '../src/link.ts';
import { Prng } from '../src/prng.ts';
import { replayCase, runProperty, type Property } from '../src/property.ts';
import { createSyncRig } from '../src/reliable-sync.ts';
import { VirtualClock } from '../src/virtual-clock.ts';

interface Arrival {
  readonly at: number;
  readonly value: number;
}

function linkOf(config: LinkConfig, seed = 1) {
  const clock = new VirtualClock();
  const received: Arrival[] = [];
  const link = new SimulatedLink<number>(
    clock,
    new Prng(seed),
    (value) => received.push({ at: clock.now(), value }),
    config,
  );
  return { clock, link, received };
}

function sendMany(link: SimulatedLink<number>, count: number): void {
  for (let value = 0; value < count; value += 1) link.send(value);
}

describe('SimulatedLink', () => {
  it('delivers a message after exactly the latency on a clean link', () => {
    const { clock, link, received } = linkOf(LINK_PROFILES.clean);
    link.send(1);
    clock.advance(4);
    expect(received).toEqual([]);
    clock.advance(1);
    expect(received).toEqual([{ at: 5, value: 1 }]);
  });

  it('keeps every delay within latency plus jitter', () => {
    const { clock, link, received } = linkOf({ ...LINK_PROFILES.clean, latencyMs: 10, jitterMs: 20 });
    sendMany(link, 200);
    clock.runUntilIdle();
    expect(received).toHaveLength(200);
    for (const arrival of received) {
      expect(arrival.at).toBeGreaterThanOrEqual(10);
      expect(arrival.at).toBeLessThanOrEqual(30);
    }
  });

  it('drops everything when loss is certain', () => {
    const { clock, link, received } = linkOf({ ...LINK_PROFILES.clean, lossRate: 1 });
    sendMany(link, 10);
    clock.runUntilIdle();
    expect(received).toEqual([]);
    expect(link.stats.lost).toBe(10);
  });

  it('drops about the configured share of messages', () => {
    const total = 4000;
    const { clock, link, received } = linkOf({ ...LINK_PROFILES.clean, lossRate: 0.25 }, 17);
    sendMany(link, total);
    clock.runUntilIdle();
    const observed = link.stats.lost / total;
    expect(observed).toBeGreaterThan(0.22);
    expect(observed).toBeLessThan(0.28);
    expect(received.length + link.stats.lost).toBe(total);
  });

  it('delivers each message twice when duplication is certain', () => {
    const { clock, link, received } = linkOf({ ...LINK_PROFILES.clean, duplicateRate: 1 });
    sendMany(link, 5);
    clock.runUntilIdle();
    expect(received).toHaveLength(10);
    expect(link.stats.duplicated).toBe(5);
    expect(link.stats.delivered).toBe(10);
  });

  it('drops messages during a partition, including ones already in flight', () => {
    const { clock, link, received } = linkOf(LINK_PROFILES.clean);
    link.send(1);
    clock.advance(2);
    link.setPartitioned(true);
    link.send(2);
    clock.advance(100);
    expect(received).toEqual([]);
    expect(link.stats.partitioned).toBe(2);
    link.setPartitioned(false);
    link.send(3);
    clock.advance(100);
    expect(received.map((arrival) => arrival.value)).toEqual([3]);
  });

  it('replays exactly the same trace for the same seed', () => {
    const run = (seed: number): Arrival[] => {
      const { clock, link, received } = linkOf(LINK_PROFILES.chaotic, seed);
      sendMany(link, 100);
      clock.runUntilIdle();
      return received;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('rejects invalid configurations', () => {
    const build = (config: LinkConfig) => () =>
      new SimulatedLink<number>(new VirtualClock(), new Prng(1), () => {}, config);
    expect(build({ ...LINK_PROFILES.clean, lossRate: 2 })).toThrow(RangeError);
    expect(build({ ...LINK_PROFILES.clean, latencyMs: -1 })).toThrow(RangeError);
  });
});

function syncRigFor(seed: number, profile: LinkConfig, retryMs: number) {
  const clock = new VirtualClock();
  const rig = createSyncRig({
    clock,
    random: new Prng(seed),
    retryMs,
    upstream: profile,
    downstream: profile,
  });
  return { clock, ...rig };
}

function updatesOf(size: number): string[] {
  return Array.from({ length: size }, (_, index) => `update ${index}`);
}

describe('reliable sync over simulated links', () => {
  it('delivers everything in order on a clean link without retransmissions', () => {
    const { clock, client, server } = syncRigFor(1, LINK_PROFILES.clean, 100);
    const values = updatesOf(10);
    values.forEach((value) => client.push(value));
    clock.runUntilIdle();
    expect(server.log).toEqual(values);
    expect(client.pendingCount).toBe(0);
    expect(client.retransmissions).toBe(0);
    expect(clock.pending).toBe(0);
  });

  it('applies each update once and in order despite duplicates and reordering', () => {
    const profile = { latencyMs: 10, jitterMs: 200, lossRate: 0, duplicateRate: 1 };
    const { clock, client, server } = syncRigFor(5, profile, 1000);
    const values = updatesOf(30);
    values.forEach((value) => client.push(value));
    clock.advance(10_000);
    expect(server.log).toEqual(values);
  });

  it('recovers after a partition heals', () => {
    const { clock, client, server, upstream, downstream } = syncRigFor(3, LINK_PROFILES.clean, 100);
    upstream.setPartitioned(true);
    downstream.setPartitioned(true);
    updatesOf(3).forEach((value) => client.push(value));
    clock.advance(5000);
    expect(server.log).toEqual([]);
    expect(client.pendingCount).toBe(3);
    expect(client.retransmissions).toBeGreaterThan(0);
    upstream.setPartitioned(false);
    downstream.setPartitioned(false);
    clock.advance(5000);
    expect(server.log).toEqual(updatesOf(3));
    expect(client.pendingCount).toBe(0);
    expect(clock.pending).toBe(0);
  });

  it('behaves identically for the same seed', () => {
    const run = () => {
      const { clock, client, upstream, downstream } = syncRigFor(8, LINK_PROFILES.chaotic, 100);
      updatesOf(15).forEach((value) => client.push(value));
      clock.advance(60_000);
      return [client.retransmissions, upstream.stats, downstream.stats];
    };
    expect(run()).toEqual(run());
  });

  it('rejects a retry interval that is not positive', () => {
    expect(() => syncRigFor(1, LINK_PROFILES.clean, 0)).toThrow(RangeError);
  });
});

describe('property runs over the sync example', () => {
  const convergesWithRetries: Property = ({ seed, size }) => {
    const { clock, client, server } = syncRigFor(seed, LINK_PROFILES.chaotic, 100);
    const values = updatesOf(size);
    values.forEach((value) => client.push(value));
    clock.advance(60_000);
    expect(server.log).toEqual(values);
    expect(client.pendingCount).toBe(0);
  };

  const deliversWithoutRetries: Property = ({ seed, size }) => {
    const { clock, client, server } = syncRigFor(seed, LINK_PROFILES.lossy, 1_000_000_000);
    updatesOf(size).forEach((value) => client.push(value));
    clock.advance(10_000);
    if (server.log.length !== size) {
      throw new Error(`server applied ${server.log.length} of ${size} updates`);
    }
  };

  it('holds for a chaotic link when the client retries', () => {
    const report = runProperty(convergesWithRetries, { runs: 40 });
    expect(report.failure).toBeUndefined();
  });

  it('finds a failing seed when the client never retries and replays it', () => {
    const report = runProperty(deliversWithoutRetries, { runs: 30 });
    const failure = report.failure;
    expect(failure).toBeDefined();
    if (failure === undefined) return;
    expect(failure.size).toBeLessThanOrEqual(failure.originalSize);
    const replayed = replayCase(deliversWithoutRetries, { seed: failure.seed, size: failure.size });
    expect(replayed).toBe(failure.message);
  });
});
