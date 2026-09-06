import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_REFRESH_MAX_MS,
  DEFAULT_REFRESH_MIN_MS,
  createCoalescedRefreshRunner,
  createRefreshScheduler,
  getJitteredRefreshDelay,
} from "../src/lib/refreshCoordinator.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function testCoalescing() {
  let runs = 0;
  let maxConcurrent = 0;
  let concurrent = 0;
  const gates = [];

  const runner = createCoalescedRefreshRunner(async () => {
    runs += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    concurrent -= 1;
  });

  const first = runner.request();
  await flush();
  assert.equal(runs, 1, "first request starts one refresh");

  const overlapping = [runner.request(), runner.request(), runner.request()];
  assert.equal(runner.hasQueuedFollowUp(), true, "overlap queues one authoritative follow-up");
  gates[0].resolve();
  await flush();
  assert.equal(runs, 2, "multiple overlapping requests coalesce into one follow-up");
  assert.equal(maxConcurrent, 1, "refreshes never overlap");

  gates[1].resolve();
  await Promise.all([first, ...overlapping]);
  assert.equal(runs, 2, "coalesced callers do not create duplicate refreshes");
}

function makeFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  const delays = [];
  return {
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    timers,
    delays,
  };
}

async function testVisibilityReconnectAndCleanup() {
  let visible = false;
  let refreshes = 0;
  const fake = makeFakeTimers();
  const scheduler = createRefreshScheduler({
    requestRefresh: async () => { refreshes += 1; },
    isVisible: () => visible,
    setTimeoutFn: fake.setTimeoutFn,
    clearTimeoutFn: fake.clearTimeoutFn,
    random: () => 0.5,
  });

  scheduler.start();
  await flush();
  assert.equal(refreshes, 0, "hidden tabs do not poll on start");
  assert.equal(fake.timers.size, 0, "hidden tabs have no periodic timer");

  visible = true;
  scheduler.handleVisibilityChange();
  await flush();
  assert.equal(refreshes, 1, "foreground resume reconciles immediately");
  assert.equal(fake.timers.size, 1, "foreground resume restores one fallback timer");

  scheduler.handleOnline();
  await flush();
  assert.equal(refreshes, 2, "online reconnect reconciles immediately");
  assert.equal(fake.timers.size, 1, "reconnect still leaves only one fallback timer");

  visible = false;
  scheduler.handleVisibilityChange();
  assert.equal(fake.timers.size, 0, "background transition clears periodic refresh");

  visible = true;
  scheduler.handleVisibilityChange();
  await flush();
  assert.equal(refreshes, 3, "second foreground resume reconciles once");
  assert.equal(fake.timers.size, 1, "second resume has one timer");

  scheduler.dispose();
  assert.equal(fake.timers.size, 0, "dispose clears timer state");
  scheduler.handleOnline();
  await flush();
  assert.equal(refreshes, 3, "disposed scheduler performs no state-producing refresh");
}

function testThirtyClientJitter() {
  const delays = Array.from({ length: 30 }, (_, index) =>
    getJitteredRefreshDelay(() => index / 29),
  );
  assert.equal(delays.length, 30);
  assert.ok(delays.every((d) => d >= DEFAULT_REFRESH_MIN_MS && d <= DEFAULT_REFRESH_MAX_MS));
  assert.ok(Math.max(...delays) - Math.min(...delays) >= 4_900, "30 clients are spread across the fallback window");
  assert.ok(new Set(delays).size >= 25, "30 logical clients do not synchronize onto one interval");
}

async function testProviderWiring() {
  const source = await readFile(new URL("../src/hooks/useConvexData.tsx", import.meta.url), "utf8");
  assert.match(source, /createCoalescedRefreshRunner/, "provider uses the coalesced runner");
  assert.match(source, /createRefreshScheduler/, "provider uses the visibility-aware scheduler");
  assert.match(source, /visibilitychange/, "provider listens for visibility changes");
  assert.match(source, /addEventListener\("online"/, "provider listens for reconnects");
  assert.match(source, /mutationRefreshTimerRef/, "mutation refresh timer has explicit cleanup state");
  assert.doesNotMatch(source, /setInterval\(loadAll,\s*15000\)/, "fixed synchronized interval is removed");
  assert.doesNotMatch(source, /\(debouncedLoadAll as any\)\._t/, "function-property debounce timer is removed");
}

await testCoalescing();
await testVisibilityReconnectAndCleanup();
testThirtyClientJitter();
await testProviderWiring();
console.log("REFRESH_INFLIGHT_DEDUPE=PASS");
console.log("REFRESH_COALESCING=PASS");
console.log("VISIBILITY_PAUSE_RESUME=PASS");
console.log("RECONNECT_RECONCILIATION=PASS");
console.log("JITTERED_FALLBACK=PASS");
console.log("THIRTY_CLIENT_STORM_TEST=PASS");
