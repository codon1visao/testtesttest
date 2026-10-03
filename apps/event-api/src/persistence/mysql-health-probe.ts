import type { DataSource } from "typeorm";
import type { HealthProbe } from "../ports/health-probe.js";
import { isQueryTimeout } from "./mysql-errors.js";
import { discardConnection } from "./pooled-connection.js";

export class MysqlHealthProbe implements HealthProbe {
  constructor(private readonly dataSource: DataSource) {}

  async isUp(): Promise<boolean> {
    try {
      const runner = this.dataSource.createQueryRunner();
      try {
        await runner.query("SELECT 1");
        return true;
      } catch (error) {
        // A timed-out probe must not hand a still-busy connection back to the pool.
        if (isQueryTimeout(error)) await discardConnection(runner);
        return false;
      } finally {
        await runner.release();
      }
    } catch {
      return false;
    }
  }
}
