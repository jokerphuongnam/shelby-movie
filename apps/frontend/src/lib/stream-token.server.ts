import crypto from "crypto";

const SECRET = process.env.ALPHA_STREAM_SECRET ?? "shelby-alpha-dev-secret";
const TTL_SECONDS = 3600;

export function issueStreamToken(movieId: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${movieId}.${exp}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 24);
  return `${payload}.${sig}`;
}

export function verifyStreamToken(token: string, movieId: string): boolean {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const parts = payload.split(".");
  if (parts.length !== 2 || parts[0] !== movieId) return false;
  const exp = parseInt(parts[1], 10);
  if (isNaN(exp) || Math.floor(Date.now() / 1000) > exp) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 24);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
