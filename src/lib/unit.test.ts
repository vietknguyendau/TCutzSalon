import { describe, expect, it } from "vitest";
import { calculateRoi, TCUTZ_ROI_DEFAULTS } from "./roi";
import { signToken, verifyToken } from "./tokens";
import { formatPhoneUS, toE164US } from "./phone";
import { formatPrice } from "./money";
import { canTransition, primaryNextStatus } from "./domain/status";
import { publicBookingBody } from "./validation";

describe("ROI calculator (Tcutz illustrative defaults)", () => {
  const r = calculateRoi(TCUTZ_ROI_DEFAULTS);
  it("contribution per $30 cut at 15% variable cost is $25.50", () => expect(r.contributionPerAppointmentCents).toBe(2550));
  it("breaks even at 6 additional cuts per month against $149", () => expect(r.breakEvenAppointmentsPerMonth).toBe(6));
  it("10 extra cuts → $300 revenue, $106 monthly profit after fee", () => {
    expect(r.incrementalRevenueMonthlyCents).toBe(30000);
    expect(r.incrementalProfitMonthlyCents).toBe(25500 - 14900);
  });
  it("annual ROI includes setup fee", () => {
    const withSetup = calculateRoi({ ...TCUTZ_ROI_DEFAULTS, setupFeeCents: 50000 });
    expect(withSetup.annualCostCents).toBe(14900 * 12 + 50000);
    expect(withSetup.annualIncrementalProfitCents).toBe(25500 * 12 - (14900 * 12 + 50000));
  });
  it("zero extra appointments is a loss equal to the subscription", () => {
    const z = calculateRoi({ ...TCUTZ_ROI_DEFAULTS, additionalAppointmentsPerMonth: 0 });
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
