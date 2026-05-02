const path = require("node:path");

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseDeepSeekModelType(value, fallback = "default") {
  if (!value) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["default", "expert"].includes(normalized)) {
    return normalized;
  }
  if (["normal", "standard"].includes(normalized)) {
    return "default";
  }

  return fallback;
}

function createConfig() {
  const authToken = (process.env.DEEPSEEK_AUTH_TOKEN || "").trim();
  const cookie = (process.env.DEEPSEEK_COOKIE || "").trim();

  if (!authToken && !cookie) {
    throw new Error(
      "At least one of DEEPSEEK_AUTH_TOKEN or DEEPSEEK_COOKIE must be set. " +
      "Copy .env.example to .env and fill in your credentials."
    );
  }

  const wasmPath = process.env.WASM_PATH
    ? path.resolve(process.env.WASM_PATH)
    : path.join(__dirname, "..", "assets", "sha3_wasm_bg.7b9ca65ddd.wasm");

  return {
    authToken,
    cookie,
    modelType: parseDeepSeekModelType(process.env.DEEPSEEK_MODEL_TYPE, "default"),
    thinkingEnabled: parseBoolean(process.env.DEEPSEEK_THINKING_ENABLED, false),
    searchEnabled: true,
    wasmPath,
    logLevel: (process.env.LOG_LEVEL || "info").trim().toLowerCase(),
  };
}

module.exports = { createConfig };
