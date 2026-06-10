// P38 tenant runtime 测试：验证每个租户拿到独立状态和本地依赖。

import { describe, expect, it } from "vitest";
import { createMemoryTenantRuntimeRegistry } from "../src/tenant-runtime/index.js";

describe("tenant runtime registry", () => {
  it("returns isolated state stores per tenant", async () => {
    const registry = createMemoryTenantRuntimeRegistry({
      createCalendar: (tenantId) => ({ tenantId }),
    });

    const a = await registry.get("tenant-a");
    const b = await registry.get("tenant-b");

    a.state.update({ last_event: { eventId: "evt-a", title: "A" } });
    b.state.update({ last_event: { eventId: "evt-b", title: "B" } });

    expect(a.state.snapshot().last_event?.eventId).toBe("evt-a");
    expect(b.state.snapshot().last_event?.eventId).toBe("evt-b");
    expect(a.calendar).toEqual({ tenantId: "tenant-a" });
    expect(b.calendar).toEqual({ tenantId: "tenant-b" });
  });
});
