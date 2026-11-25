import { describe, expect, it } from "vitest";
import { calculateRoi, DEFAULT_ROI_INPUTS } from "./roi";
import { signToken, verifyToken } from "./tokens";
import { formatPhoneUS, toE164US } from "./phone";
import { formatPrice } from "./money";
import { canTransition, primaryNextStatus } from "./domain/status";
import { publicBookingBody } from "./validation";

describe("ROI calculator (illustrative defaults)", () => {
  const r = calculateRoi(DEFAULT_ROI_INPUTS);
  it("contribution per $30 cut at 15% variable cost is $25.50", () => expect(r.contributionPerAppointmentCents).toBe(2550));
  it("breaks even at 6 additional cuts per month against $149", () => expect(r.breakEvenAppointmentsPerMonth).toBe(6));
  it("10 extra cuts → $300 revenue, $106 monthly profit after fee", () => {
    expect(r.incrementalRevenueMonthlyCents).toBe(30000);
    expect(r.incrementalProfitMonthlyCents).toBe(25500 - 14900);
  });
  it("annual ROI includes setup fee", () => {
    const withSetup = calculateRoi({ ...DEFAULT_ROI_INPUTS, setupFeeCents: 50000 });
    expect(withSetup.annualCostCents).toBe(14900 * 12 + 50000);
    expect(withSetup.annualIncrementalProfitCents).toBe(25500 * 12 - (14900 * 12 + 50000));
  });
  it("zero extra appointments is a loss equal to the subscription", () => {
    const z = calculateRoi({ ...DEFAULT_ROI_INPUTS, additionalAppointmentsPerMonth: 0 });
    expect(z.annualRoiPct).toBe(-100);
  });
});

describe("signed tokens", () => {
  const secret = "x".repeat(40);
  const exp = Math.floor(Date.now() / 1000) + 60;
  it("round-trips", () => {
    const t = signToken({ typ: "manage", sid: "s", sub: "a", exp }, secret);
    expect(verifyToken(t, secret, "manage")?.sub).toBe("a");
  });
  it("rejects tampering, wrong type, wrong secret, expiry", () => {
    const t = signToken({ typ: "manage", sid: "s", sub: "a", exp }, secret);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ typ: "manage", sid: "s", sub: "OTHER", exp })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, secret, "manage")).toBeNull();
    expect(verifyToken(`${body}.${sig}`, secret, "verified_phone")).toBeNull();
    expect(verifyToken(t, "y".repeat(40), "manage")).toBeNull();
    expect(verifyToken(t, secret, "manage", Date.now() + 120_000)).toBeNull();
  });
});

describe("phone + money formatting", () => {
  it("normalizes US numbers", () => {
    expect(toE164US("(763) 315-0044")).toBe("+17633150044");
    expect(toE164US("1-763-315-0044")).toBe("+17633150044");
    expect(toE164US("123")).toBeNull();
    expect(toE164US("(063) 315-0044")).toBeNull();
    expect(formatPhoneUS("+17633150044")).toBe("(763) 315-0044");
  });
  it("shows starting prices with a plus", () => {
    expect(formatPrice(3000, "starting_at")).toBe("$30+");
    expect(formatPrice(1600, "fixed")).toBe("$16");
  });
});

describe("status machine", () => {
  it("allows the salon flow and blocks nonsense", () => {
    expect(canTransition("booked", "arrived")).toBe(true);
    expect(canTransition("arrived", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("completed", "booked")).toBe(false);
    expect(canTransition("canceled", "booked")).toBe(false);
    expect(primaryNextStatus("pending_approval")).toBe("booked");
  });
});

describe("public booking validation", () => {
  const base = {
    serviceId: "00000000-0000-4000-8003-000000000001",
    startsAt: "2026-12-07T16:00:00.000Z",
    firstName: "Nguyễn Thị",
    phone: "763-555-0123",
    language: "vi",
    smsConsent: true,
  };
  it("accepts Vietnamese names and normalizes phone", () => {
    const p = publicBookingBody.parse(base);
    expect(p.phone).toBe("+17635550123");
  });
  it("rejects script injection in names and bad phones", () => {
    expect(publicBookingBody.safeParse({ ...base, firstName: "<script>" }).success).toBe(false);
    expect(publicBookingBody.safeParse({ ...base, phone: "12" }).success).toBe(false);
  });
});

import { applyDemoOverrides } from "./data/demo-config";
import { demoSalon, demoStaff, STAFF_OWNER } from "./data/fixtures";

describe("per-prospect demo overrides", () => {
  it("renames the demo salon and owner without touching data", () => {
    const { salon, staff } = applyDemoOverrides(demoSalon, demoStaff, {
      DEMO_SALON_NAME: "Lan's Hair Studio",
      DEMO_OWNER_NAME: "Lan",
      DEMO_OWNER_TITLE_VI: "chị",
      DEMO_SALON_PHONE: "(651) 555-0142",
      DEMO_TIMEZONE: "Not/AZone",
    });
    expect(salon.name).toBe("Lan's Hair Studio");
    expect(salon.ownerTitleVi).toBe("chị");
    expect(salon.phone).toBe("+16515550142");
    expect(salon.timezone).toBe("America/Chicago"); // invalid zone ignored
    expect(staff.find((s) => s.id === STAFF_OWNER)?.displayName).toBe("Lan");
    expect(salon.id).toBe(demoSalon.id);
  });
  it("defaults to the fictional demo salon", () => {
    expect(applyDemoOverrides(demoSalon, demoStaff, {}).salon.name).toBe("Main Street Barber & Salon");
  });
});

import { decodeProfile, encodeProfile, salonProfileSchema } from "./salon-profile";
import { brandSalon } from "./data/demo-branding";

describe("editable salon profile", () => {
  it("round-trips through the cookie/link encoding (Vietnamese and apostrophes intact)", () => {
    const p = salonProfileSchema.parse({ name: "Lan's Hair Studio", ownerFirstName: "Lan", ownerTitleVi: "chị", phone: "(651) 555-0142", address: "Eagan, MN" });
    expect(decodeProfile(encodeProfile(p))).toEqual({ name: "Lan's Hair Studio", ownerFirstName: "Lan", ownerTitleVi: "chị", phone: "+16515550142", address: "Eagan, MN" });
  });
  it("rejects tampered or hostile values", () => {
    expect(decodeProfile("not!base64")).toBeNull();
    expect(decodeProfile(Buffer.from(JSON.stringify({ name: "<script>x</script>" })).toString("base64url"))).toBeNull();
    expect(decodeProfile(Buffer.from(JSON.stringify({ name: "A" })).toString("base64url"))).toBeNull();
    expect(decodeProfile("x".repeat(2000))).toBeNull();
    expect(salonProfileSchema.safeParse({ name: "Ok Salon", ownerTitleVi: "sir" }).success).toBe(false);
  });
  it("blank optional fields keep the salon's existing values", () => {
    const p = salonProfileSchema.parse({ name: "Fade Factory", ownerFirstName: "", phone: "", address: "" });
    const s = brandSalon(demoSalon, p);
    expect(s.name).toBe("Fade Factory");
    expect(s.phone).toBe(demoSalon.phone);
    expect(s.ownerFirstName).toBe("Alex");
  });
});
