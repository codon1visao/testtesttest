/** Architecture rules (T3 §10). Paths are repository-relative; npm paths are pnpm real paths (the pattern matches the innermost node_modules segment). */
const npm = (names) => `(^|/)node_modules/(${names})/`;
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
      comment:
        "Contracts import only their own source and zod: no other package (npm, workspace via the source condition, or relative cross-package).",
      severity: "error",
      from: { path: "^packages/contracts/src", pathNot: TESTS },
      to: { pathNot: ["^packages/contracts/src/", npm("zod")] },
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
      name: "web-ui-uses-data-layer",
      comment: "Components use data-layer hooks; they never issue HTTP themselves (T1).",
      severity: "error",
      from: {
        path: "^apps/web/src/(features|shared|state)/|^apps/web/src/(app|routes|app-providers)\\.tsx$",
        pathNot: TESTS,
      },
      to: {
        path: [npm("axios"), "^apps/web/src/data/http/api-client\\.ts$", "^apps/web/src/data/api/"],
      },
    },
    {
      name: "web-data-layer-has-no-ui",
      comment: "The data layer holds no components, UI libraries or routing (T1, T3 §11).",
      severity: "error",
      from: { path: "^apps/web/src/data/", pathNot: TESTS },
      to: {
        path: ["^apps/web/src/(features|shared|state)/", npm("@astryxdesign/core|react-router")],
      },
    },
    {
      name: "web-state-holds-no-server-data",
      comment: "Zustand stores hold cross-panel UI state only; server data lives in React Query.",
      severity: "error",
      from: { path: "^apps/web/src/state/", pathNot: TESTS },
      to: { path: "^apps/web/src/data/" },
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
        pathNot: ["^apps/event-api/src/(persistence|repositories|scripts|testing)/", TESTS],
      },
      to: { path: npm("typeorm|mysql2") },
    },
    {
      name: "queue-and-redis-only-in-integrations",
      severity: "error",
      from: {
        path: "^apps/event-api/src",
        pathNot: ["^apps/event-api/src/(integrations|scripts|testing)/", TESTS],
      },
      to: { path: npm("bullmq|ioredis") },
    },
    {
      name: "services-use-ports",
      comment: "Modules depend on ports, never on adapters (T3 §11).",
      severity: "error",
      from: { path: "^apps/event-api/src/modules/", pathNot: TESTS },
      to: { path: "^apps/event-api/src/(repositories|integrations|persistence)/" },
    },
    {
      name: "domain-is-pure",
      comment:
        "Functional core: domain folders import only contracts, zod and other domain code (no services, adapters or Node core).",
      severity: "error",
      from: { path: "/domain/", pathNot: TESTS },
      to: { pathNot: ["/domain/", npm("zod"), "^packages/contracts/"] },
    },
    {
      name: "no-production-to-testing",
      comment:
        "Production code never imports test helpers, which are exempt from the adapter rules.",
      severity: "error",
      from: { path: "^apps/[^/]+/src/", pathNot: ["^apps/[^/]+/src/testing/", TESTS] },
      to: { path: "^apps/[^/]+/src/testing/" },
    },
    {
      name: "event-api-application-not-to-http",
      comment:
        "Services, domain code, ports and adapters never depend on HTTP or controllers (T3 §11).",
      severity: "error",
      from: {
        path: "^apps/event-api/src/(modules|ports|repositories|integrations|persistence|shared)/",
        pathNot: ["-controller\\.ts$", TESTS],
      },
      to: {
        path: ["^apps/event-api/src/http/", "-controller\\.ts$", "^apps/event-api/src/app\\.ts$"],
      },
    },
    {
      name: "event-api-ports-are-abstract",
      comment:
        "Ports declare contracts only: contracts, domain types, shared types and other ports.",
      severity: "error",
      from: { path: "^apps/event-api/src/ports/", pathNot: TESTS },
      to: {
        pathNot: [
          "^apps/event-api/src/ports/",
          "^packages/contracts/",
          "/domain/",
          "^apps/event-api/src/shared/",
        ],
      },
    },
    {
      name: "event-api-adapters-not-to-application",
      comment: "Adapters implement ports; they never call services, controllers or the HTTP layer.",
      severity: "error",
      from: {
        path: "^apps/event-api/src/(repositories|integrations|persistence)/",
        pathNot: TESTS,
      },
      to: { path: "^apps/event-api/src/(modules|http)/", pathNot: "/domain/" },
    },
    {
      name: "event-api-shared-is-leaf",
      comment: "shared/ holds cross-cutting primitives and depends on nothing else in the app.",
      severity: "error",
      from: { path: "^apps/event-api/src/shared/", pathNot: TESTS },
      to: {
        path: "^apps/event-api/src/(modules|ports|repositories|integrations|persistence|http|config|scripts)/",
      },
    },
    {
      name: "event-api-adapters-only-from-composition-root",
      comment:
        "Only compose.ts wires adapters. Adapters may use each other (repositories use persistence); scripts and test helpers build their own.",
      severity: "error",
      from: {
        path: "^apps/event-api/src/",
        pathNot: [
          "^apps/event-api/src/compose\\.ts$",
          "^apps/event-api/src/(repositories|integrations|persistence|scripts|testing)/",
          TESTS,
        ],
      },
      to: { path: "^apps/event-api/src/(repositories|integrations|persistence)/" },
    },
    {
      name: "event-api-persistence-is-lowest",
      comment:
        "persistence/ (entities, migrations, data source) sits below every other adapter; it may import ports, shared and contracts.",
      severity: "error",
      from: { path: "^apps/event-api/src/persistence/", pathNot: TESTS },
      to: {
        path: "^apps/event-api/src/(repositories|integrations|modules|http|app\\.ts|compose\\.ts|config)",
      },
    },
    {
      name: "event-api-config-is-leaf",
      comment:
        "config/ parses the environment; it may import only shared/ (log level type) and itself.",
      severity: "error",
      from: { path: "^apps/event-api/src/config/", pathNot: TESTS },
      to: {
        path: "^apps/event-api/src/",
        pathNot: "^apps/event-api/src/(shared|config)/",
      },
    },
    {
      name: "event-api-composition-root",
      comment: "Only main.ts and test helpers import the composition root.",
      severity: "error",
      from: {
        path: "^apps/event-api/src/",
        pathNot: ["^apps/event-api/src/main\\.ts$", "^apps/event-api/src/testing/", TESTS],
      },
      to: { path: "^apps/event-api/src/(main|compose)\\.ts$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(packages|apps)/[^/]+/dist/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      // No "types" condition: @astryxdesign/theme-neutral/theme.css maps it to a .d.ts that is not shipped; "node" keeps typeorm resolving without it.
      conditionNames: ["@event-desk/source", "import", "node", "default"],
      exportsFields: ["exports"],
      extensions: [".ts", ".tsx", ".js"],
    },
  },
};
