/**
 * After a failed cache flush, reads skip the cache until a later flush succeeds (T3 §7).
 * In-process state: correct because exactly one event-api process runs (T3 §3).
 */
export class CacheBypass {
  #active = false;

  get active(): boolean {
    return this.#active;
  }

  activate(): void {
    this.#active = true;
  }

  clear(): void {
    this.#active = false;
  }
}
