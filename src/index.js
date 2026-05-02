const { loadProjectEnv } = require("./env");
const { createConfig } = require("./config");
const { DeepSeekPowSolver } = require("./pow-solver");
const { DeepSeekWebClient } = require("./deepseek-client");
const { McpServer } = require("./mcp-server");

function createLogger(level) {
  const levels = { debug: 0, info: 1, error: 2 };
  const threshold = levels[level] ?? 1;
  return {
    debug: (...args) => {
      if (threshold <= 0) process.stderr.write(`[DEBUG] ${args.join(" ")}\n`);
    },
    info: (...args) => {
      if (threshold <= 1) process.stderr.write(`[INFO]  ${args.join(" ")}\n`);
    },
    error: (...args) => {
      if (threshold <= 2) process.stderr.write(`[ERROR] ${args.join(" ")}\n`);
    },
  };
}

async function main() {
  loadProjectEnv();

  const config = createConfig();
  const log = createLogger(config.logLevel);

  const powSolver = new DeepSeekPowSolver({ wasmPath: config.wasmPath });
  await powSolver.init();
  log.debug("WASM PoW solver initialized");

  const client = new DeepSeekWebClient({
    authToken: config.authToken,
    cookie: config.cookie,
    defaultModelType: config.modelType,
    defaultThinkingEnabled: config.thinkingEnabled,
    powSolver,
    log,
  });

  const server = new McpServer({ deepseekClient: client, log });
  server.start();

  process.on("SIGINT", () => {
    log.info("Shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("Shutting down...");
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`[FATAL] ${error.message}\n`);
  process.exit(1);
});
