import test from "node:test";
import assert from "node:assert/strict";

const { createProviderSchema, providersBatchTestSchema } =
  await import("../../src/shared/validation/schemas.ts");
const { getProviderById, providerAllowsOptionalApiKey } =
  await import("../../src/shared/constants/providers.ts");

test("Pollinations is treated as a keyless-capable provider", () => {
  assert.equal(providerAllowsOptionalApiKey("pollinations"), true);
});

test("createProviderSchema allows Pollinations without apiKey", () => {
  const result = createProviderSchema.safeParse({
    provider: "pollinations",
    name: "Pollinations",
  });

  assert.equal(result.success, true);
});

test("Copilot web-session providers keep distinct credential optionality", () => {
  const m365Provider = getProviderById("copilot-m365-web");
  assert.equal(m365Provider?.alias, "copilot-m365");
  assert.equal(m365Provider?.name, "Microsoft 365 Copilot Web");

  assert.equal(providerAllowsOptionalApiKey("copilot-web"), true);
  assert.equal(providerAllowsOptionalApiKey("copilot-m365-web"), false);

  const missingCredential = createProviderSchema.safeParse({
    provider: "copilot-m365-web",
    name: "Microsoft 365 Copilot Web",
  });
  assert.equal(missingCredential.success, false);

  const withCredential = createProviderSchema.safeParse({
    provider: "copilot-m365-web",
    name: "Microsoft 365 Copilot Web",
    apiKey: "fake-m365-jwt",
  });
  assert.equal(withCredential.success, true);
});

test("providersBatchTestSchema accepts cloud-agent batch mode", () => {
  const result = providersBatchTestSchema.safeParse({
    mode: "cloud-agent",
  });

  assert.equal(result.success, true);
});
