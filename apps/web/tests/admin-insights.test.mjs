import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearningFixture } from "./learning-fixture.mjs";

test("admin insights returns operational overview and redacted activity", () => {
  const fixture = createLearningFixture();
  const admin = { id: "test-admin", role: "admin" };
  const request = (path, user = admin) => {
    let response;
    assert.equal(
      fixture(
        { method: "GET" },
        new URL(path, "http://fixture"),
        {},
        user,
        (status, data) => {
          response = { status, data };
        },
      ),
      true,
    );
    return response;
  };

  const overview = request("/admin/insights/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.data.users.total, 12);
  assert.equal(overview.data.providers.elevenlabs.enabled, false);
  assert.equal(typeof overview.data.providers.elevenlabs.configured, "boolean");

  const aiUsage = request("/admin/insights/ai-usage");
  assert.equal(aiUsage.status, 200);
  assert.equal(aiUsage.data.openai_costs.configured, false);
  assert.equal(aiUsage.data.openai_costs.error_code, "admin_key_missing");
  const activity = request("/admin/activity?limit=10");
  assert.equal(activity.status, 200);
  assert.ok(Array.isArray(activity.data.items));
  assert.ok(activity.data.items.every((item) => !("token" in item) && !("password" in item)));
  assert.ok(activity.data.items.some((item) => item.type === "audit_event"));

  const filtered = request("/admin/activity?limit=10&category=account");
  assert.equal(filtered.status, 200);
  assert.ok(filtered.data.items.every((item) => item.category === "account"));

  assert.equal(request("/admin/insights/overview", { id: "test-teacher", role: "teacher" }).status, 403);
});
