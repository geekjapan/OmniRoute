import { randomUUID } from "node:crypto";

import { BaseExecutor, type ExecuteInput, type ProviderCredentials } from "./base.ts";
import { makeExecutorErrorResult } from "../utils/error.ts";

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const M365_COPILOT_AUDIENCE = "https://substrate.office.com/sydney";
const M365_CHATHUB_WS_ORIGIN = "wss://substrate.svc.cloud.microsoft";
const M365_CHATHUB_LOGGABLE_URL = `${M365_CHATHUB_WS_ORIGIN}/m365Copilot/Chathub`;
const M365_WS_TIMEOUT_MS = 60_000;
const M365_TOKEN_EXPIRY_SKEW_SECONDS = 60;

export type M365CopilotTokenPayload = {
  aud: string;
  exp: number;
  oid: string;
  tid: string;
  [key: string]: unknown;
};

export type M365CopilotChathubUrlInput = {
  token: string;
  payload: Pick<M365CopilotTokenPayload, "oid" | "tid">;
  chatSessionId?: string;
  clientRequestId?: string;
  conversationId?: string;
  xSessionId?: string;
};

export type M365BizChatSendFrameInput = {
  body: unknown;
  payload: Pick<M365CopilotTokenPayload, "oid" | "tid">;
  conversationId: string;
  clientRequestId: string;
};

export type M365BizChatEvent =
  | { kind: "text"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type M365CopilotWebSocketTransportRequest = {
  url: string;
  frame: string;
  signal?: AbortSignal | null;
};

export type M365CopilotWebSocketTransport = (
  request: M365CopilotWebSocketTransportRequest
) => Promise<string>;

let m365CopilotWebSocketTransportForTesting: M365CopilotWebSocketTransport | null = null;

export function __setM365CopilotWebSocketTransportForTesting(
  transport: M365CopilotWebSocketTransport | null
): void {
  m365CopilotWebSocketTransportForTesting = transport;
}

export class CopilotM365WebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-m365-web", {
      id: "copilot-m365-web",
      baseUrl: M365_CHATHUB_WS_ORIGIN,
    });
  }

  async execute(input: ExecuteInput): Promise<{
    response: Response;
    url: string;
    headers: Record<string, string>;
    transformedBody: unknown;
  }> {
    const model = input.model || "copilot-m365-web";
    const token = extractCredentialToken(input.credentials);
    if (!token) {
      return safeExecutorErrorResult(
        401,
        "Missing M365 Copilot access token. Paste a supported Substrate access_token.",
        M365_CHATHUB_LOGGABLE_URL
      );
    }

    let payload: M365CopilotTokenPayload;
    try {
      payload = parseM365CopilotJwt(token);
    } catch (err) {
      return safeExecutorErrorResult(
        401,
        err instanceof Error ? err.message : "Invalid M365 Copilot access token.",
        M365_CHATHUB_LOGGABLE_URL,
        token
      );
    }

    const chathubUrl = buildM365CopilotChathubUrl({ token, payload });

    let sendFrame: string;
    try {
      sendFrame = serializeM365BizChatSendFrame({
        body: input.body,
        payload,
        conversationId: chathubUrl.conversationId,
        clientRequestId: chathubUrl.clientRequestId,
      });
    } catch (err) {
      return safeExecutorErrorResult(
        400,
        err instanceof Error ? err.message : "No usable user message found in request body.",
        chathubUrl.loggableUrl,
        token
      );
    }

    let rawFrames: string;
    try {
      rawFrames = await runM365CopilotWebSocketTransport({
        url: chathubUrl.url,
        frame: sendFrame,
        signal: input.signal,
      });
    } catch (err) {
      return safeExecutorErrorResult(
        502,
        err instanceof Error ? err.message : "M365 Copilot WebSocket transport failure.",
        chathubUrl.loggableUrl,
        token,
        { provider: "copilot-m365-web", sendFrame }
      );
    }

    const events = parseM365BizChatResponseFrames(rawFrames);
    const upstreamError = events.find(
      (event): event is Extract<M365BizChatEvent, { kind: "error" }> => event.kind === "error"
    );
    if (upstreamError) {
      return safeExecutorErrorResult(502, upstreamError.message, chathubUrl.loggableUrl, token, {
        provider: "copilot-m365-web",
        sendFrame,
      });
    }

    if (input.stream) {
      return {
        response: new Response(m365BizChatEventsToOpenAISse(events, model), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: chathubUrl.loggableUrl,
        headers: {},
        transformedBody: { provider: "copilot-m365-web", sendFrame },
      };
    }

    return {
      response: new Response(JSON.stringify(m365BizChatEventsToOpenAIJson(events, model)), {
        headers: { "Content-Type": "application/json" },
      }),
      url: chathubUrl.loggableUrl,
      headers: {},
      transformedBody: { provider: "copilot-m365-web", sendFrame },
    };
  }
}

export function extractM365CopilotAccessToken(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  if (JWT_PATTERN.test(raw)) return raw;

  const bearer = raw.match(/(?:^|\s|:)Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/i);
  if (bearer) return bearer[1];

  try {
    const url = new URL(raw);
    const token = url.searchParams.get("access_token");
    if (token && JWT_PATTERN.test(token)) return token;
  } catch {
    // Not a URL; fall through to query/cookie style extraction.
  }

  const queryLike = raw.match(
    /(?:^|[?&;\s])access_token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/
  );
  return queryLike?.[1] ?? null;
}

export function isM365CopilotTokenPayload(payload: unknown): payload is M365CopilotTokenPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const candidate = payload as Record<string, unknown>;
  return (
    candidate.aud === M365_COPILOT_AUDIENCE &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp) &&
    candidate.exp > Math.floor(Date.now() / 1000) + M365_TOKEN_EXPIRY_SKEW_SECONDS &&
    typeof candidate.oid === "string" &&
    candidate.oid.trim().length > 0 &&
    typeof candidate.tid === "string" &&
    candidate.tid.trim().length > 0
  );
}

export function parseM365CopilotJwt(token: string): M365CopilotTokenPayload {
  if (!JWT_PATTERN.test(token)) {
    throw new Error("Invalid M365 Copilot access token format.");
  }

  const [, payloadSegment] = token.split(".");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid M365 Copilot access token payload.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid M365 Copilot access token payload.");
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.aud !== M365_COPILOT_AUDIENCE) {
    throw new Error("Token is not an M365 Copilot/Substrate token.");
  }
  if (
    typeof candidate.exp !== "number" ||
    !Number.isFinite(candidate.exp) ||
    candidate.exp <= Math.floor(Date.now() / 1000) + M365_TOKEN_EXPIRY_SKEW_SECONDS
  ) {
    throw new Error("M365 Copilot token is expired. Re-authenticate and re-extract the token.");
  }
  if (typeof candidate.oid !== "string" || !candidate.oid.trim()) {
    throw new Error("M365 Copilot token is missing the supported oid user identity claim.");
  }
  if (typeof candidate.tid !== "string" || !candidate.tid.trim()) {
    throw new Error("M365 Copilot token is missing the supported tid tenant identity claim.");
  }

  return {
    ...(candidate as M365CopilotTokenPayload),
    aud: candidate.aud,
    exp: candidate.exp,
    oid: candidate.oid.trim(),
    tid: candidate.tid.trim(),
  };
}

export function buildM365CopilotChathubUrl(input: M365CopilotChathubUrlInput): {
  url: string;
  loggableUrl: string;
  chatSessionId: string;
  clientRequestId: string;
  conversationId: string;
  xSessionId: string;
} {
  const chatSessionId = input.chatSessionId || randomUUID();
  const clientRequestId = input.clientRequestId || randomUUID();
  const conversationId = input.conversationId || randomUUID();
  const xSessionId = input.xSessionId || randomUUID();
  const url = new URL(
    `/m365Copilot/Chathub/${encodeURIComponent(input.payload.oid)}@${encodeURIComponent(input.payload.tid)}`,
    M365_CHATHUB_WS_ORIGIN
  );
  url.searchParams.set("access_token", input.token);
  url.searchParams.set("chatsessionid", chatSessionId);
  url.searchParams.set("clientrequestid", clientRequestId);
  url.searchParams.set("ConversationId", conversationId);
  url.searchParams.set("X-SessionId", xSessionId);

  const urlString = url.toString();
  return {
    url: urlString,
    loggableUrl: urlString.replace(input.token, "<redacted>"),
    chatSessionId,
    clientRequestId,
    conversationId,
    xSessionId,
  };
}

export function serializeM365BizChatSendFrame(input: M365BizChatSendFrameInput): string {
  const text = extractLatestUserText(input.body);
  if (!text) {
    throw new Error("No usable user message found in request body.");
  }

  return `${JSON.stringify({
    type: 1,
    target: "sendMessage",
    arguments: [
      {
        conversationId: input.conversationId,
        requestId: input.clientRequestId,
        participant: {
          oid: input.payload.oid,
          tid: input.payload.tid,
        },
        message: {
          author: "user",
          contentType: "text",
          text,
        },
      },
    ],
  })}\x1e`;
}

export function parseM365BizChatResponseFrames(raw: string): M365BizChatEvent[] {
  const events: M365BizChatEvent[] = [];
  for (const frameText of raw.split("\x1e")) {
    const trimmed = frameText.trim();
    if (!trimmed) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) continue;
    const record = frame as Record<string, unknown>;
    const target = typeof record.target === "string" ? record.target.toLowerCase() : "";

    const errorMessage = extractBizChatErrorMessage(record, target);
    if (errorMessage) {
      events.push({ kind: "error", message: errorMessage });
      continue;
    }

    for (const text of extractBizChatTexts(record)) {
      events.push({ kind: "text", text });
    }

    if (record.type === 3 || target === "done" || target === "complete") {
      events.push({ kind: "done" });
    }
  }
  return events;
}

export function m365BizChatEventsToOpenAISse(events: M365BizChatEvent[], model: string): string {
  const lines: string[] = [];
  for (const event of events) {
    if (event.kind === "text") {
      lines.push(
        `data: ${JSON.stringify({
          id: `chatcmpl-m365-copilot-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
        })}\n\n`
      );
    }
    if (event.kind === "done") {
      lines.push(
        `data: ${JSON.stringify({
          id: `chatcmpl-m365-copilot-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`
      );
      lines.push("data: [DONE]\n\n");
    }
  }
  if (!events.some((event) => event.kind === "done")) {
    lines.push("data: [DONE]\n\n");
  }
  return lines.join("");
}

export function m365BizChatEventsToOpenAIJson(
  events: M365BizChatEvent[],
  model: string
): Record<string, unknown> {
  const content = events
    .filter((event): event is Extract<M365BizChatEvent, { kind: "text" }> => event.kind === "text")
    .map((event) => event.text)
    .join("");
  return {
    id: `chatcmpl-m365-copilot-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function extractLatestUserText(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const messages = (body as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "user") continue;
    const text = extractTextContent(record.content);
    if (text) return text;
  }
  return null;
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed || null;
  }
  if (!Array.isArray(content)) return null;

  const parts = content
    .map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text.trim() : "";
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

function extractBizChatErrorMessage(
  record: Record<string, unknown>,
  target: string
): string | null {
  if (target !== "error" && record.type !== 7 && typeof record.error !== "string") return null;
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  const args = record.arguments;
  if (!Array.isArray(args)) return "M365 Copilot upstream error.";
  for (const arg of args) {
    const message = extractMessageString(arg);
    if (message) return message;
  }
  return "M365 Copilot upstream error.";
}

function extractBizChatTexts(record: Record<string, unknown>): string[] {
  const texts: string[] = [];
  const args = record.arguments;
  if (!Array.isArray(args)) return texts;
  for (const arg of args) {
    if (!arg || typeof arg !== "object" || Array.isArray(arg)) continue;
    const item = arg as Record<string, unknown>;
    const messages = item.messages;
    if (Array.isArray(messages)) {
      for (const message of messages) {
        const text = extractAssistantMessageText(message);
        if (text) texts.push(text);
      }
    }
    const text = extractAssistantMessageText(item.message);
    if (text) texts.push(text);
    const topLevelText = extractAssistantMessageText(item);
    if (topLevelText) texts.push(topLevelText);
  }
  return texts;
}

function extractAssistantMessageText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.author === "user" || record.role === "user") return null;
  const directText =
    typeof record.text === "string"
      ? record.text
      : typeof record.content === "string"
        ? record.content
        : "";
  const trimmed = directText.trim();
  return trimmed ? directText : null;
}

function extractMessageString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  }
  return null;
}

async function runM365CopilotWebSocketTransport(
  request: M365CopilotWebSocketTransportRequest
): Promise<string> {
  if (m365CopilotWebSocketTransportForTesting) {
    return m365CopilotWebSocketTransportForTesting(request);
  }
  return defaultM365CopilotWebSocketTransport(request);
}

async function defaultM365CopilotWebSocketTransport(
  request: M365CopilotWebSocketTransportRequest
): Promise<string> {
  const WS =
    globalThis.WebSocket ||
    ((await import("ws")).default as unknown as {
      new (url: string): WebSocket;
    });

  return new Promise<string>((resolve, reject) => {
    const frames: string[] = [];
    let settled = false;
    let sawTerminalEvent = false;
    const ws = new WS(request.url) as WebSocket & {
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      terminate?: () => void;
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        ws.terminate?.();
      }
      if (err) reject(err);
      else resolve(frames.join("\x1e"));
    };

    const onAbort = () => finish(new Error("M365 Copilot WebSocket request aborted."));
    const timeout = setTimeout(
      () => finish(new Error("M365 Copilot WebSocket request timed out.")),
      M365_WS_TIMEOUT_MS
    );
    request.signal?.addEventListener("abort", onAbort, { once: true });

    const handleOpen = () => {
      ws.send(request.frame);
    };
    const handleMessage = (data: unknown) => {
      const text =
        typeof data === "string"
          ? data
          : data instanceof Buffer
            ? data.toString("utf8")
            : String(data);
      frames.push(text);
      const events = parseM365BizChatResponseFrames(text);
      if (events.some((event) => event.kind === "done" || event.kind === "error")) {
        sawTerminalEvent = true;
        finish();
      }
    };
    const handleError = (event: unknown) => {
      const message =
        event && typeof event === "object" && "message" in event
          ? String((event as { message?: unknown }).message)
          : "M365 Copilot WebSocket error.";
      finish(new Error(message));
    };
    const handleClose = () => {
      if (sawTerminalEvent) {
        finish();
        return;
      }
      finish(new Error("M365 Copilot WebSocket closed before completion."));
    };

    if (typeof ws.on === "function") {
      ws.on("open", handleOpen);
      ws.on("message", handleMessage);
      ws.on("error", handleError);
      ws.on("close", handleClose);
    } else {
      ws.onopen = handleOpen;
      ws.onmessage = (event: MessageEvent) => handleMessage(event.data);
      ws.onerror = handleError;
      ws.onclose = handleClose;
    }
  });
}

function extractCredentialToken(credentials: ProviderCredentials | undefined): string | null {
  const candidates: unknown[] = [
    credentials?.apiKey,
    credentials?.accessToken,
    credentials?.providerSpecificData?.access_token,
    credentials?.providerSpecificData?.accessToken,
    credentials?.providerSpecificData?.token,
    credentials?.providerSpecificData?.m365AccessToken,
    credentials?.providerSpecificData?.authorization,
    credentials?.providerSpecificData?.cookie,
  ];
  for (const candidate of candidates) {
    const token = extractM365CopilotAccessToken(candidate);
    if (token) return token;
  }
  return null;
}

function safeExecutorErrorResult(
  status: number,
  message: string,
  url: string,
  token?: string,
  transformedBody: Record<string, unknown> = { provider: "copilot-m365-web" }
) {
  return makeExecutorErrorResult(
    status,
    token ? redactM365CopilotToken(message, token) : message,
    stripTokenFromJson(transformedBody, token),
    token ? redactM365CopilotToken(url, token) : url
  );
}

function redactM365CopilotToken(value: string, token: string): string {
  return value
    .replaceAll(token, "<redacted>")
    .replace(/access_token=[^&\s]+/gi, "access_token=<redacted>");
}

function stripTokenFromJson(value: unknown, token?: string): unknown {
  if (!token) return value;
  if (typeof value === "string") return redactM365CopilotToken(value, token);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripTokenFromJson(item, token));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      stripTokenFromJson(item, token),
    ])
  );
}
