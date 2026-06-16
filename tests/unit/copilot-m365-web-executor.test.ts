import test from "node:test";
import assert from "node:assert/strict";

import {
  __setM365CopilotWebSocketTransportForTesting,
  buildM365CopilotChathubUrl,
  CopilotM365WebExecutor,
  extractM365CopilotAccessToken,
  isM365CopilotTokenPayload,
  m365BizChatEventsToOpenAIJson,
  m365BizChatEventsToOpenAISse,
  parseM365BizChatResponseFrames,
  parseM365CopilotJwt,
  serializeM365BizChatSendFrame,
} from "../../open-sse/executors/copilot-m365-web.ts";

function encodeBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(payload: Record<string, unknown>): string {
  return [
    encodeBase64Url({ alg: "none", typ: "JWT" }),
    encodeBase64Url(payload),
    "fake-signature",
  ].join(".");
}

const validTokenPayload = {
  aud: "https://substrate.office.com/sydney",
  exp: Math.floor(Date.now() / 1000) + 3600,
  oid: "user-oid-123",
  tid: "tenant-tid-456",
};

const validJwt = makeJwt(validTokenPayload);

async function assertNoTokenLeak(
  result: {
    response: Response;
    url: string;
    headers: Record<string, string>;
    transformedBody: unknown;
  },
  token: string
) {
  const bodyText = await result.response.clone().text();
  assert.ok(!bodyText.includes(token), "response body must not contain raw JWT");
  assert.ok(!result.url.includes(token), "reported URL must not contain raw JWT");
  assert.ok(!JSON.stringify(result.headers).includes(token), "headers must not contain raw JWT");
  assert.ok(
    !JSON.stringify(result.transformedBody).includes(token),
    "transformedBody must not contain raw JWT"
  );
}

test("extractM365CopilotAccessToken accepts supported browser token surfaces", () => {
  assert.equal(extractM365CopilotAccessToken(validJwt), validJwt);
  assert.equal(extractM365CopilotAccessToken(`access_token=${validJwt}`), validJwt);
  assert.equal(extractM365CopilotAccessToken(`Authorization: Bearer ${validJwt}`), validJwt);

  const websocketUrl =
    "wss://substrate.svc.cloud.microsoft/m365Copilot/Chathub" +
    `/user-oid-123@tenant-tid-456?access_token=${validJwt}&X-SessionId=session-1`;
  assert.equal(extractM365CopilotAccessToken(websocketUrl), validJwt);
});

test("parseM365CopilotJwt validates M365 Substrate token claims", () => {
  assert.deepEqual(parseM365CopilotJwt(validJwt), validTokenPayload);
  assert.equal(isM365CopilotTokenPayload(validTokenPayload), true);

  assert.throws(
    () =>
      parseM365CopilotJwt(makeJwt({ ...validTokenPayload, aud: "https://copilot.microsoft.com" })),
    /M365 Copilot\/Substrate token/i
  );
  assert.throws(
    () =>
      parseM365CopilotJwt(
        makeJwt({ ...validTokenPayload, exp: Math.floor(Date.now() / 1000) - 60 })
      ),
    /expired|re-auth/i
  );
  assert.throws(
    () =>
      parseM365CopilotJwt(
        makeJwt({ ...validTokenPayload, exp: Math.floor(Date.now() / 1000) + 30 })
      ),
    /expired|re-auth/i
  );
  assert.throws(
    () =>
      parseM365CopilotJwt(
        makeJwt({ ...validTokenPayload, oid: undefined, upn: "user@example.com" })
      ),
    /user identity/i
  );
  assert.throws(
    () =>
      parseM365CopilotJwt(makeJwt({ ...validTokenPayload, tid: undefined, tenantId: "tenant" })),
    /tenant identity/i
  );
});

test("buildM365CopilotChathubUrl separates connection URL from loggable redacted URL", () => {
  const built = buildM365CopilotChathubUrl({
    token: validJwt,
    payload: validTokenPayload,
    chatSessionId: "chat-session-1",
    clientRequestId: "client-request-1",
    conversationId: "conversation-1",
    xSessionId: "x-session-1",
  });

  const url = new URL(built.url);
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "substrate.svc.cloud.microsoft");
  assert.equal(url.pathname, "/m365Copilot/Chathub/user-oid-123@tenant-tid-456");
  assert.equal(url.searchParams.get("access_token"), validJwt);
  assert.equal(url.searchParams.get("chatsessionid"), "chat-session-1");
  assert.equal(url.searchParams.get("clientrequestid"), "client-request-1");
  assert.equal(url.searchParams.get("ConversationId"), "conversation-1");
  assert.equal(url.searchParams.get("X-SessionId"), "x-session-1");

  assert.ok(!built.loggableUrl.includes(validJwt));
  assert.match(built.loggableUrl, /access_token=<redacted>/);
});

test("serializeM365BizChatSendFrame converts latest usable user message to minimal BizChat frame", () => {
  const frameText = serializeM365BizChatSendFrame({
    body: {
      messages: [
        { role: "user", content: "ignored earlier prompt" },
        { role: "assistant", content: "earlier answer" },
        { role: "user", content: [{ type: "text", text: "Hello M365" }] },
      ],
    },
    payload: validTokenPayload,
    conversationId: "conversation-1",
    clientRequestId: "client-request-1",
  });

  assert.ok(frameText.endsWith("\x1e"));
  const frame = JSON.parse(frameText.slice(0, -1));
  assert.equal(frame.type, 1);
  assert.equal(frame.target, "sendMessage");
  assert.equal(frame.arguments[0].conversationId, "conversation-1");
  assert.equal(frame.arguments[0].requestId, "client-request-1");
  assert.equal(frame.arguments[0].participant.oid, "user-oid-123");
  assert.equal(frame.arguments[0].participant.tid, "tenant-tid-456");
  assert.equal(frame.arguments[0].message.text, "Hello M365");
});

test("serializeM365BizChatSendFrame rejects requests without a usable user message", () => {
  assert.throws(
    () =>
      serializeM365BizChatSendFrame({
        body: { messages: [{ role: "system", content: "only system" }] },
        payload: validTokenPayload,
        conversationId: "conversation-1",
        clientRequestId: "client-request-1",
      }),
    /No usable user message/i
  );
});

test("parseM365BizChatResponseFrames handles text, done, and error frames with OpenAI conversions", () => {
  const rawFrames = [
    JSON.stringify({
      type: 1,
      target: "update",
      arguments: [{ messages: [{ author: "bot", text: "Hello " }] }],
    }),
    JSON.stringify({
      type: 1,
      target: "update",
      arguments: [{ message: { author: "bot", text: "M365" } }],
    }),
    JSON.stringify({ type: 3, result: { status: "completed" } }),
  ].join("\x1e");

  const events = parseM365BizChatResponseFrames(`${rawFrames}\x1e`);
  assert.deepEqual(events, [
    { kind: "text", text: "Hello " },
    { kind: "text", text: "M365" },
    { kind: "done" },
  ]);

  const sse = m365BizChatEventsToOpenAISse(events, "copilot-m365-web");
  assert.match(sse, /chat\.completion\.chunk/);
  assert.match(sse, /"content":"Hello "/);
  assert.match(sse, /"finish_reason":"stop"/);
  assert.ok(sse.trim().endsWith("data: [DONE]"));

  const json = m365BizChatEventsToOpenAIJson(events, "copilot-m365-web") as any;
  assert.equal(json.object, "chat.completion");
  assert.equal(json.choices[0].message.content, "Hello M365");
  assert.equal(json.choices[0].finish_reason, "stop");

  const errorEvents = parseM365BizChatResponseFrames(
    `${JSON.stringify({ type: 1, target: "error", arguments: [{ message: "tenant blocked request" }] })}\x1e`
  );
  assert.deepEqual(errorEvents, [{ kind: "error", message: "tenant blocked request" }]);
});

test("CopilotM365WebExecutor.execute returns sanitized client errors for missing prompt and expired token", async () => {
  const executor = new CopilotM365WebExecutor();

  const missingPrompt = await executor.execute({
    model: "copilot-m365-web",
    body: { messages: [{ role: "system", content: "only system" }] },
    stream: false,
    credentials: { apiKey: validJwt },
    signal: null,
  });
  assert.equal(missingPrompt.response.status, 400);
  assert.match(
    ((await missingPrompt.response.clone().json()) as any).error.message,
    /No usable user message/i
  );
  await assertNoTokenLeak(missingPrompt, validJwt);

  const expiredJwt = makeJwt({ ...validTokenPayload, exp: Math.floor(Date.now() / 1000) - 60 });
  const expired = await executor.execute({
    model: "copilot-m365-web",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: { apiKey: expiredJwt },
    signal: null,
  });
  assert.equal(expired.response.status, 401);
  assert.match(((await expired.response.clone().json()) as any).error.message, /expired|re-auth/i);
  await assertNoTokenLeak(expired, expiredJwt);
});

test("CopilotM365WebExecutor.execute translates non-streaming and streaming WebSocket responses", async () => {
  const sentFrames: string[] = [];
  __setM365CopilotWebSocketTransportForTesting(async ({ frame }) => {
    sentFrames.push(frame);
    return [
      JSON.stringify({ type: 1, target: "update", arguments: [{ message: { text: "Hello" } }] }),
      JSON.stringify({ type: 1, target: "update", arguments: [{ message: { text: " M365" } }] }),
      JSON.stringify({ type: 3, result: { status: "completed" } }),
    ].join("\x1e");
  });

  try {
    const executor = new CopilotM365WebExecutor();
    const baseInput = {
      model: "copilot-m365-web",
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: validJwt },
      signal: null,
    };

    const jsonResult = await executor.execute({ ...baseInput, stream: false });
    assert.equal(jsonResult.response.status, 200);
    const json = (await jsonResult.response.clone().json()) as any;
    assert.equal(json.choices[0].message.content, "Hello M365");
    assert.ok(!jsonResult.url.includes(validJwt));
    assert.match(jsonResult.url, /access_token=<redacted>/);
    await assertNoTokenLeak(jsonResult, validJwt);

    const streamResult = await executor.execute({ ...baseInput, stream: true });
    assert.equal(streamResult.response.status, 200);
    assert.equal(streamResult.response.headers.get("Content-Type"), "text/event-stream");
    const sse = await streamResult.response.clone().text();
    assert.match(sse, /"content":"Hello"/);
    assert.match(sse, /data: \[DONE\]/);
    await assertNoTokenLeak(streamResult, validJwt);

    assert.equal(sentFrames.length, 2);
    assert.match(sentFrames[0], /sendMessage/);
    assert.ok(!sentFrames[0].includes(validJwt));
  } finally {
    __setM365CopilotWebSocketTransportForTesting(null);
  }
});

test("CopilotM365WebExecutor.execute sanitizes WebSocket transport and upstream error failures", async () => {
  const executor = new CopilotM365WebExecutor();
  const input = {
    model: "copilot-m365-web",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: { apiKey: validJwt },
    signal: null,
  };

  __setM365CopilotWebSocketTransportForTesting(async () => {
    throw new Error(`WebSocket failed at /Users/example/source.ts:12 access_token=${validJwt}`);
  });
  try {
    const failure = await executor.execute(input);
    assert.equal(failure.response.status, 502);
    const body = (await failure.response.clone().json()) as any;
    assert.match(body.error.message, /WebSocket failed/i);
    assert.ok(!body.error.message.includes("/Users/example/source.ts"));
    await assertNoTokenLeak(failure, validJwt);
  } finally {
    __setM365CopilotWebSocketTransportForTesting(null);
  }

  __setM365CopilotWebSocketTransportForTesting(
    async () =>
      `${JSON.stringify({ type: 1, target: "error", arguments: [{ message: `tenant blocked ${validJwt}` }] })}\x1e`
  );
  try {
    const upstreamError = await executor.execute(input);
    assert.equal(upstreamError.response.status, 502);
    const body = (await upstreamError.response.clone().json()) as any;
    assert.match(body.error.message, /tenant blocked/i);
    await assertNoTokenLeak(upstreamError, validJwt);
  } finally {
    __setM365CopilotWebSocketTransportForTesting(null);
  }
});

test("CopilotM365WebExecutor.execute treats premature WebSocket close as sanitized transport failure", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const executor = new CopilotM365WebExecutor();
  const input = {
    model: "copilot-m365-web",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: { apiKey: validJwt },
    signal: null,
  };

  class CloseOnlyWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor() {
      queueMicrotask(() => {
        this.onopen?.();
        queueMicrotask(() => this.onclose?.());
      });
    }

    send() {}
    close() {}
  }

  try {
    globalThis.WebSocket = CloseOnlyWebSocket as unknown as typeof WebSocket;
    const closedWithoutFrames = await executor.execute(input);
    assert.equal(closedWithoutFrames.response.status, 502);
    assert.match(
      ((await closedWithoutFrames.response.clone().json()) as any).error.message,
      /closed before completion/i
    );
    await assertNoTokenLeak(closedWithoutFrames, validJwt);

    class PartialThenCloseWebSocket extends CloseOnlyWebSocket {
      send() {
        queueMicrotask(() =>
          this.onmessage?.({
            data: `${JSON.stringify({
              type: 1,
              target: "update",
              arguments: [{ message: { text: "partial" } }],
            })}\x1e`,
          })
        );
        queueMicrotask(() => this.onclose?.());
      }
    }

    globalThis.WebSocket = PartialThenCloseWebSocket as unknown as typeof WebSocket;
    const closedWithoutDone = await executor.execute(input);
    assert.equal(closedWithoutDone.response.status, 502);
    assert.match(
      ((await closedWithoutDone.response.clone().json()) as any).error.message,
      /closed before completion/i
    );
    await assertNoTokenLeak(closedWithoutDone, validJwt);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
