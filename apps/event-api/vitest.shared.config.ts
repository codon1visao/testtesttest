const conditions = ["@event-desk/source", "module", "node", "development|production"];

/** Resolve workspace packages to their TypeScript source in tests (same condition as tsc and tsx). */
export const workspaceSourceResolution = {
  resolve: { conditions },
  ssr: { resolve: { conditions } },
};
