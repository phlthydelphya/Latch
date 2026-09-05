/**
 * AsyncMutex ensures single-flight execution of asynchronous operations.
 * Used for rotationMutex to serialize key rotations and prevent concurrency races.
 */
export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();
  private locked = false;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((r) => { release = r; });
    await prev;
    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
      release();
    }
  }

  isLocked(): boolean {
    return this.locked;
  }
}
