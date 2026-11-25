import { beforeEach, describe, expect, it } from "vitest";
import { DemoStore, resetDemoState } from "@/lib/data/demo-store";
import { demoSalon, fid } from "@/lib/data/fixtures";
import { dispatchDueNotifications, handleInboundSms, processCallEnded, bookingLink } from "@/lib/textback/service";
import { ConsoleSmsProvider } from "@/lib/providers/sms";

const store = new DemoStore();
const salon = demoSalon;
const provider = new ConsoleSmsProvider();
let n = 0;
const call = (from: string | null, extra: Partial<Parameters<typeof processCallEnded>[2]> = {}) =>
  ({ provider: "test", externalCallId: `CA${++n}`, from, outcome: "missed" as const, ...extra });
const MIDDAY = new Date("2026-12-07T19:00:00Z"); // Mon 1 PM CST

beforeEach(() => resetDemoState(new Date("2026-12-07T15:00:00Z")));

describe("processCallEnded", () => {
  it("texts an unknown mobile caller the booking link and logs the call", async () => {
    const r = await processCallEnded(store, salon, call("+17635550177"), { now: MIDDAY, provider });
    expect(r.status).toBe("processed");
    if (r.status !== "processed") return;
    expect(r.decision.action).toBe("send");
    expect(r.notification?.status).toBe("test_mode");
    expect(r.notification?.body).toContain("/book/demo?r=m");
    const calls = await store.listCalls(salon.id, new Date(0));
    expect(calls.some((c) => c.fromE164 === "+17635550177" && c.outcome === "missed")).toBe(true);
  });

  it("a retried webhook for the same call never sends twice", async () => {
    const ev = call("+17635550178");
    await processCallEnded(store, salon, ev, { now: MIDDAY, provider });
    expect(await processCallEnded(store, salon, ev, { now: MIDDAY, provider })).toEqual({ status: "duplicate" });
  });

  it("calling back three times in an hour gets one text", async () => {
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await processCallEnded(store, salon, call("+17635550179"), { now: new Date(MIDDAY.getTime() + i * 600_000), provider }));
    const sent = results.filter((r) => r.status === "processed" && r.decision.action === "send");
    expect(sent).toHaveLength(1);
  });

  it("landline caller (Robert) goes on the call-back list, no text", async () => {
    await store.resolveCallback(salon.id, (await store.listCallbacks(salon.id, "open"))[0].id, "done"); // clear seeded one
    const r = await processCallEnded(store, salon, call("+17635550102"), { now: MIDDAY, provider });
    expect(r.status === "processed" && r.decision).toMatchObject({ action: "skip", reason: "LANDLINE" });
    const open = await store.listCallbacks(salon.id, "open");
    expect(open[0]).toMatchObject({ phoneE164: "+17635550102", name: "Robert Anderson", reason: "landline_missed_call" });
  });

  it("known Vietnamese customer gets Vietnamese; upcoming appointment → reminder text", async () => {
    // Linh (555-0103, vi) has a demo appointment tomorrow
    const r = await processCallEnded(store, salon, call("+17635550103"), { now: MIDDAY, provider });
    expect(r.status === "processed" && r.decision.action).toBe("send");
    if (r.status === "processed" && r.decision.action === "send") {
      expect(r.decision.template).toBe("missed_call_upcoming");
      expect(r.decision.body).toContain("Lịch hẹn của anh/chị vẫn là");
    }
  });

  it("AI-booked calls are not texted", async () => {
    const r = await processCallEnded(store, salon, call("+17635550180", { outcome: "booked" }), { now: MIDDAY, provider });
    expect(r.status === "processed" && r.decision).toMatchObject({ action: "skip", reason: "NOT_A_MISSED_CALL" });
  });

  it("late-night call is queued for 9 AM; cron sends it — unless they texted STOP first", async () => {
    const night = new Date("2026-12-08T04:00:00Z"); // 10 PM CST
    const a = await processCallEnded(store, salon, call("+17635550181"), { now: night, provider });
    const b = await processCallEnded(store, salon, call("+17635550182"), { now: night, provider });
    expect(a.status === "processed" && a.notification?.status).toBe("queued");
    expect(b.status === "processed" && b.notification?.status).toBe("queued");
    await handleInboundSms(store, salon, "+17635550182", "STOP");
    expect(await dispatchDueNotifications(store, new Date("2026-12-08T14:00:00Z"))).toEqual({ due: 0, sent: 0, suppressed: 0 }); // 8 AM: not yet
    expect(await dispatchDueNotifications(store, new Date("2026-12-08T15:01:00Z"))).toEqual({ due: 2, sent: 1, suppressed: 1 });
  });
});

describe("handleInboundSms", () => {
  it("STOP opts out; later missed calls are not texted; START re-enables", async () => {
    expect((await handleInboundSms(store, salon, "+17635550190", "Stop")).reply).toBeNull();
    const r = await processCallEnded(store, salon, call("+17635550190"), { now: MIDDAY, provider });
    expect(r.status === "processed" && r.decision).toMatchObject({ reason: "OPTED_OUT" });
    await handleInboundSms(store, salon, "+17635550190", "START");
    const r2 = await processCallEnded(store, salon, call("+17635550190"), { now: MIDDAY, provider });
    expect(r2.status === "processed" && r2.decision.action).toBe("send");
  });

  it("CALL / GỌI puts them on the owner's call-back list with a confirmation", async () => {
    const en = await handleInboundSms(store, salon, "+17635550191", "call");
    expect(en.reply).toContain("Alex will call you back");
    const vi = await handleInboundSms(store, salon, "+17635550101", "Gọi");
    expect(vi.reply).toContain("Alex sẽ gọi lại");
    const open = await store.listCallbacks(salon.id, "open");
    expect(open.find((c) => c.phoneE164 === "+17635550101")).toMatchObject({ reason: "customer_asked", customerId: fid(4, 1) });
  });

  it("free-text replies reach the owner; auto-reply at most once an hour", async () => {
    const first = await handleInboundSms(store, salon, "+17635550192", "Can I come at 3 today?", MIDDAY);
    const second = await handleInboundSms(store, salon, "+17635550192", "Or 4?", new Date(MIDDAY.getTime() + 60_000));
    expect(first.reply).toContain("Book anytime");
    expect(second.reply).toBeNull();
    const cb = (await store.listCallbacks(salon.id, "open")).find((c) => c.phoneE164 === "+17635550192");
    expect(cb?.message).toBe("Can I come at 3 today?\nOr 4?");
  });
});

describe("demo branding", () => {
  it("uses the owner's Vietnamese honorific when configured", async () => {
    const s = { ...salon, ownerTitleVi: "chị" };
    const r = await handleInboundSms(store, s, "+17635550101", "GỌI");
    expect(r.reply).toBe("Main Street: Dạ, chị Alex sẽ gọi lại cho anh/chị sớm ạ.");
  });
});

describe("bookingLink", () => {
  it("uses the salon's short public URL when configured", () => {
    const s = { ...salon, settings: { ...salon.settings, publicBookingUrl: "https://book.example-salon.com" } };
    expect(bookingLink(s, "en")).toBe("https://book.example-salon.com/?r=m");
    expect(bookingLink(s, "vi")).toBe("https://book.example-salon.com/?r=m&lang=vi");
  });
});
