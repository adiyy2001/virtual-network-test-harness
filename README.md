# virtual-network-test-harness

A TypeScript harness that replaces real timers and sockets with a virtual clock, a seeded random generator and simulated lossy links, so flaky sync tests become reproducible.

## Requirements

Node 24 or newer.

## Install and run

```
npm install
npm run typecheck
npm test
```

## Usage

```ts
import { Prng } from './src/prng.ts';
import { VirtualClock } from './src/virtual-clock.ts';
import { LINK_PROFILES } from './src/link.ts';
import { createSyncRig } from './src/reliable-sync.ts';

const clock = new VirtualClock();
const rig = createSyncRig({
  clock,
  random: new Prng(7),
  retryMs: 100,
  upstream: LINK_PROFILES.lossy,
  downstream: LINK_PROFILES.lossy,
});
rig.client.push('hello');
clock.advance(5000);
console.log(rig.server.log);
```

The same seed always produces the same drops, delays and duplicates. A property run that fails reports its seed and size, and `replayCase` runs exactly that case again.

## Project layout

* `src/prng.ts`: seeded random generator with forks for independent streams
* `src/virtual-clock.ts`: timers that only move when the test advances time
* `src/link.ts`: simulated link with latency, jitter, loss, duplication and partitions
* `src/reliable-sync.ts`: example client and server with acknowledgements and retries, plus a wiring helper
* `src/property.ts`: property style runner that finds a failing seed, shrinks its size and replays it
* `test/foundations.test.ts`: tests for the generator, the clock and the runner
* `test/network.test.ts`: tests for the link and the sync example

## Tests

```
npm test
```

The tests need no network, no browser and no environment variables.
