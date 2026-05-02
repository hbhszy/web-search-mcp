const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("createConfig", () => {
  const savedEnv = {};

  function saveEnv(keys) {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  function restoreEnv() {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  beforeEach(() => {
    saveEnv([
      "DEEPSEEK_AUTH_TOKEN",
      "DEEPSEEK_COOKIE",
      "DEEPSEEK_MODEL_TYPE",
      "DEEPSEEK_THINKING_ENABLED",
      "DEEPSEEK_SEARCH_ENABLED",
      "WASM_PATH",
      "LOG_LEVEL",
    ]);
  });

  afterEach(() => {
    restoreEnv();
  });

  it("should throw when no credentials are set", () => {
    const { createConfig } = require("../src/config");
    assert.throws(() => createConfig(), /DEEPSEEK_AUTH_TOKEN.*DEEPSEEK_COOKIE/);
  });

  it("should accept auth token", () => {
    process.env.DEEPSEEK_AUTH_TOKEN = "test-token";
    const { createConfig } = require("../src/config");
    const config = createConfig();
    assert.equal(config.authToken, "test-token");
    assert.equal(config.modelType, "default");
    assert.equal(config.thinkingEnabled, false);
    assert.equal(config.searchEnabled, true);
    assert.equal(config.logLevel, "info");
  });

  it("should accept cookie as alternative", () => {
    process.env.DEEPSEEK_COOKIE = "session=abc123";
    const { createConfig } = require("../src/config");
    const config = createConfig();
    assert.equal(config.cookie, "session=abc123");
  });

  it("should parse model type", () => {
    process.env.DEEPSEEK_AUTH_TOKEN = "x";
    process.env.DEEPSEEK_MODEL_TYPE = "expert";
    const { createConfig } = require("../src/config");
    assert.equal(createConfig().modelType, "expert");
  });

  it("should parse boolean thinking enabled", () => {
    process.env.DEEPSEEK_AUTH_TOKEN = "x";
    process.env.DEEPSEEK_THINKING_ENABLED = "true";
    const { createConfig } = require("../src/config");
    assert.equal(createConfig().thinkingEnabled, true);
  });

  it("should parse custom log level", () => {
    process.env.DEEPSEEK_AUTH_TOKEN = "x";
    process.env.LOG_LEVEL = "debug";
    const { createConfig } = require("../src/config");
    assert.equal(createConfig().logLevel, "debug");
  });
});
