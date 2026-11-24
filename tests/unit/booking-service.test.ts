import { beforeEach, describe, expect, it } from "vitest";
import { DemoStore, resetDemoState } from "@/lib/data/demo-store";
import { bookPublic, changeStatus, checkVerification, startVerification, availableSlots } from "@/lib/booking/service";
import { STAFF_DIEM, SVC_ID, tcutzSalon, fid } from "@/lib/data/fixtures";
import { addDays, localDateOf } from "@/lib/scheduling/time";
import { publicBookingBody } from "@/lib/validation";

const store = new DemoStore();
const salon = tcutzSalon;
const day = () => addDays(localDateOf(new Date(), salon.timezone), 3);

async function firstSlot(serviceId = SVC_ID.mens) {
  const r = await availableSlots(store, salon, { serviceId, date: day(), staffId: STAFF_DIEM, channel: "website" });
  if (!r.ok || !r.value.length) throw new Error("no slots");
  return r.value[0].start;
}
const body = (over: Record<string, unknown> = {}) =>
  publicBookingBody.parse({ serviceId: SVC_ID.mens, staffId: STAFF_DIEM, firstName: "Ana", phone: "7635550188", language: "en", smsConsent: false, ...over });

beforeEach(() => resetDemoState());

describe("bookPublic (shared booking service)", () => {
  it("books, then returns the SAME appointment on an idempotent retry", async () => {
    const startsAt = await firstSlot();
    const a = await bookPublic(store, salon, body({ startsAt }), "k-retry-0001");
    const b = await bookPublic(store, salon, body({ startsAt }), "k-retry-0001");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.value.appointment.id).toBe(a.value.appointment.id);
      expect(b.value.created).toBe(false);
    }
  });

  it("rejects a second booking for the same slot and removes it from availability", async () => {
    const startsAt = await firstSlot();
    await bookPublic(store, salon, body({ startsAt }), "k-first-0001");
    const second = await bookPublic(store, salon, body({ startsAt, firstName: "Bo", phone: "7635550189" }), "k-second-001");
    expect(second.ok).toBe(false);
    const after = await availableSlots(store, salon, { serviceId: SVC_ID.mens, date: day(), staffId: STAFF_DIEM, channel: "website" });
    expect(after.ok && after.value.some((s) => s.start === startsAt)).toBe(false);
  });

  it("parallel bookings for one slot: exactly one wins", async () => {
    const startsAt = await firstSlot();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => bookPublic(store, salon, body({ startsAt, firstName: `P${"abcdef"[i]}`, phone: `76355502${10 + i}` }), `k-race-000${i}`)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("approval-required services book as pending_approval", async () => {
    const startsAt = await firstSlot(SVC_ID.color);
    const r = await bookPublic(store, salon, body({ startsAt, serviceId: SVC_ID.color }), "k-color-0001");
    expect(r.ok && r.value.appointment.status).toBe("pending_approval");
  });

  it("household: same phone + different first name creates a separate profile", async () => {
    const startsAt = await firstSlot();
    const r = await bookPublic(store, salon, body({ startsAt, phone: "7635550101", firstName: "Lan" }), "k-house-0001");
    expect(r.ok).toBe(true);
    const members = await store.findCustomersByPhone(salon.id, "+17635550101");
    expect(members.map((m) => m.firstName).sort()).toEqual(["Bao", "Lan", "Minh"]);
  });

  it("cannot claim an existing profile without phone verification", async () => {
    const startsAt = await firstSlot();
    const r = await bookPublic(store, salon, body({ startsAt, phone: "7635550101", customerId: fid(4, 1) }), "k-forge-0001");
    expect(r).toEqual({ ok: false, error: "VERIFICATION_REQUIRED" });
  });

  it("verified returning customer can book their usual; profiles expose first names only", async () => {
    const { demoCode } = await startVerification(store, salon, "+17635550101", "vi");
    const v = await checkVerification(store, salon, "+17635550101", demoCode!);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.profiles.map((p) => p.firstName).sort()).toEqual(["Bao", "Minh"]);
    expect(JSON.stringify(v.value.profiles)).not.toMatch(/notes|fade|lastName|Nguyen/i);
    const minh = v.value.profiles.find((p) => p.firstName === "Minh")!;
    const startsAt = await firstSlot(minh.usualServiceId);
    const r = await bookPublic(
      store, salon,
      body({ startsAt, serviceId: minh.usualServiceId, phone: "7635550101", firstName: "Minh", customerId: minh.customerId, verifiedToken: v.value.verifiedToken }),
      "k-usual-0001",
    );
    expect(r.ok && r.value.appointment.source).toBe("rebooking");
    // Code is single-use
    expect((await checkVerification(store, salon, "+17635550101", demoCode!)).ok).toBe(false);
  });

  it("completing an appointment updates visit count and lifetime spend", async () => {
    const before = (await store.getCustomer(salon.id, fid(4, 5)))!;
    const r = await changeStatus(store, salon.id, fid(6, 5), "arrived");
    expect(r.ok).toBe(true);
    await changeStatus(store, salon.id, fid(6, 5), "completed");
    const after = (await store.getCustomer(salon.id, fid(4, 5)))!;
    expect(after.completedVisits).toBe(before.completedVisits + 1);
    expect(after.lifetimeSpendCents).toBe(before.lifetimeSpendCents + 4000);
    expect((await changeStatus(store, salon.id, fid(6, 5), "booked")).ok).toBe(false);
  });
});
