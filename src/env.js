const fs = require("node:fs");
const path = require("node:path");

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(content) {
  const entries = [];
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const name = normalizedLine.slice(0, separatorIndex).trim();
    if (!name) {
      continue;
    }

    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    entries.push([name, stripWrappingQuotes(rawValue)]);
  }

  return entries;
}

function resolveConfigPath(explicitPath, projectRoot = path.resolve(__dirname, "..")) {
  const candidate = explicitPath || process.env.CONFIG_PATH || ".env";
  return path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
}

function loadEnvFile(filePath, options = {}) {
  const { override = false } = options;
  if (!fs.existsSync(filePath)) {
    return {
      loaded: false,
      path: filePath,
      injectedKeys: [],
    };
  }

  const content = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  const entries = parseEnvFile(content);
  const injectedKeys = [];

  for (const [name, value] of entries) {
    if (!override && Object.prototype.hasOwnProperty.call(process.env, name)) {
      continue;
    }

    process.env[name] = value;
    injectedKeys.push(name);
  }

  return {
    loaded: true,
    path: filePath,
    injectedKeys,
  };
}

function loadProjectEnv(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..");
  const configPath = resolveConfigPath(options.configPath, projectRoot);
  return loadEnvFile(configPath, options);
}

module.exports = {
  loadEnvFile,
  loadProjectEnv,
  parseEnvFile,
  resolveConfigPath,
};
