import type { DataSource } from "typeorm";
import type { HealthProbe } from "../ports/health-probe.js";

export class MysqlHealthProbe implements HealthProbe {
  constructor(private readonly dataSource: DataSource) {}

  async isUp(): Promise<boolean> {
    try {
      await this.dataSource.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
