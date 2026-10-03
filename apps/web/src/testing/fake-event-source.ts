type Listener = (event: MessageEvent) => void;

/** jsdom has no EventSource: a controllable stand-in, installed globally by setup.ts. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset(): void {
    FakeEventSource.instances = [];
  }
  readonly url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly #listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Listener): void {
    const set = this.#listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.#listeners.get(type)?.delete(listener);
  }
  close(): void {
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  fail(): void {
    this.readyState = 0;
    this.onerror?.(new Event("error"));
  }
  emit(type: string, data: string): void {
    for (const listener of this.#listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data }));
  }
}
