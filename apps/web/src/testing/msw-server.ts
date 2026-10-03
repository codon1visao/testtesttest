import { setupServer } from "msw/node";

/** One MSW server for every web test; tests add handlers with `mswServer.use(...)`. */
export const mswServer = setupServer();
