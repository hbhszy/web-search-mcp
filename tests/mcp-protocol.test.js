const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");

const { McpServer } = require("../src/mcp-server");

function createTestServer() {
  const chunks = [];
  const output = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  const mockClient = {
    search: async () => ({ text: "mock result", thinkingText: "", totalTokens: 0 }),
  };

  const server = new McpServer({
    deepseekClient: mockClient,
    log: { debug() {}, info() {}, error() {} },
    output,
  });

  function getMessages() {
    return Buffer.concat(chunks)
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  function reset() {
    chunks.length = 0;
  }

  function send(message) {
    const json = JSON.stringify(message);
    server._onData(Buffer.from(`${json}\n`));
  }

  return { server, send, getMessages, reset };
}

describe("McpServer protocol", () => {
  it("should respond to initialize with capabilities", () => {
    const { send, getMessages } = createTestServer();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].jsonrpc, "2.0");
    assert.equal(messages[0].id, 1);
    assert.equal(messages[0].result.protocolVersion, "2025-03-26");
    assert.deepEqual(messages[0].result.capabilities, { tools: {} });
    assert.equal(messages[0].result.serverInfo.name, "web-search-mcp");
  });

  it("should reject tools/list before initialization", () => {
    const { send, getMessages } = createTestServer();
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].error.code, -32600);
  });

  it("should return tools after initialization", () => {
    const { server, send, getMessages, reset } = createTestServer();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    reset();

    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, 2);
    const tools = messages[0].result.tools;
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "web_search");
    assert.ok(tools[0].inputSchema.properties.query);
    assert.deepEqual(tools[0].inputSchema.required, ["query"]);
  });

  it("should handle ping", () => {
    const { send, getMessages, reset } = createTestServer();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    reset();

    send({ jsonrpc: "2.0", id: 3, method: "ping" });

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].result, {});
  });

  it("should return error for unknown method", () => {
    const { send, getMessages, reset } = createTestServer();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    reset();

    send({ jsonrpc: "2.0", id: 4, method: "unknown/method" });

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].error.code, -32601);
  });

  it("should handle tools/call with web_search", async () => {
    const { send, getMessages, reset } = createTestServer();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    reset();

    send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "test query" } },
    });

    await new Promise((r) => setTimeout(r, 50));

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, 5);
    assert.ok(messages[0].result.content);
    assert.equal(messages[0].result.content[0].text, "mock result");
  });

  it("should return error for missing query", async () => {
    const { send, getMessages, reset } = createTestServer();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    reset();

    send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "web_search", arguments: {} },
    });

    await new Promise((r) => setTimeout(r, 50));

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, 6);
    assert.equal(messages[0].result.isError, true);
    assert.ok(messages[0].result.content[0].text.includes("query"));
  });

  it("should return error for unknown tool", async () => {
    const { send, getMessages, reset } = createTestServer();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    reset();

    send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "unknown_tool", arguments: {} },
    });

    await new Promise((r) => setTimeout(r, 50));

    const messages = getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].result.isError, true);
    assert.ok(messages[0].result.content[0].text.includes("Unknown tool"));
  });
});
