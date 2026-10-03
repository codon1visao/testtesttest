import type { QueryRunner } from "typeorm";

interface Destroyable {
  destroy(): void;
}

function isDestroyable(value: unknown): value is Destroyable {
  return (
    typeof value === "object" &&
    value !== null &&
    "destroy" in value &&
    typeof value.destroy === "function"
  );
}

/**
 * Takes the runner's connection out of the pool for good. After a query timeout mysql2 3.24.5
 * still waits for that query's answer on the connection: a later command (a ROLLBACK, or the next
 * borrower's first query) would queue behind it without any timer, and hang while MySQL is stalled.
 * Call before anything else is sent on the runner; `release()` afterwards is still safe.
 */
export async function discardConnection(runner: QueryRunner): Promise<void> {
  const connection: unknown = await runner.connect();
  if (isDestroyable(connection)) connection.destroy();
}
