import assert from "node:assert/strict";
import test from "node:test";
import { decodeJwtPayload, identityFromAuthJson } from "../src/identity.js";

function jwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("extracts email and account metadata from an ID token", () => {
  const identity = identityFromAuthJson({
    auth_mode: "chatgpt",
    tokens: {
      id_token: jwt({
        email: "person@example.com",
        name: "Person",
        "https://api.openai.com/auth": { chatgpt_account_id: "account-1" },
      }),
    },
  });

  assert.deepEqual(identity, {
    email: "person@example.com",
    name: "Person",
    accountId: "account-1",
    authMode: "chatgpt",
  });
});

test("falls back to profile claims in the access token", () => {
  const identity = identityFromAuthJson({
    tokens: {
      access_token: jwt({
        "https://api.openai.com/profile": { email: "work@example.com" },
      }),
    },
  });
  assert.equal(identity.email, "work@example.com");
});

test("malformed tokens are ignored safely", () => {
  assert.equal(decodeJwtPayload("not-a-jwt"), undefined);
  assert.deepEqual(identityFromAuthJson({ tokens: { id_token: "broken" } }), {
    email: undefined,
    name: undefined,
    accountId: undefined,
    authMode: undefined,
  });
});
