const SERVER_INFO = {
  name: "web-search-mcp",
  version: "0.1.0",
};

const PROTOCOL_VERSION = "2025-03-26";

const TOOLS = [
  {
    name: "web_search",
    description:
      "Search the web using DeepSeek's search-enabled chat. Returns a search-grounded response with up-to-date information.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        thinking: {
          type: "boolean",
          description: "Enable DeepSeek thinking/reasoning mode. When true, the model will reason through the query before answering, and the reasoning trace is included in the response. (default: false)",
          default: false,
        },
        model: {
          type: "string",
          enum: ["default", "expert"],
          description: "DeepSeek model mode (default: from server config)",
        },
      },
      required: ["query"],
    },
  },
];

class McpServer {
  constructor({ deepseekClient, log, output }) {
    this.client = deepseekClient;
    this.log = log || { debug() {}, info() {}, error() {} };
    this.output = output || process.stdout;
    this.initialized = false;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    process.stdin.on("data", (chunk) => this._onData(chunk));
    process.stdin.on("end", () => {
      this.log.debug("stdin ended");
      process.exit(0);
    });
    process.stdin.on("error", (err) => {
      this.log.error("stdin error:", err.message);
    });
    process.stdout.on("error", (err) => {
      this.log.error("stdout error:", err.message);
    });

    this.log.info(`${SERVER_INFO.name} v${SERVER_INFO.version} started`);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        break;
      }

      const headerStr = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!match) {
        this.log.error("Missing Content-Length header");
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.buffer.length < bodyStart + contentLength) {
        break; // wait for more data
      }

      const bodyBytes = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      let message;
      try {
        message = JSON.parse(bodyBytes.toString("utf8"));
      } catch {
        this._sendError(null, -32700, "Parse error");
        continue;
      }

      this._dispatch(message);
    }
  }

  _send(response) {
    const json = JSON.stringify(response);
    const bytes = Buffer.from(json, "utf8");
    const header = `Content-Length: ${bytes.length}\r\n\r\n`;
    this.output.write(header);
    this.output.write(bytes);
  }

  _sendError(id, code, message) {
    this._send({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message },
    });
  }

  _sendResult(id, result) {
    this._send({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  _dispatch(message) {
    const { id, method, params } = message;

    // Notifications (no id) - fire and forget
    if (id === undefined || id === null) {
      if (method === "notifications/initialized") {
        this.initialized = true;
        this.log.debug("Client initialized");
        return;
      }
      if (method === "notifications/cancelled") {
        this.log.debug("Cancel notification:", params?.requestId);
        return;
      }
      this.log.debug("Unknown notification:", method);
      return;
    }

    // Requests (have id) - need response
    if (!this.initialized && method !== "initialize") {
      this._sendError(id, -32600, "Server not initialized");
      return;
    }

    switch (method) {
      case "initialize":
        this._handleInitialize(id, params);
        break;
      case "ping":
        this._sendResult(id, {});
        break;
      case "tools/list":
        this._handleToolsList(id);
        break;
      case "tools/call":
        this._handleToolsCall(id, params);
        break;
      default:
        this._sendError(id, -32601, `Method not found: ${method}`);
        break;
    }
  }

  _handleInitialize(id, params) {
    this.log.debug("Initialize from:", params?.clientInfo?.name);
    this._sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: SERVER_INFO,
    });
  }

  _handleToolsList(id) {
    this._sendResult(id, { tools: TOOLS });
  }

  async _handleToolsCall(id, params) {
    const { name, arguments: args } = params || {};

    if (name !== "web_search") {
      this._sendResult(id, {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      });
      return;
    }

    const query = args?.query;
    if (!query || typeof query !== "string") {
      this._sendResult(id, {
        isError: true,
        content: [{ type: "text", text: "Error: 'query' parameter is required and must be a string" }],
      });
      return;
    }

    try {
      this.log.info(`Searching: ${query.slice(0, 100)}`);
      const result = await this.client.search(query, {
        modelType: args.model,
        thinkingEnabled: args.thinking,
      });

      const content = [];
      if (result.text) {
        content.push({ type: "text", text: result.text });
      }
      if (args.thinking && result.thinkingText) {
        content.push({ type: "text", text: `[Thinking]\n${result.thinkingText}` });
      }

      if (content.length === 0) {
        content.push({ type: "text", text: "No results returned from search." });
      }

      this._sendResult(id, { content });
    } catch (error) {
      this.log.error("Search error:", error.message);
      this._sendResult(id, {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }],
      });
    }
  }
}

module.exports = { McpServer };
