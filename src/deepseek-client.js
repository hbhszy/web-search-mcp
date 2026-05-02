const DEEPSEEK_BASE_URL = "https://chat.deepseek.com/api/v0";

function normalizeBearerToken(token) {
  if (!token) {
    return "";
  }

  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function deepseekError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort);
  });
}

class DeepSeekWebClient {
  constructor(options) {
    this.authToken = options.authToken || "";
    this.cookie = options.cookie || "";
    this.locale = options.locale || "zh_CN";
    this.clientVersion = options.clientVersion || "1.8.0";
    this.appVersion = options.appVersion || "20241129.1";
    this.userAgent =
      options.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
    this.extraHeaders = options.extraHeaders || {};
    this.retryAttempts = Number(options.retryAttempts) || 2;
    this.retryBaseDelayMs = Number(options.retryBaseDelayMs) || 500;
    this.defaultModelType = options.defaultModelType || "default";
    this.defaultThinkingEnabled = options.defaultThinkingEnabled ?? false;
    this.powSolver = options.powSolver;
    this.log = options.log || { debug() {}, info() {}, error() {} };
  }

  isRetriableError(error) {
    if (!error || error.name === "AbortError") {
      return false;
    }

    if (typeof error.status === "number") {
      return error.status >= 500;
    }

    return true;
  }

  async withRetries(operation, options = {}) {
    const signal = options.signal;
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetriableError(error) || attempt >= this.retryAttempts) {
          throw error;
        }

        attempt += 1;
        const delay = this.retryBaseDelayMs * 2 ** (attempt - 1);
        this.log.debug(`Retrying after ${delay}ms (attempt ${attempt})`);
        await sleep(delay, signal);
      }
    }
  }

  buildHeaders({ powResponse, refererSessionId, contentType = "application/json" } = {}) {
    const headers = {
      accept: "*/*",
      "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      origin: "https://chat.deepseek.com",
      referer: refererSessionId
        ? `https://chat.deepseek.com/a/chat/s/${refererSessionId}`
        : "https://chat.deepseek.com/",
      "user-agent": this.userAgent,
      "x-app-version": this.appVersion,
      "x-client-locale": this.locale,
      "x-client-platform": "web",
      "x-client-timezone-offset": "28800",
      "x-client-version": this.clientVersion,
      ...this.extraHeaders,
    };

    if (contentType) {
      headers["content-type"] = contentType;
    }

    if (this.authToken) {
      headers.authorization = normalizeBearerToken(this.authToken);
    }

    if (this.cookie) {
      headers.cookie = this.cookie;
    }

    if (powResponse) {
      headers["x-ds-pow-response"] = powResponse;
    }

    return headers;
  }

  async parseJsonResponse(response) {
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const hint =
        text && text.includes("Just a moment")
          ? " Cloudflare challenge detected. A fresh browser session, token, or cookie may be required."
          : "";
      throw deepseekError(
        `DeepSeek request failed with ${response.status}.${hint}`,
        {
          status: response.status,
          body: text,
          json,
        },
      );
    }

    return json;
  }

  async requestJson(pathname, payload, options = {}) {
    return this.withRetries(async () => {
      const response = await fetch(`${DEEPSEEK_BASE_URL}${pathname}`, {
        method: options.method || "POST",
        headers: this.buildHeaders({
          powResponse: options.powResponse,
          refererSessionId: options.refererSessionId,
        }),
        body: payload == null ? undefined : JSON.stringify(payload),
        signal: options.signal,
      });

      return this.parseJsonResponse(response);
    }, options);
  }

  async createChatSession(signal) {
    const json = await this.requestJson(
      "/chat_session/create",
      {},
      { signal },
    );

    const sessionId =
      json?.data?.biz_data?.chat_session?.id || json?.data?.biz_data?.id;

    if (!sessionId) {
      throw deepseekError("DeepSeek chat_session/create returned no session id", {
        body: json,
      });
    }

    return sessionId;
  }

  async deleteChatSession(chatSessionId, signal) {
    if (!chatSessionId) {
      return;
    }

    await this.requestJson(
      "/chat_session/delete",
      { chat_session_id: chatSessionId },
      { signal, refererSessionId: chatSessionId },
    );
  }

  async getPowChallenge(targetPath = "/api/v0/chat/completion", signal, refererSessionId) {
    const json = await this.requestJson(
      "/chat/create_pow_challenge",
      { target_path: targetPath },
      { signal, refererSessionId },
    );

    const challenge = json?.data?.biz_data?.challenge;
    if (!challenge) {
      throw deepseekError("DeepSeek create_pow_challenge returned no challenge", {
        body: json,
      });
    }

    return challenge;
  }

  async streamChat({
    chatSessionId,
    parentMessageId,
    prompt,
    modelType,
    thinkingEnabled,
    searchEnabled,
    signal,
  }) {
    const challenge = await this.getPowChallenge(
      "/api/v0/chat/completion",
      signal,
      chatSessionId,
    );
    const powResponse = await this.powSolver.solveChallenge(challenge);

    const body = {
      chat_session_id: chatSessionId,
      parent_message_id: parentMessageId ?? null,
      model_type: modelType || "default",
      prompt,
      ref_file_ids: [],
      thinking_enabled: Boolean(thinkingEnabled),
      search_enabled: Boolean(searchEnabled),
      preempt: false,
    };

    this.log.debug("streamChat request:", JSON.stringify({ ...body, prompt: body.prompt.slice(0, 100) + "..." }));

    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completion`, {
      method: "POST",
      headers: this.buildHeaders({
        powResponse,
        refererSessionId: chatSessionId,
      }),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      throw deepseekError(`DeepSeek completion failed with ${response.status}`, {
        status: response.status,
        body: text,
      });
    }

    const state = {
      requestMessageId: null,
      responseMessageId: null,
      title: null,
      text: "",
      thinkingText: "",
      totalTokens: 0,
      currentFragmentType: "response",
      modelType: modelType || "default",
      searchResults: [],
    };

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let eventName = "";
    let dataLines = [];

    const emitContent = (value) => {
      if (typeof value !== "string" || !value) {
        return;
      }

      if (state.currentFragmentType === "thinking") {
        state.thinkingText += value;
        return;
      }

      state.text += value;
    };

    const applyFragment = (fragment) => {
      if (!fragment || typeof fragment !== "object") {
        return;
      }

      if (typeof fragment.type === "string") {
        state.currentFragmentType =
          fragment.type === "THINK" ? "thinking" : "response";
      }

      if (typeof fragment.content === "string" && fragment.content) {
        emitContent(fragment.content);
      }
    };

    const applyPatchList = (patches) => {
      for (const patch of patches) {
        if (patch?.p === "accumulated_token_usage") {
          state.totalTokens = Number(patch.v) || 0;
        }
      }
    };

    const handlePayload = (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.v?.response) {
        const responseInfo = payload.v.response;
        if (responseInfo.message_id != null) {
          state.responseMessageId = responseInfo.message_id;
        }

        if (Array.isArray(responseInfo.fragments)) {
          for (const fragment of responseInfo.fragments) {
            applyFragment(fragment);
          }
        }

        if (typeof responseInfo.accumulated_token_usage === "number") {
          state.totalTokens = responseInfo.accumulated_token_usage;
        }
      }

      if (
        payload.p === "response/fragments" &&
        payload.o === "APPEND" &&
        Array.isArray(payload.v)
      ) {
        for (const fragment of payload.v) {
          applyFragment(fragment);
        }
        return;
      }

      if (
        payload.p === "response/fragments/-1/content" &&
        typeof payload.v === "string"
      ) {
        emitContent(payload.v);
        return;
      }

      if (
        payload.p === "response/fragments/-1/results" &&
        Array.isArray(payload.v)
      ) {
        state.searchResults.push(...payload.v);
        return;
      }

      if (payload.p === "response" && payload.o === "BATCH" && Array.isArray(payload.v)) {
        applyPatchList(payload.v);
        return;
      }

      if (payload.p === "response/status" && payload.v === "FINISHED") {
        return;
      }

      if (typeof payload.v === "string" && !payload.p) {
        emitContent(payload.v);
      }
    };

    const flushEvent = () => {
      if (dataLines.length === 0) {
        eventName = "";
        return;
      }

      const activeEventName = eventName || "message";
      const data = dataLines.join("\n");
      dataLines = [];

      if (data === "[DONE]") {
        eventName = "";
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        eventName = "";
        return;
      }

      if (eventName === "ready") {
        if (parsed.request_message_id != null) {
          state.requestMessageId = parsed.request_message_id;
        }
        if (parsed.response_message_id != null) {
          state.responseMessageId = parsed.response_message_id;
        }
        if (typeof parsed.model_type === "string" && parsed.model_type) {
          state.modelType = parsed.model_type;
        }
        eventName = "";
        return;
      }

      if (eventName === "title") {
        if (typeof parsed.content === "string") {
          state.title = parsed.content;
        }
        eventName = "";
        return;
      }

      if (eventName === "close") {
        eventName = "";
        return;
      }

      handlePayload(parsed);
      eventName = "";
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let separatorIndex;
        while ((separatorIndex = buffer.indexOf("\n")) >= 0) {
          const rawLine = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 1);
          const line = rawLine.endsWith("\r")
            ? rawLine.slice(0, -1)
            : rawLine;

          if (line === "") {
            flushEvent();
            continue;
          }

          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }

          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }

      flushEvent();
      return state;
    } finally {
      reader.releaseLock();
    }
  }

  async search(query, { modelType, thinkingEnabled, signal } = {}) {
    let sessionId = null;
    try {
      sessionId = await this.createChatSession(signal);
      this.log.debug("Created chat session:", sessionId);

      const state = await this.streamChat({
        chatSessionId: sessionId,
        prompt: query,
        modelType: modelType || this.defaultModelType,
        thinkingEnabled: thinkingEnabled ?? this.defaultThinkingEnabled,
        searchEnabled: true,
        signal,
      });

      this.log.debug("Search completed, tokens:", state.totalTokens);

      return {
        text: state.text,
        thinkingText: state.thinkingText,
        totalTokens: state.totalTokens,
        modelType: state.modelType,
        searchResults: state.searchResults,
      };
    } finally {
      if (sessionId) {
        try {
          await this.deleteChatSession(sessionId, signal);
          this.log.debug("Deleted chat session:", sessionId);
        } catch (cleanupError) {
          this.log.debug("Failed to delete session:", cleanupError.message);
        }
      }
    }
  }
}

module.exports = {
  DeepSeekWebClient,
  deepseekError,
};
