/** Architecture rules (T3 §10). Paths are repository-relative; npm paths are pnpm real paths (the pattern matches the innermost node_modules segment). */
const npm = (names) => `(^|/)node_modules/(${names})/`;
const NPM_TYPES = ["npm", "npm-dev", "npm-peer", "npm-optional", "npm-no-pkg", "npm-unknown"];
const TESTS = "\\.test\\.tsx?$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "not-to-unresolvable",
      comment: "Every import must resolve; catches broken export conditions and .js→.ts mapping.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "contracts-no-node-builtins",
      comment: "packages/contracts runs in the browser as well as Node.",
      severity: "error",
      from: { path: "^packages/contracts/src", pathNot: TESTS },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "contracts-only-zod",
      severity: "error",
      from: { path: "^packages/contracts/src", pathNot: TESTS },
      to: { dependencyTypes: NPM_TYPES, pathNot: npm("zod") },
    },
    {
      name: "packages-not-to-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-independent",
      comment: "Apps share code only through packages/*.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "web-no-node",
      severity: "error",
      from: { path: "^apps/web/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "web-no-server-packages",
      severity: "error",
      from: { path: "^apps/web/" },
      to: {
        path: [
          npm("typeorm|mysql2|bullmq|ioredis|express|openai|@openai/agents"),
          "^packages/tcp-rpc/",
        ],
      },
    },
    {
      name: "openai-only-in-gateway",
      severity: "error",
      from: { pathNot: "^apps/ai-gateway/" },
      to: { path: npm("openai|@openai/agents") },
    },
    {
      name: "typeorm-only-in-persistence",
      severity: "error",
      from: {
        path: "^apps/event-api/src",
        pathNot: "^apps/event-api/src/(persistence|repositories|scripts)/",
      },
      to: { path: npm("typeorm|mysql2") },
    },
    {
      name: "queue-and-redis-only-in-integrations",
      severity: "error",
      from: {
        path: "^apps/event-api/src",
        pathNot: "^apps/event-api/src/(integrations|scripts)/",
      },
      to: { path: npm("bullmq|ioredis") },
    },
    {
      name: "services-use-ports",
      comment: "Modules depend on ports, never on adapters (T3 §11).",
      severity: "error",
      from: { path: "^apps/event-api/src/modules/" },
      to: { path: "^apps/event-api/src/(repositories|integrations|persistence)/" },
    },
    {
      name: "domain-is-pure",
      comment: "Functional core: domain folders import only contracts, zod and other domain code.",
      severity: "error",
      from: { path: "/domain/", pathNot: TESTS },
      to: {
        dependencyTypesNot: ["local", "type-only"],
        pathNot: [npm("zod"), "^packages/contracts/"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(packages|apps)/[^/]+/dist/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      conditionNames: ["@event-desk/source", "import", "types", "default"],
      exportsFields: ["exports"],
      extensions: [".ts", ".tsx", ".js"],
    },
  },
};
