import assert from "node:assert/strict";
import test from "node:test";
import {
  formatReset,
  presentUsage,
  queryCodexUsage,
  usageFromRateLimitsResponse,
} from "../src/usage.js";

test("prefers the Codex bucket and parses rolling plan windows", () => {
  const usage = usageFromRateLimitsResponse({
    rateLimits: { primary: { usedPercent: 99, windowDurationMins: 60 } },
    rateLimitsByLimitId: {
      other: { primary: { usedPercent: 80, windowDurationMins: 60 } },
      codex: {
        limitId: "codex",
        planType: "plus",
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 2_000_000_000 },
        secondary: { usedPercent: 34, windowDurationMins: 10_080 },
      },
    },
  });

  assert.equal(usage?.limitId, "codex");
  assert.equal(usage?.planType, "plus");
  assert.equal(usage?.primary?.usedPercent, 12);
  assert.equal(usage?.secondary?.windowDurationMins, 10_080);
  assert.equal(presentUsage(usage!).status, "5h 12% · 7d 34%");
});

test("detects workspace spend limits and credits", () => {
  const usage = usageFromRateLimitsResponse({
    rate_limits: {
      plan_type: "business",
      credits: { has_credits: true, unlimited: false, balance: "75" },
      individual_limit: {
        limit: "100",
        used: "25",
        remaining_percent: 75,
        resets_at: 2_000_000_000,
      },
    },
  });

  assert.deepEqual(usage?.credits, {
    balance: "75",
    hasCredits: true,
    unlimited: false,
  });
  assert.equal(usage?.individualLimit?.used, "25");
  assert.equal(presentUsage(usage!).status, "$(dashboard) 25% budget");
});

test("presents credit-only and unlimited accounts", () => {
  assert.equal(presentUsage({
    credits: { balance: "42.501234", hasCredits: true, unlimited: false },
  }).status, "$(credit-card) 42.50 cr");
  assert.deepEqual(presentUsage({
    credits: { balance: "42.501234", hasCredits: true, unlimited: false },
  }).details, ["**Credits available:** 42.50"]);
  assert.equal(presentUsage({
    credits: { hasCredits: true, unlimited: true },
  }).status, "$(infinity) unlimited");
});

test("formats reset timestamps as relative and absolute times", () => {
  const now = Date.UTC(2033, 4, 18, 10, 0, 0);
  const reset = Math.floor((now + 90 * 60_000) / 1_000);
  assert.match(formatReset(reset, now), /\(in 2 h\)$/);
});

test("ignores malformed usage payloads", () => {
  assert.equal(usageFromRateLimitsResponse(null), undefined);
  assert.equal(usageFromRateLimitsResponse({ rateLimits: { primary: {} } }), undefined);
});

test("queries usage through the app-server JSONL handshake", async () => {
  const fakeServer = String.raw`
    const readline = require("node:readline");
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.id === 1) {
        process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\n");
      } else if (message.id === 2) {
        process.stdout.write(JSON.stringify({
          id: 2,
          result: {
            rateLimits: {
              planType: "plus",
              primary: { usedPercent: 44, windowDurationMins: 1440 },
            },
          },
        }) + "\n");
      }
    });
  `;

  const result = await queryCodexUsage(
    process.execPath,
    ["-e", fakeServer],
    process.cwd(),
    2_000,
  );
  assert.equal(result.error, undefined);
  assert.equal(result.usage?.planType, "plus");
  assert.equal(result.usage?.primary?.usedPercent, 44);
});
