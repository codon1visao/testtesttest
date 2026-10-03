/**
 * Exhaustiveness guard for the `default` branch of a switch over a union.
 * Compiles only when every member is handled; throws if a value slips through at runtime.
 */
export function assertNever(value: never, context = "value"): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
