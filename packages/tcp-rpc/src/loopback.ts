/** The only hosts the RPC server binds to and the client sends the shared secret to (F8). */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);
