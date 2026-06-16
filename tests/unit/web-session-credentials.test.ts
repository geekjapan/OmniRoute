import test from "node:test";
import assert from "node:assert/strict";

const providers = await import("../../src/shared/constants/providers.ts");
const webSessionCredentials =
  await import("../../src/app/(dashboard)/dashboard/providers/[id]/webSessionCredentials.ts");

test("web session credential metadata covers every web-cookie provider", () => {
  for (const providerId of Object.keys(providers.WEB_COOKIE_PROVIDERS)) {
    assert.ok(
      webSessionCredentials.getWebSessionCredentialRequirement(providerId),
      `${providerId} should declare its required web-session credential`
    );
  }
});

test("web session credential metadata identifies cookie, token, and no-auth providers", () => {
  // Grok needs BOTH sso and sso-rw cookies (#3180)
  assert.deepEqual(webSessionCredentials.getWebSessionCredentialRequirement("grok-web"), {
    kind: "cookie",
    credentialName: "sso + sso-rw",
    placeholder: "sso=...; sso-rw=...",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "sso", "sso-rw"],
  });
  assert.deepEqual(webSessionCredentials.getWebSessionCredentialRequirement("copilot-web"), {
    kind: "token",
    credentialName: "access_token",
    placeholder: "access_token=... or a DevTools HAR export",
    acceptsFullCookieHeader: false,
    storageKeys: ["token", "access_token", "accessToken"],
  });
  assert.deepEqual(webSessionCredentials.getWebSessionCredentialRequirement("copilot-m365-web"), {
    kind: "token",
    credentialName: "M365/Substrate access_token",
    placeholder:
      "Paste the Microsoft 365 Copilot/Substrate access_token JWT, for example m365AccessToken=...",
    acceptsFullCookieHeader: false,
    storageKeys: ["token", "access_token", "accessToken", "m365AccessToken"],
  });
  assert.deepEqual(webSessionCredentials.getWebSessionCredentialRequirement("deepseek-web"), {
    kind: "token",
    credentialName: "userToken",
    placeholder: "userToken=... or paste raw userToken",
    acceptsFullCookieHeader: false,
    storageKeys: ["token", "userToken"],
  });
  // lmarena.ai's real auth cookie is `arena-auth-prod-v1`, not `session` (#3810)
  assert.deepEqual(webSessionCredentials.getWebSessionCredentialRequirement("lmarena"), {
    kind: "cookie",
    credentialName: "arena-auth-prod-v1",
    placeholder: "arena-auth-prod-v1=... or full Cookie header from lmarena.ai",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "arena-auth-prod-v1", "session"],
  });
  // veoaifree-web is now a NOAUTH provider — not in WEB_SESSION_CREDENTIAL_REQUIREMENTS
  assert.equal(webSessionCredentials.getWebSessionCredentialRequirement("veoaifree-web"), null);
  assert.deepEqual(webSessionCredentials.getWebSessionCredentialRequirement("t3-web"), {
    kind: "cookie",
    credentialName: "convex-session-id + Cookie header",
    placeholder: "convex-session-id=abc123...; Cookie: ...",
    acceptsFullCookieHeader: true,
    storageKeys: ["cookie", "convex-session-id", "convexSessionId"],
  });
});

test("web session credential validator requires provider-specific non-empty values", () => {
  assert.equal(
    webSessionCredentials.hasUsableWebSessionCredential("qwen-web", { token: "qwen-token" }),
    true
  );
  assert.equal(
    webSessionCredentials.hasUsableWebSessionCredential("qwen-web", { token: "   " }),
    false
  );
  assert.equal(
    webSessionCredentials.hasUsableWebSessionCredential("qwen-web", { unrelated: "value" }),
    false
  );
  assert.equal(
    webSessionCredentials.hasUsableWebSessionCredential("chatgpt-web", {
      cookie: "__Secure-next-auth.session-token=session",
    }),
    true
  );
  assert.equal(
    webSessionCredentials.hasUsableWebSessionCredential("chatgpt-web", { unrelated: "value" }),
    false
  );
});

test("no-auth web providers can be saved without an API key", () => {
  assert.equal(providers.providerAllowsOptionalApiKey("veoaifree-web"), true);
  assert.equal(webSessionCredentials.requiresWebSessionCredential("veoaifree-web"), false);
  assert.equal(webSessionCredentials.requiresWebSessionCredential("chatgpt-web"), true);
});

test("M365 Copilot Web credential metadata is distinct from personal Copilot Web", () => {
  const personal = webSessionCredentials.getWebSessionCredentialRequirement("copilot-web");
  const m365 = webSessionCredentials.getWebSessionCredentialRequirement("copilot-m365-web");

  assert.ok(personal);
  assert.ok(m365);
  assert.notDeepEqual(m365, personal);
  assert.equal(m365.kind, "token");
  assert.equal(m365.acceptsFullCookieHeader, false);
  assert.ok(m365.credentialName.includes("M365"));
  assert.ok(m365.credentialName.includes("Substrate"));
  assert.match(m365.placeholder, /Microsoft 365 Copilot\/Substrate access_token JWT/);
  assert.doesNotMatch(m365.placeholder, /copilot\.microsoft\.com/);
  assert.deepEqual(m365.storageKeys, ["token", "access_token", "accessToken", "m365AccessToken"]);
});
