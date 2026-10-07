import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { ensure, mutate, HttpError, isLocal } from "./store.js";
const digest = (value) =>
  createHmac("sha256", secret()).update(value).digest("hex");
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32)
    throw new HttpError(
      503,
      "SESSION_SECRET doit contenir au moins 32 caractères.",
    );
  return value;
}
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password, hash) {
  const [salt, expected] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  const buffer = Buffer.from(expected, "hex");
  return buffer.length === actual.length && timingSafeEqual(buffer, actual);
}
export function validatePassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new HttpError(
      400,
      "Le mot de passe doit contenir entre 12 et 128 caractères.",
    );
}
export const authSeed = () => {
  const initial = process.env.ADMIN_INITIAL_PASSWORD;
  if (
    typeof initial !== "string" ||
    initial.length < 12 ||
    initial.length > 128
  )
    throw new HttpError(
      503,
      "Configurez ADMIN_INITIAL_PASSWORD (12 à 128 caractères) côté serveur.",
    );
  secret();
  return {
    username: process.env.ADMIN_USERNAME || "admin",
    passwordHash: passwordHash(initial),
    mustChangePassword: true,
    sessions: [],
  };
};
export async function rateLimit(req, action, maximum, windowMs) {
  const ip = isLocal()
    ? req.socket?.remoteAddress || "local"
    : req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const key = `limit-${digest(`${action}:${ip}`).slice(0, 32)}`;
  await mutate(
    key,
    () => ({ times: [] }),
    (data) => {
      data.times = data.times.filter((time) => Date.now() - time < windowMs);
      if (data.times.length >= maximum)
        throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
      data.times.push(Date.now());
    },
  );
}
export function setCookie(res, sid = "") {
  res.setHeader(
    "Set-Cookie",
    `mdart_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sid ? 28800 : 0}${isLocal() ? "" : "; Secure"}`,
  );
}
export async function issueSession(res, data) {
  const sid = randomBytes(32).toString("hex");
  data.sessions = data.sessions
    .filter((s) => s.expires > Date.now())
    .slice(-19);
  data.sessions.push({
    hash: digest(sid),
    expires: Date.now() + 8 * 60 * 60 * 1000,
  });
  return sid;
}
export function sessionId(req) {
  return /(?:^|;\s*)mdart_session=([a-f0-9]{64})(?:;|$)/.exec(
    req.headers.cookie || "",
  )?.[1];
}
export async function requireAdmin(req, allowInitial = false) {
  const sid = sessionId(req);
  if (!sid) throw new HttpError(401, "Connexion administrateur requise.");
  const current = await ensure("auth", authSeed);
  if (
    !current.data.sessions.some(
      (s) => s.hash === digest(sid) && s.expires > Date.now(),
    )
  )
    throw new HttpError(401, "Session expirée. Reconnectez-vous.");
  if (current.data.mustChangePassword && !allowInitial)
    throw new HttpError(403, "Changez votre mot de passe avant de continuer.");
  return { ...current, sidHash: digest(sid) };
}
export function checkOrigin(req) {
  const origin = req.headers.origin;
  const host = process.env.VERCEL
    ? req.headers["x-forwarded-host"] || req.headers.host
    : req.headers.host;
  const expected =
    process.env.APP_ORIGIN || `${isLocal() ? "http" : "https"}://${host}`;
  if (
    !origin ||
    origin !== expected ||
    (req.headers["sec-fetch-site"] &&
      !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
  )
    throw new HttpError(403, "Origine de la requête refusée.");
}
