import "server-only";
import { z } from "zod";

const schema = z.object({
  DATA_MODE: z.enum(["demo", "supabase"]).default("demo"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  APP_SIGNING_SECRET: z.string().min(32).optional(),
  SMS_PROVIDER: z.enum(["console", "twilio"]).default("console"),
  DEFAULT_SALON_SLUG: z.string().default("tcutz"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  if (parsed.DATA_MODE === "supabase") {
    const missing = (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_SIGNING_SECRET"] as const)
      .filter((k) => !parsed[k]);
    if (missing.length) throw new Error(`DATA_MODE=supabase requires: ${missing.join(", ")}`);
  }
  if (process.env.NODE_ENV === "production" && parsed.DATA_MODE === "supabase" && !parsed.APP_SIGNING_SECRET) {
    throw new Error("APP_SIGNING_SECRET is required in production");
  }
  cached = parsed;
  return parsed;
}

/** Demo-only fallback secret. Never used when DATA_MODE=supabase (env() enforces a real one). */
export function signingSecret(): string {
  return env().APP_SIGNING_SECRET ?? "demo-only-signing-secret-not-for-production-use";
}
