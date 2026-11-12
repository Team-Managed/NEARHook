export const DEFAULT_FAILURE_THRESHOLD = 10;

export interface CircuitBreakerState {
  consecutiveFailures: number;
  isOpen: boolean;
}

export class CircuitBreaker {
  public constructor(private readonly failureThreshold = DEFAULT_FAILURE_THRESHOLD) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new RangeError("Circuit breaker threshold must be a positive integer");
    }
  }

  public recordFailure(previousFailures: number): CircuitBreakerState {
    const consecutiveFailures = previousFailures + 1;
    return {
      consecutiveFailures,
      isOpen: consecutiveFailures >= this.failureThreshold,
    };
  }

  public recordSuccess(): CircuitBreakerState {
    return { consecutiveFailures: 0, isOpen: false };
  }
}
