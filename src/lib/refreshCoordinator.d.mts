export const DEFAULT_REFRESH_MIN_MS: number;
export const DEFAULT_REFRESH_MAX_MS: number;

export function getJitteredRefreshDelay(
  random?: () => number,
  minMs?: number,
  maxMs?: number,
): number;

export interface CoalescedRefreshRunner {
  request(): Promise<void>;
  isRunning(): boolean;
  hasQueuedFollowUp(): boolean;
}

export function createCoalescedRefreshRunner(
  run: () => Promise<void>,
  options?: { isActive?: () => boolean },
): CoalescedRefreshRunner;

export interface RefreshScheduler {
  start(): void;
  dispose(): void;
  scheduleNext(): void;
  reconcileNow(): Promise<void>;
  handleVisibilityChange(): void;
  handleOnline(): void;
  hasScheduledRefresh(): boolean;
}

export function createRefreshScheduler(options: {
  requestRefresh: () => Promise<void>;
  isVisible: () => boolean;
  setTimeoutFn: (callback: () => void, delayMs: number) => number;
  clearTimeoutFn: (timerId: number) => void;
  random?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
}): RefreshScheduler;
