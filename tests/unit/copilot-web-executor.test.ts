import test from "node:test";
import assert from "node:assert/strict";

const { CopilotWebExecutor, getCopilotMode, extractAccessToken, sessionPoolKey, solveHashcash } =
  await import("../../open-sse/executors/copilot-web.ts");

test("getCopilotMode maps known models to their Copilot modes", () => {
  assert.equal(getCopilotMode("copilot"), "chat");
  assert.equal(getCopilotMode("gpt-4o"), "chat");
  assert.equal(getCopilotMode("copilot-think"), "reasoning");
  assert.equal(getCopilotMode("o1"), "reasoning");
  assert.equal(getCopilotMode("copilot-smart"), "smart");
  assert.equal(getCopilotMode("gpt-5"), "smart");
});

test("getCopilotMode defaults to chat for unknown or missing models", () => {
  assert.equal(getCopilotMode("unknown-model"), "chat");
  assert.equal(getCopilotMode(undefined), "chat");
  assert.equal(getCopilotMode(""), "chat");
});

test("getCopilotMode is case-insensitive", () => {
  assert.equal(getCopilotMode("GPT-4O"), "chat");
  assert.equal(getCopilotMode("Copilot-Think"), "reasoning");
});

test("extractAccessToken returns direct JWT tokens", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9." + "x".repeat(200);
  assert.equal(extractAccessToken(jwt), jwt);
});

test("extractAccessToken extracts token from cookie string", () => {
  const token = "abc123token";
  assert.equal(extractAccessToken(`session=xyz; access_token=${token}; other=1`), token);
});

test("extractAccessToken extracts Bearer token from Authorization header", () => {
  const token = "my-bearer-token";
  assert.equal(extractAccessToken(`Bearer ${token}`), token);
});

test("extractAccessToken returns null for empty input", () => {
  assert.equal(extractAccessToken(""), null);
});

test("sessionPoolKey produces unique keys per token preventing session sharing", () => {
  const key1 = sessionPoolKey("token-user-alice");
  const key2 = sessionPoolKey("token-user-bob");
  assert.notEqual(key1, key2);
});

test("sessionPoolKey is deterministic for same token", () => {
  const token = "stable-access-token";
  assert.equal(sessionPoolKey(token), sessionPoolKey(token));
});

test("sessionPoolKey for undefined returns 'anonymous'", () => {
  assert.equal(sessionPoolKey(undefined), "anonymous");
  assert.equal(sessionPoolKey(), "anonymous");
});

test("sessionPoolKey never returns 'default' (security regression guard)", () => {
  assert.notEqual(sessionPoolKey("any-token"), "default");
  assert.notEqual(sessionPoolKey(undefined), "default");
});

test("sessionPoolKey returns the token verbatim for any non-empty input", () => {
  // After CodeQL #245/#246/#247: we no longer hash the token at all (any hash
  // of a credential-named parameter re-triggers js/insufficient-password-hash,
  // and bcrypt/scrypt/argon2 would be inappropriate for a high-entropy bearer
  // used only as an in-memory Map key). The Map is bounded by MAX_POOL_SIZE
  // with LRU eviction, and the token is already held in CopilotSession.cookies
  // for each entry — so keying the Map by the token itself exposes nothing
  // the process did not already hold.
  assert.equal(sessionPoolKey("test-token"), "test-token");
  assert.equal(sessionPoolKey("a"), "a");
  assert.equal(sessionPoolKey("x".repeat(1024)), "x".repeat(1024));
});

test("sessionPoolKey treats an empty string the same as undefined", () => {
  assert.equal(sessionPoolKey(""), "anonymous");
});

test("sessionPoolKey output is not a SHA-256 prefix of the token (regression guard)", () => {
  // If anyone re-introduces createHash/createHmac on the token, the alert
  // resurfaces — this guard catches it before CodeQL does.
  const token = "regression-guard-token";
  const plainSha256Prefix =
    "5dd8c5e63dbfd4ccb09362efce82bcc3f5d2bb37f8f1cce03f47d7e57b1b1ec3".slice(0, 16);
  assert.notEqual(sessionPoolKey(token), plainSha256Prefix);
});

// solveHashcash difficulty bounds — CodeQL js/resource-exhaustion #244 guard.
test("solveHashcash rejects out-of-range difficulty to avoid resource exhaustion", () => {
  // Negative, zero, fractional, NaN, Infinity, and >8 must short-circuit.
  assert.equal(solveHashcash("param", 0), null);
  assert.equal(solveHashcash("param", -1), null);
  assert.equal(solveHashcash("param", 1.5), null);
  assert.equal(solveHashcash("param", Number.NaN), null);
  assert.equal(solveHashcash("param", Number.POSITIVE_INFINITY), null);
  assert.equal(solveHashcash("param", 9), null);
  assert.equal(solveHashcash("param", 1_000_000), null);
});

test("solveHashcash succeeds for difficulty=1 (a single leading zero is common)", () => {
  // ~1 in 16 chance of leading "0" — well within the 10M iteration budget.
  const result = solveHashcash("any-parameter", 1);
  assert.ok(typeof result === "number" && result >= 0, "expected a numeric nonce");
});

test("CopilotWebExecutor keeps personal Copilot start and chat protocol separate from M365", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  class MockWebSocket {
    static urls: string[] = [];
    static sent: string[] = [];

    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string) {
      MockWebSocket.urls.push(url);
      queueMicrotask(() => this.onopen?.());
    }

    send(data: string) {
      MockWebSocket.sent.push(data);
      queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ event: "appendText", text: "personal reply" }) })
      );
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ event: "done" }) }));
    }

    close() {
      this.onclose?.();
    }
  }

  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ conversationId: "personal-conversation-1", remainingTurns: 100 }),
      text: async () => "",
      headers: {
        getSetCookie: () => ["MC1=personal-cookie; Path=/"],
      },
    };
  }) as typeof fetch;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

  try {
    const executor = new CopilotWebExecutor();
    const result = await executor.execute({
      model: "copilot",
      body: { messages: [{ role: "user", content: "hello personal copilot" }] },
      stream: false,
      credentials: { apiKey: "personal-access-token-for-regression" },
      signal: null,
    });

    assert.equal(result.response.status, 200);
    const body = (await result.response.clone().json()) as any;
    assert.equal(body.choices[0].message.content, "personal reply");

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://copilot.microsoft.com/c/api/start");
    assert.equal(fetchCalls[0].init?.method, "POST");
    assert.equal(
      (fetchCalls[0].init?.headers as Record<string, string>).Authorization,
      "Bearer personal-access-token-for-regression"
    );

    assert.equal(MockWebSocket.urls.length, 1);
    const wsUrl = new URL(MockWebSocket.urls[0]);
    assert.equal(wsUrl.origin, "wss://copilot.microsoft.com");
    assert.equal(wsUrl.pathname, "/c/api/chat");
    assert.equal(wsUrl.searchParams.get("api-version"), "2");
    assert.equal(wsUrl.searchParams.has("access_token"), false);

    const sentFrame = JSON.parse(MockWebSocket.sent[0]);
    assert.equal(sentFrame.event, "send");
    assert.equal(sentFrame.conversationId, "personal-conversation-1");
    assert.deepEqual(sentFrame.content, [{ type: "text", text: "hello personal copilot" }]);
    assert.equal(sentFrame.mode, "chat");
    assert.equal(result.url, "wss://copilot.microsoft.com/c/api/chat?api-version=2");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
