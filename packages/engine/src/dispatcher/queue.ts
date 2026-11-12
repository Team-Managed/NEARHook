export const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 9_000, 27_000, 81_000] as const;

export interface RetryQueueOptions {
  delaysMs?: readonly number[];
  jitterRatio?: number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface RetryResult<T> {
  value: T;
  attempt: number;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Retry was aborted"));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Retry was aborted"));
    }, { once: true });
  });
}

export class DelayedRetryQueue {
  private readonly delaysMs: readonly number[];
  private readonly jitterRatio: number;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  public constructor(options: RetryQueueOptions = {}) {
    this.delaysMs = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
    if (this.jitterRatio < 0 || this.jitterRatio > 1) {
      throw new RangeError("Retry jitter ratio must be between zero and one");
    }
    if (this.delaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
      throw new RangeError("Retry delays must be finite, non-negative numbers");
    }
  }

  public async run<T>(
    operation: (attempt: number) => Promise<T>,
    isSuccess: (value: T) => boolean,
    onFailure: (value: T, attempt: number) => Promise<boolean>,
    signal?: AbortSignal
  ): Promise<RetryResult<T>> {
    let attempt = 1;
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("Retry was aborted");
      const value = await operation(attempt);
      if (isSuccess(value)) return { value, attempt };
      const shouldContinue = await onFailure(value, attempt);
      const delay = this.delaysMs[attempt - 1];
      if (!shouldContinue || delay === undefined) return { value, attempt };
      const jitter = 1 + (this.random() * 2 - 1) * this.jitterRatio;
      await this.sleep(Math.round(delay * jitter), signal);
      attempt++;
    }
  }
}
