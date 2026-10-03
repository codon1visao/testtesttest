import type { Redis } from "ioredis";
import type { HealthProbe } from "../ports/health-probe.js";

export class RedisHealthProbe implements HealthProbe {
  constructor(private readonly redis: Redis) {}

  async isUp(): Promise<boolean> {
    try {
      await this.redis.ping(); // resolves "PONG" or rejects (offline queue off, 1 s command timeout)
      return true;
    } catch {
      return false;
    }
  }
}
