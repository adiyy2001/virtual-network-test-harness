import { LINK_PROFILES, SimulatedLink, type LinkConfig } from './link.ts';
import type { Prng } from './prng.ts';
import type { Clock } from './virtual-clock.ts';

export interface UpdateFrame {
  readonly seq: number;
  readonly value: string;
}

export interface AckFrame {
  readonly upTo: number;
}

export class SyncServer {
  private readonly applied: string[] = [];
  private readonly buffered = new Map<number, string>();
  private readonly sendAck: (ack: AckFrame) => void;

  constructor(sendAck: (ack: AckFrame) => void) {
    this.sendAck = sendAck;
  }

  get log(): readonly string[] {
    return this.applied;
  }

  receive(frame: UpdateFrame): void {
    if (frame.seq >= this.applied.length) this.buffered.set(frame.seq, frame.value);
    this.drainBuffer();
    this.sendAck({ upTo: this.applied.length });
  }

  private drainBuffer(): void {
    for (
      let value = this.buffered.get(this.applied.length);
      value !== undefined;
      value = this.buffered.get(this.applied.length)
    ) {
      this.buffered.delete(this.applied.length);
      this.applied.push(value);
    }
  }
}

export class SyncClient {
  private readonly unacked = new Map<number, UpdateFrame>();
  private readonly clock: Clock;
  private readonly sendFrame: (frame: UpdateFrame) => void;
  private readonly retryMs: number;
  private nextSeq = 0;
  private retryTimer: number | undefined;
  private retries = 0;

  constructor(clock: Clock, sendFrame: (frame: UpdateFrame) => void, retryMs: number) {
    if (!Number.isFinite(retryMs) || retryMs <= 0) {
      throw new RangeError('retryMs must be a positive number');
    }
    this.clock = clock;
    this.sendFrame = sendFrame;
    this.retryMs = retryMs;
  }

  get pendingCount(): number {
    return this.unacked.size;
  }

  get retransmissions(): number {
    return this.retries;
  }

  push(value: string): void {
    const frame: UpdateFrame = { seq: this.nextSeq, value };
    this.nextSeq += 1;
    this.unacked.set(frame.seq, frame);
    this.sendFrame(frame);
    this.armRetryTimer();
  }

  receiveAck(ack: AckFrame): void {
    for (const seq of [...this.unacked.keys()]) {
      if (seq < ack.upTo) this.unacked.delete(seq);
    }
    if (this.unacked.size === 0) this.disarmRetryTimer();
  }

  private armRetryTimer(): void {
    if (this.retryTimer !== undefined) return;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryUnacked();
    }, this.retryMs);
  }

  private disarmRetryTimer(): void {
    if (this.retryTimer === undefined) return;
    this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private retryUnacked(): void {
    this.retryTimer = undefined;
    for (const frame of this.unacked.values()) {
      this.retries += 1;
      this.sendFrame(frame);
    }
    if (this.unacked.size > 0) this.armRetryTimer();
  }
}

export interface SyncRigOptions {
  readonly clock: Clock;
  readonly random: Prng;
  readonly retryMs: number;
  readonly upstream?: LinkConfig;
  readonly downstream?: LinkConfig;
}

export interface SyncRig {
  readonly client: SyncClient;
  readonly server: SyncServer;
  readonly upstream: SimulatedLink<UpdateFrame>;
  readonly downstream: SimulatedLink<AckFrame>;
}

export function createSyncRig(options: SyncRigOptions): SyncRig {
  const upstream = new SimulatedLink<UpdateFrame>(
    options.clock,
    options.random.fork('upstream'),
    (frame) => {
      server.receive(frame);
    },
    options.upstream ?? LINK_PROFILES.clean,
  );
  const downstream = new SimulatedLink<AckFrame>(
    options.clock,
    options.random.fork('downstream'),
    (ack) => {
      client.receiveAck(ack);
    },
    options.downstream ?? LINK_PROFILES.clean,
  );
  const client = new SyncClient(
    options.clock,
    (frame) => {
      upstream.send(frame);
    },
    options.retryMs,
  );
  const server = new SyncServer((ack) => {
    downstream.send(ack);
  });
  return { client, server, upstream, downstream };
}
