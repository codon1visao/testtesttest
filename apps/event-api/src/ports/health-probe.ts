/** A dependency that can report whether it is reachable. Implementations must not throw. */
export interface HealthProbe {
  isUp(): Promise<boolean>;
}
