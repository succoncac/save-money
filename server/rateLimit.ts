interface FailureEntry {
  timestamps: number[];
}

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export class AuthRateLimiter {
  private readonly store = new Map<string, FailureEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = DEFAULT_MAX_ATTEMPTS, windowMs = DEFAULT_WINDOW_MS) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  private prune(key: string, nowMs: number): number[] {
    const entry = this.store.get(key);
    if (!entry) return [];
    const cutoff = nowMs - this.windowMs;
    const recent = entry.timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) {
      this.store.delete(key);
      return [];
    }
    entry.timestamps = recent;
    return recent;
  }

  check(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const recent = this.prune(key, nowMs);
    if (recent.length < this.maxAttempts) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  recordFailure(key: string, nowMs = Date.now()): void {
    const recent = this.prune(key, nowMs);
    recent.push(nowMs);
    this.store.set(key, { timestamps: recent });
  }

  clear(key: string): void {
    this.store.delete(key);
  }
}

export const authRateLimiter = new AuthRateLimiter();
