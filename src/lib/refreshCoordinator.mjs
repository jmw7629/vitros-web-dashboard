export const DEFAULT_REFRESH_MIN_MS = 10_000;
export const DEFAULT_REFRESH_MAX_MS = 15_000;

export function getJitteredRefreshDelay(
  random = Math.random,
  minMs = DEFAULT_REFRESH_MIN_MS,
  maxMs = DEFAULT_REFRESH_MAX_MS,
) {
  const low = Math.max(0, Math.floor(Math.min(minMs, maxMs)));
  const high = Math.max(low, Math.floor(Math.max(minMs, maxMs)));
  const raw = Number(random());
  const normalized = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
  return low + Math.floor(normalized * (high - low));
}

export function createCoalescedRefreshRunner(run, options = {}) {
  const isActive = options.isActive ?? (() => true);
  let inFlight = null;
  let queued = false;

  async function request() {
    if (!isActive()) return;

    if (inFlight) {
      queued = true;
      return inFlight;
    }

    const cycle = (async () => {
      do {
        queued = false;
        if (!isActive()) break;
        await run();
      } while (queued && isActive());
    })();

    inFlight = cycle;
    try {
      await cycle;
    } finally {
      if (inFlight === cycle) inFlight = null;
    }
  }

  return {
    request,
    isRunning: () => inFlight !== null,
    hasQueuedFollowUp: () => queued,
  };
}

export function createRefreshScheduler(options) {
  const {
    requestRefresh,
    isVisible,
    setTimeoutFn,
    clearTimeoutFn,
    random = Math.random,
    minDelayMs = DEFAULT_REFRESH_MIN_MS,
    maxDelayMs = DEFAULT_REFRESH_MAX_MS,
  } = options;

  let timerId = null;
  let disposed = false;

  function clearScheduled() {
    if (timerId !== null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
  }

  function scheduleNext() {
    clearScheduled();
    if (disposed || !isVisible()) return;

    const delay = getJitteredRefreshDelay(random, minDelayMs, maxDelayMs);
    timerId = setTimeoutFn(() => {
      timerId = null;
      void reconcileNow();
    }, delay);
  }

  async function reconcileNow() {
    clearScheduled();
    if (disposed || !isVisible()) return;

    try {
      await requestRefresh();
    } finally {
      if (!disposed && isVisible()) scheduleNext();
    }
  }

  function handleVisibilityChange() {
    if (disposed) return;
    if (!isVisible()) {
      clearScheduled();
      return;
    }
    void reconcileNow();
  }

  function handleOnline() {
    if (disposed || !isVisible()) return;
    void reconcileNow();
  }

  function start() {
    if (disposed) return;
    void reconcileNow();
  }

  function dispose() {
    disposed = true;
    clearScheduled();
  }

  return {
    start,
    dispose,
    scheduleNext,
    reconcileNow,
    handleVisibilityChange,
    handleOnline,
    hasScheduledRefresh: () => timerId !== null,
  };
}
