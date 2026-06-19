import http from "node:http";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import sanitizeHtml from "sanitize-html";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv(path.join(__dirname, ".env"));

const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const uploadsDir = path.join(dataDir, "uploads");
const port = Number(process.env.PORT || 8080);
const adminPath = process.env.ADMIN_PATH ? normalizeAdminPath(process.env.ADMIN_PATH) : "";
const notificationWebhook = process.env.CSE_NOTIFICATION_WEBHOOK || "";
const databaseUrl = process.env.DATABASE_URL || "";
const bootstrapAdminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL || "";
const bootstrapAdminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
const bootstrapAdminName = process.env.ADMIN_BOOTSTRAP_NAME || "Administrateur CSE";
const sessionMaxAgeSeconds = Math.min(Math.max(Number(process.env.ADMIN_SESSION_MAX_AGE_SECONDS || 14_400), 900), 43_200);
const mailSettingsEncryptionKey = parseEncryptionKey(process.env.MAIL_SETTINGS_ENCRYPTION_KEY || "");
if (process.env.NODE_ENV === "production" && !mailSettingsEncryptionKey) {
  throw new Error("MAIL_SETTINGS_ENCRYPTION_KEY is required in production.");
}
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Configure PostgreSQL before starting cse-site.");
}
const dbPool = new Pool({ connectionString: databaseUrl });
const scryptAsync = promisify(scrypt);

const ideaStatuses = new Set(["pending", "approved", "in_progress", "treated", "rejected"]);
const publicIdeaStatuses = new Set(["approved", "in_progress"]);

const rateLimitWindowMs = 10 * 60 * 1000;
const rateLimitMax = 5;
const loginRateLimitWindowMs = 15 * 60 * 1000;
const loginRateLimitMax = 5;
const maxRateLimitBuckets = 10_000;
const rateBuckets = new Map();

function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
    }
  }
}

function parseEncryptionKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("MAIL_SETTINGS_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.");
  }
  return Buffer.from(raw, "hex");
}

const defaultContent = {
  news: [
    {
      id: "news-billetterie",
      tag: "Avantages",
      tagStyle: "coral",
      title: "Campagne billetterie ete",
      body: "Les offres loisirs et parcs ouvrent cette semaine avec des quotas revus pour la periode estivale.",
      date: "2026-06-18"
    },
    {
      id: "news-permanence",
      tag: "Vie interne",
      tagStyle: "teal",
      title: "Permanence CSE mensuelle",
      body: "Une permanence sans rendez-vous est prevue sur site pour les questions sociales et activites.",
      date: "2026-06-24"
    },
    {
      id: "news-consultation",
      tag: "Consultation",
      tagStyle: "gold",
      title: "Vos envies pour la rentree",
      body: "Sorties, culture, sport, famille: les retours anonymes alimenteront le programme du second semestre.",
      date: "2026-07-02"
    }
  ],
  posts: [
    {
      id: "post-role-cse",
      category: "Comprendre",
      title: "A quoi sert le CSE au quotidien ?",
      excerpt: "Un rappel simple sur les missions, les sujets traites et les bons reflexes pour solliciter vos representants.",
      body: "Le CSE est un relais entre les collaborateurs et l'entreprise. Il suit les sujets sociaux, les conditions de travail, les activites et les avantages proposes aux salaries.\n\nCet espace permet de centraliser les informations utiles, de partager les documents valides et de faire remonter les idees anonymes qui peuvent nourrir les prochaines reunions.",
      date: "2026-06-18",
      status: "published",
      featured: true
    },
    {
      id: "post-idee-vote",
      category: "Participation",
      title: "Comment sont traitees les idees anonymes ?",
      excerpt: "Les idees sont relues par les membres CSE, puis publiees pour vote si elles peuvent concerner plusieurs collaborateurs.",
      body: "Chaque idee envoyee arrive d'abord en attente de moderation. Les membres du CSE peuvent la valider, la rejeter ou la remettre en attente.\n\nUne idee validee devient visible sur le site public. Les collaborateurs peuvent alors voter pour aider le CSE a identifier les sujets a traiter en priorite.",
      date: "2026-06-18",
      status: "published",
      featured: false
    }
  ],
  meetings: [
    {
      id: "meeting-ordinaire",
      dateLabel: "27 juin",
      datetime: "2026-06-27",
      title: "Reunion ordinaire CSE",
      body: "Points sociaux, activites trimestrielles, suivi des demandes collaborateurs.",
      place: "Salle Loire",
      time: "10h30"
    },
    {
      id: "meeting-loisirs",
      dateLabel: "4 juillet",
      datetime: "2026-07-04",
      title: "Cloture inscriptions loisirs",
      body: "Dernier jour pour les demandes de participation aux offres estivales.",
      place: "En ligne",
      time: "18h00"
    },
    {
      id: "meeting-rentree",
      dateLabel: "12 sept.",
      datetime: "2026-09-12",
      title: "Forum de rentree",
      body: "Presentation des dispositifs, partenaires, permanences et temps forts du semestre.",
      place: "Atrium",
      time: "09h30"
    }
  ],
  documents: [
    {
      id: "doc-pv-mai",
      title: "PV reunion CSE - 28 mai 2026",
      description: "Compte-rendu valide",
      url: "/documents/PV-CSE-2026-05-28.pdf",
      createdAt: "2026-05-28T10:00:00.000Z",
      visibility: "public"
    },
    {
      id: "doc-odj-juin",
      title: "Ordre du jour - 27 juin 2026",
      description: "Reunion ordinaire",
      url: "/documents/Ordre-du-jour-CSE-2026-06-27.pdf",
      createdAt: "2026-06-17T10:00:00.000Z",
      visibility: "public"
    },
    {
      id: "doc-guide",
      title: "Guide avantages CSE 2026",
      description: "Modalites et contacts",
      url: "/documents/Guide-avantages-CSE-2026.pdf",
      createdAt: "2026-01-10T10:00:00.000Z",
      visibility: "public"
    }
  ],
  members: [
    {
      id: "member-social",
      firstName: "Camille",
      lastName: "Martin",
      service: "Ressources humaines",
      site: "Siege",
      role: "Titulaire",
      photo: "",
      email: "cse@example.com"
    },
    {
      id: "member-billetterie",
      firstName: "Alex",
      lastName: "Bernard",
      service: "Operations",
      site: "Site Nord",
      role: "Suppleant",
      photo: "",
      email: "billetterie-cse@example.com"
    },
    {
      id: "member-docs",
      firstName: "Samira",
      lastName: "Petit",
      service: "Finance",
      site: "Siege",
      role: "Titulaire",
      photo: "",
      email: "cse@example.com"
    }
  ]
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"]
]);

await mkdir(dataDir, { recursive: true });
await mkdir(uploadsDir, { recursive: true });

function setSecurityHeaders(res, { allowSameOriginFrame = false } = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", allowSameOriginFrame ? "SAMEORIGIN" : "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Origin-Agent-Cluster", "?1");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' https: data:",
      "style-src 'self' https://fonts.googleapis.com",
      "script-src 'self'",
      "connect-src 'self'",
      "font-src 'self' https://fonts.gstatic.com",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "media-src 'self'",
      "frame-src 'self'",
      `frame-ancestors ${allowSameOriginFrame ? "'self'" : "'none'"}`
    ].join("; ")
  );
}

function sendJson(res, statusCode, payload) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, contentType, body, fileName = "") {
  setSecurityHeaders(res);
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  };
  if (fileName) {
    headers["Content-Disposition"] = `attachment; filename="${fileName}"`;
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function notify(title, message) {
  if (!notificationWebhook) return;
  fetch(notificationWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, message, source: "cse-site", sentAt: new Date().toISOString() })
  }).catch((error) => console.error("Notification failed", error.message));
}

function csvCell(value) {
  const raw = String(value ?? "").replace(/\r?\n/g, " ");
  const safe = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function ideasToCsv(ideas) {
  const headers = ["id", "createdAt", "category", "status", "votes", "context", "message", "reviewNote", "targetMeetingId"];
  const rows = ideas.map((idea) => headers.map((key) => csvCell(idea[key])).join(";"));
  return `${headers.join(";")}\n${rows.join("\n")}\n`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeAdminPath(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\/+/g, "/");
  const withSlash = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return /^\/[a-zA-Z0-9][a-zA-Z0-9/_-]{8,120}$/.test(withSlash) ? withSlash : "";
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map((part) => {
    try {
      const [name, ...value] = part.trim().split("=");
      return [decodeURIComponent(name || ""), decodeURIComponent(value.join("=") || "")];
    } catch {
      return null;
    }
  }).filter((entry) => entry?.[0]));
}

function cookieHeader(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, "HttpOnly", "SameSite=Strict", "Path=/", "Priority=High"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function isSecureRequest(req) {
  return process.env.COOKIE_SECURE === "true" || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookieName(req) {
  return isSecureRequest(req) ? "__Host-cse_admin_session" : "cse_admin_session";
}

function setTransportSecurityHeader(req, res) {
  if (isSecureRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function hashSessionToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(String(password), salt, 64);
  return `scrypt$${salt}$${Buffer.from(hash).toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = await scryptAsync(String(password), salt, 64);
  return safeEqual(Buffer.from(derived).toString("hex"), expected);
}

const fallbackPasswordHash = await hashPassword("invalid-admin-login-password");

function publicAdminAccount(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    lastLoginAt: row.last_login_at?.toISOString?.() || row.last_login_at || ""
  };
}

async function auditAdminAction(session, action, metadata = {}) {
  try {
    await dbPool.query(
      "INSERT INTO admin_audit_log (id, admin_id, action, metadata) VALUES ($1, $2, $3, $4::jsonb)",
      [randomUUID(), session?.admin?.id || null, cleanText(action, 100), JSON.stringify(metadata)]
    );
  } catch (error) {
    console.error("Could not write admin audit log", error.message);
  }
}

async function getAdminSession(req) {
  const token = parseCookies(req)[sessionCookieName(req)];
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const result = await dbPool.query(
    `SELECT s.id AS session_id, a.*
     FROM admin_sessions s
     JOIN admin_accounts a ON a.id = s.admin_id
     WHERE s.session_token_hash = $1
       AND s.expires_at > now()
       AND a.active = true
       AND a.role IN ('owner', 'editor')`,
    [tokenHash]
  );
  if (!result.rows.length) return null;
  return { sessionId: result.rows[0].session_id, tokenHash, admin: publicAdminAccount(result.rows[0]) };
}

async function requireAdmin(req, res) {
  const session = await getAdminSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return null;
  }
  return session;
}

function requireOwner(res, session) {
  if (session?.admin?.role === "owner") return true;
  sendJson(res, 403, { ok: false, error: "forbidden" });
  return false;
}

function getClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0] || req.socket.remoteAddress || "local";
  return createHash("sha256").update(rawIp).digest("hex");
}

function isRateLimited(req, scope = "public", max = rateLimitMax, windowMs = rateLimitWindowMs, identity = "") {
  const now = Date.now();
  const key = `${scope}:${getClientKey(req)}:${identity}`;
  const bucket = rateBuckets.get(key) || [];
  const recent = bucket.filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= max) {
    rateBuckets.set(key, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > maxRateLimitBuckets) {
    for (const [bucketKey, timestamps] of rateBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) rateBuckets.delete(bucketKey);
      if (rateBuckets.size <= maxRateLimitBuckets) break;
    }
    if (rateBuckets.size > maxRateLimitBuckets) {
      rateBuckets.delete(rateBuckets.keys().next().value);
    }
  }
  return false;
}

function rejectRateLimit(res, retryAfterSeconds) {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  sendJson(res, 429, { ok: false, error: "rate_limited" });
}

function isTrustedMutation(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function isJsonRequest(req) {
  return String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json");
}

function requireTrustedMutation(req, res, { json = false } = {}) {
  if (!isTrustedMutation(req)) {
    sendJson(res, 403, { ok: false, error: "invalid_origin" });
    return false;
  }
  if (json && !isJsonRequest(req)) {
    sendJson(res, 415, { ok: false, error: "unsupported_media_type" });
    return false;
  }
  return true;
}

async function readBody(req, maxBytes = 8192) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("payload_too_large");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanLongText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

function sanitizeRichText(value, maxLength) {
  const source = String(value || "").slice(0, maxLength * 4);
  return sanitizeHtml(source, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "img"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt"]
    },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => ({
        tagName,
        attribs: { href: attributes.href || "", target: "_blank", rel: "noopener noreferrer" }
      })
    }
  }).trim().slice(0, maxLength);
}

function sanitizePhotoSource(value) {
  const source = cleanText(value, 1_000_000);
  if (/^https:\/\/[^\s]+$/i.test(source)) return source;
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(source) && source.length <= 1_000_000) return source;
  return "";
}

function isValidEmail(value) {
  const email = cleanText(value, 180);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cleanDate(value) {
  const cleaned = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : "";
}

function normalizeContent(rawContent) {
  const content = rawContent && typeof rawContent === "object" ? rawContent : defaultContent;
  return {
    news: Array.isArray(content.news) ? content.news.slice(0, 12).map((item) => ({
      id: cleanText(item.id, 80) || randomUUID(),
      tag: cleanText(item.tag, 40) || "Info",
      tagStyle: ["coral", "teal", "gold"].includes(item.tagStyle) ? item.tagStyle : "teal",
      title: cleanText(item.title, 120),
      body: cleanLongText(item.body, 360),
      date: cleanDate(item.date)
    })).filter((item) => item.title && item.body) : [],
    posts: Array.isArray(content.posts) ? content.posts.slice(0, 80).map((item) => ({
      id: cleanText(item.id, 80) || randomUUID(),
      category: cleanText(item.category, 60) || "Info CSE",
      title: cleanText(item.title, 160),
      excerpt: cleanLongText(item.excerpt, 360),
      body: sanitizeRichText(item.body, 5000),
      date: cleanDate(item.date),
      status: ["draft", "published"].includes(item.status) ? item.status : "published",
      featured: Boolean(item.featured)
    })).filter((item) => item.title && item.body) : [],
    meetings: Array.isArray(content.meetings) ? content.meetings.slice(0, 20).map((item) => ({
      id: cleanText(item.id, 80) || randomUUID(),
      dateLabel: cleanText(item.dateLabel, 40),
      datetime: cleanDate(item.datetime),
      title: cleanText(item.title, 140),
      body: cleanLongText(item.body, 420),
      place: cleanText(item.place, 80),
      time: cleanText(item.time, 40)
    })).filter((item) => item.title) : [],
    documents: Array.isArray(content.documents) ? content.documents.slice(0, 80).map((item) => ({
      id: cleanText(item.id, 80) || randomUUID(),
      title: cleanText(item.title, 160),
      description: cleanText(item.description, 160),
      url: cleanText(item.url, 260),
      createdAt: cleanText(item.createdAt, 40) || new Date().toISOString(),
      visibility: ["public", "private"].includes(item.visibility) ? item.visibility : "public"
    })).filter((item) => item.title && item.url.startsWith("/")) : [],
    members: Array.isArray(content.members) ? content.members.slice(0, 40).map((item) => ({
      id: cleanText(item.id, 80) || randomUUID(),
      firstName: cleanText(item.firstName, 80),
      lastName: cleanText(item.lastName, 80),
      service: cleanText(item.service, 100),
      site: cleanText(item.site, 100),
      role: ["Titulaire", "Suppleant"].includes(item.role) ? item.role : "Titulaire",
      photo: sanitizePhotoSource(item.photo),
      email: isValidEmail(item.email) ? cleanText(item.email, 120) : ""
    })).filter((item) => item.firstName || item.lastName) : []
  };
}

async function getContent() {
  return getContentFromDatabase();
}

async function saveContent(content) {
  return saveContentToDatabase(content);
}

function getPublicContent(content) {
  return {
    ...content,
    posts: content.posts
      .filter((post) => post.status === "published")
      .sort((a, b) => Number(b.featured) - Number(a.featured) || String(b.date).localeCompare(String(a.date))),
    documents: content.documents.filter((document) => document.visibility !== "private")
  };
}

async function initializeStorage() {
  await initializeDatabase();
  await seedDefaultContent();
}

async function initializeDatabase() {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS app_content (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      content jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL,
      category text NOT NULL,
      message text NOT NULL,
      context text NOT NULL DEFAULT '',
      status text NOT NULL,
      votes integer NOT NULL DEFAULT 0,
      reviewed_at timestamptz,
      review_note text NOT NULL DEFAULT '',
      target_meeting_id text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ideas_status_idx ON ideas (status);
    CREATE INDEX IF NOT EXISTS ideas_created_at_idx ON ideas (created_at DESC);

    CREATE TABLE IF NOT EXISTS admin_accounts (
      id text PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL DEFAULT '',
      display_name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'member',
      provider text NOT NULL DEFAULT 'local',
      provider_subject text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS password_hash text NOT NULL DEFAULT '';
    ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id text PRIMARY KEY,
      admin_id text NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
      session_token_hash text UNIQUE NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON admin_sessions (expires_at);

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id text PRIMARY KEY,
      admin_id text REFERENCES admin_accounts(id) ON DELETE SET NULL,
      action text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log (created_at DESC);

    CREATE TABLE IF NOT EXISTS email_outbox (
      id text PRIMARY KEY,
      type text NOT NULL,
      recipient text NOT NULL,
      subject text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS mail_settings (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      host text NOT NULL DEFAULT '',
      port integer NOT NULL DEFAULT 587,
      secure boolean NOT NULL DEFAULT false,
      username text NOT NULL DEFAULT '',
      password text NOT NULL DEFAULT '',
      from_email text NOT NULL DEFAULT '',
      from_name text NOT NULL DEFAULT 'CSE',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await dbPool.query("UPDATE admin_accounts SET role = 'owner' WHERE role = 'admin'");
  await seedBootstrapAdmin();
}

async function seedDefaultContent() {
  const contentCount = Number((await dbPool.query("SELECT count(*)::int AS count FROM app_content")).rows[0].count);
  if (contentCount === 0) {
    await saveContentToDatabase(defaultContent);
  }
}

async function seedBootstrapAdmin() {
  const count = Number((await dbPool.query("SELECT count(*)::int AS count FROM admin_accounts")).rows[0].count);
  if (count > 0 || !bootstrapAdminEmail || !bootstrapAdminPassword) return;
  if (bootstrapAdminPassword.length < 12) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.");
  }
  await dbPool.query(
    `INSERT INTO admin_accounts (id, email, password_hash, display_name, role, provider)
     VALUES ($1, $2, $3, $4, 'owner', 'local')`,
    [randomUUID(), cleanText(bootstrapAdminEmail.toLowerCase(), 180), await hashPassword(bootstrapAdminPassword), cleanText(bootstrapAdminName, 120)]
  );
}

async function getContentFromDatabase() {
  const result = await dbPool.query("SELECT content FROM app_content WHERE id = 1");
  if (!result.rows.length) return structuredClone(defaultContent);
  return normalizeContent(result.rows[0].content);
}

async function saveContentToDatabase(content) {
  const normalized = normalizeContent(content);
  await dbPool.query(
    `INSERT INTO app_content (id, content, updated_at)
     VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [JSON.stringify(normalized)]
  );
  return normalized;
}

function rowToIdea(row) {
  return normalizeIdea({
    id: row.id,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    category: row.category,
    message: row.message,
    context: row.context,
    status: row.status,
    votes: row.votes,
    reviewedAt: row.reviewed_at?.toISOString?.() || row.reviewed_at || "",
    reviewNote: row.review_note,
    targetMeetingId: row.target_meeting_id,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  });
}

async function getIdeasFromDatabase() {
  const result = await dbPool.query("SELECT * FROM ideas ORDER BY created_at DESC");
  return { ideas: result.rows.map(rowToIdea) };
}

async function saveIdeasToDatabase(db) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM ideas");
    for (const idea of db.ideas.map(normalizeIdea).filter((item) => item.message)) {
      await client.query(
        `INSERT INTO ideas (
          id, created_at, category, message, context, status, votes,
          reviewed_at, review_note, target_meeting_id, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          idea.id,
          idea.createdAt,
          idea.category,
          idea.message,
          idea.context,
          idea.status,
          idea.votes,
          idea.reviewedAt || null,
          idea.reviewNote,
          idea.targetMeetingId,
          idea.updatedAt
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getIdeasDb() {
  return getIdeasFromDatabase();
}

function normalizeIdea(idea) {
  const status = cleanText(idea.status, 20);
  return {
    id: cleanText(idea.id, 80) || randomUUID(),
    createdAt: cleanText(idea.createdAt, 40) || new Date().toISOString(),
    category: cleanText(idea.category, 80) || "general",
    message: cleanLongText(idea.message, 1200),
    context: cleanText(idea.context, 240),
    status: ideaStatuses.has(status) ? status : "pending",
    votes: Number.isFinite(Number(idea.votes)) ? Number(idea.votes) : 0,
    reviewedAt: cleanText(idea.reviewedAt, 40),
    reviewNote: cleanText(idea.reviewNote, 240),
    targetMeetingId: cleanText(idea.targetMeetingId, 80),
    updatedAt: cleanText(idea.updatedAt, 40) || cleanText(idea.createdAt, 40) || new Date().toISOString()
  };
}

await initializeStorage();

async function saveIdeasDb(db) {
  await saveIdeasToDatabase(db);
}

function publicIdea(idea) {
  return {
    id: idea.id,
    createdAt: idea.createdAt,
    category: idea.category,
    message: idea.message,
    context: idea.context,
    status: idea.status,
    votes: Number(idea.votes || 0)
  };
}

async function handleIdeaSubmission(req, res) {
  if (!requireTrustedMutation(req, res, { json: true })) return;
  if (isRateLimited(req)) {
    rejectRateLimit(res, Math.ceil(rateLimitWindowMs / 1000));
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req, 12_000));
  } catch (error) {
    sendJson(res, error.message === "payload_too_large" ? 413 : 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const idea = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    category: cleanText(body.category, 80) || "general",
    message: cleanLongText(body.message, 1200),
    context: cleanText(body.context, 240),
    status: "pending",
    votes: 0,
    reviewedAt: "",
    reviewNote: "",
    targetMeetingId: "",
    updatedAt: new Date().toISOString()
  };

  if (idea.message.length < 12) {
    sendJson(res, 422, { ok: false, error: "message_too_short" });
    return;
  }

  const db = await getIdeasDb();
  db.ideas.unshift(idea);
  await saveIdeasDb(db);
  notify("Nouvelle idee CSE", `${idea.category}: ${idea.message.slice(0, 180)}`);
  sendJson(res, 201, { ok: true, id: idea.id });
}

async function getStats() {
  const [content, ideasDb] = await Promise.all([getContent(), getIdeasDb()]);
  const publicContent = getPublicContent(content);
  const ideas = ideasDb.ideas;
  return {
    news: publicContent.news.length,
    posts: publicContent.posts.length,
    documents: publicContent.documents.length,
    totalDocuments: content.documents.length,
    members: content.members.length,
    ideas: ideas.length,
    pendingIdeas: ideas.filter((idea) => idea.status === "pending").length,
    approvedIdeas: ideas.filter((idea) => idea.status === "approved").length,
    inProgressIdeas: ideas.filter((idea) => idea.status === "in_progress").length,
    treatedIdeas: ideas.filter((idea) => idea.status === "treated").length
  };
}

async function handleIdeaVote(req, res, ideaId) {
  if (!requireTrustedMutation(req, res)) return;
  if (isRateLimited(req)) {
    rejectRateLimit(res, Math.ceil(rateLimitWindowMs / 1000));
    return;
  }

  const db = await getIdeasDb();
  const idea = db.ideas.find((item) => item.id === ideaId && publicIdeaStatuses.has(item.status));
  if (!idea) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  idea.votes = Number(idea.votes || 0) + 1;
  await saveIdeasDb(db);
  sendJson(res, 200, { ok: true, idea: publicIdea(idea) });
}

async function handleAdminLogin(req, res) {
  if (!requireTrustedMutation(req, res, { json: true })) return;
  if (isRateLimited(req, "login-ip", 20, loginRateLimitWindowMs)) {
    rejectRateLimit(res, Math.ceil(loginRateLimitWindowMs / 1000));
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req, 8_000));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const email = cleanText(body.email, 180).toLowerCase();
  const password = String(body.password || "");
  const emailKey = createHash("sha256").update(email).digest("hex");
  if (isRateLimited(req, "login-account", loginRateLimitMax, loginRateLimitWindowMs, emailKey)) {
    rejectRateLimit(res, Math.ceil(loginRateLimitWindowMs / 1000));
    return;
  }
  const adminCount = Number((await dbPool.query("SELECT count(*)::int AS count FROM admin_accounts")).rows[0].count);
  if (adminCount === 0) {
    sendJson(res, 503, { ok: false, error: "admin_not_configured" });
    return;
  }

  const result = await dbPool.query("SELECT * FROM admin_accounts WHERE email = $1 AND active = true", [email]);
  const row = result.rows[0];
  const passwordValid = await verifyPassword(password, row?.password_hash || fallbackPasswordHash);
  if (!row || !passwordValid) {
    sendJson(res, 401, { ok: false, error: "invalid_credentials" });
    return;
  }

  const sessionToken = randomBytes(32).toString("base64url");
  await dbPool.query("DELETE FROM admin_sessions WHERE expires_at <= now()");
  await dbPool.query(
    `INSERT INTO admin_sessions (id, admin_id, session_token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [randomUUID(), row.id, hashSessionToken(sessionToken), sessionMaxAgeSeconds]
  );
  await dbPool.query("UPDATE admin_accounts SET last_login_at = now(), updated_at = now() WHERE id = $1", [row.id]);
  res.setHeader("Set-Cookie", cookieHeader(sessionCookieName(req), sessionToken, { maxAge: sessionMaxAgeSeconds, secure: isSecureRequest(req) }));
  await auditAdminAction({ admin: publicAdminAccount(row) }, "admin.login");
  sendJson(res, 200, { ok: true, admin: publicAdminAccount({ ...row, last_login_at: new Date() }) });
}

async function handleAdminLogout(req, res, session) {
  if (session?.tokenHash) {
    await dbPool.query("DELETE FROM admin_sessions WHERE session_token_hash = $1", [session.tokenHash]);
  }
  await auditAdminAction(session, "admin.logout");
  res.setHeader("Set-Cookie", cookieHeader(sessionCookieName(req), "", { maxAge: 0, secure: isSecureRequest(req) }));
  sendJson(res, 200, { ok: true });
}

function encryptMailSecret(value) {
  const secret = String(value || "");
  if (!secret) return "";
  if (!mailSettingsEncryptionKey) throw new Error("mail_encryption_not_configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mailSettingsEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptMailSecret(value) {
  const stored = String(value || "");
  if (!stored || !stored.startsWith("enc:v1:")) return stored;
  if (!mailSettingsEncryptionKey) throw new Error("mail_encryption_not_configured");
  const [, , ivValue, tagValue, encryptedValue] = stored.split(":");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("invalid_encrypted_mail_secret");
  const decipher = createDecipheriv("aes-256-gcm", mailSettingsEncryptionKey, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function normalizeMailSettings(row) {
  return {
    host: cleanText(row?.host, 200),
    port: Number(row?.port || 587),
    secure: Boolean(row?.secure),
    username: cleanText(row?.username, 200),
    password: decryptMailSecret(row?.password),
    fromEmail: cleanText(row?.from_email, 200),
    fromName: cleanText(row?.from_name, 120) || "CSE"
  };
}

async function getMailSettings() {
  const result = await dbPool.query("SELECT * FROM mail_settings WHERE id = 1");
  return normalizeMailSettings(result.rows[0] || {});
}

function publicMailSettings(settings) {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    username: settings.username,
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
    hasPassword: Boolean(settings.password)
  };
}

async function handleMailSettingsUpdate(req, res, session) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 20_000));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const current = await getMailSettings();
  const settings = {
    host: cleanText(body.host, 200),
    port: Math.min(Math.max(Number(body.port || 587), 1), 65535),
    secure: Boolean(body.secure),
    username: cleanText(body.username, 200),
    password: String(body.password || "") || current.password,
    fromEmail: cleanText(body.fromEmail, 200),
    fromName: cleanText(body.fromName, 120) || "CSE"
  };

  if (!settings.host || !isValidEmail(settings.fromEmail)) {
    sendJson(res, 422, { ok: false, error: "invalid_mail_settings" });
    return;
  }

  await dbPool.query(
    `INSERT INTO mail_settings (id, host, port, secure, username, password, from_email, from_name, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       host = EXCLUDED.host,
       port = EXCLUDED.port,
       secure = EXCLUDED.secure,
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       from_email = EXCLUDED.from_email,
       from_name = EXCLUDED.from_name,
       updated_at = now()`,
    [settings.host, settings.port, settings.secure, settings.username, encryptMailSecret(settings.password), settings.fromEmail, settings.fromName]
  );

  await auditAdminAction(session, "mail.settings_updated", { host: settings.host, fromEmail: settings.fromEmail });
  sendJson(res, 200, { ok: true, settings: publicMailSettings(settings) });
}

async function sendConfiguredMail({ to, subject, text, html }) {
  const settings = await getMailSettings();
  if (!settings.host || !settings.fromEmail || !to) {
    throw new Error("mail_not_configured");
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    tls: { minVersion: "TLSv1.2" },
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined
  });
  const from = settings.fromName ? `"${settings.fromName.replace(/"/g, "'")}" <${settings.fromEmail}>` : settings.fromEmail;
  await transporter.sendMail({ from, to, subject, text, html });
}

async function handleMailTest(req, res, session) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 4_000));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const recipient = cleanText(body.recipient, 200);
  if (!isValidEmail(recipient)) {
    sendJson(res, 422, { ok: false, error: "invalid_recipient" });
    return;
  }
  try {
    await sendConfiguredMail({
      to: recipient,
      subject: "Test email portail CSE",
      text: "Ceci est un email de test envoye depuis l'administration du portail CSE.",
      html: "<p>Ceci est un email de test envoye depuis l'administration du portail CSE.</p>"
    });
    await dbPool.query(
      "INSERT INTO email_outbox (id, type, recipient, subject, status, sent_at) VALUES ($1, 'test', $2, $3, 'sent', now())",
      [randomUUID(), recipient, "Test email portail CSE"]
    );
    await auditAdminAction(session, "mail.test_sent", { recipient });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    await dbPool.query(
      "INSERT INTO email_outbox (id, type, recipient, subject, payload, status) VALUES ($1, 'test', $2, $3, $4::jsonb, 'failed')",
      [randomUUID(), recipient, "Test email portail CSE", JSON.stringify({ error: error.message })]
    );
    sendJson(res, 422, { ok: false, error: "mail_failed", message: error.message });
  }
}

async function handleAdminAccountsList(req, res) {
  const result = await dbPool.query("SELECT * FROM admin_accounts ORDER BY created_at ASC");
  sendJson(res, 200, { ok: true, admins: result.rows.map((row) => ({ ...publicAdminAccount(row), active: row.active })) });
}

async function handleAdminAccountCreate(req, res, session) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 12_000));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }
  const email = cleanText(body.email, 180).toLowerCase();
  const displayName = cleanText(body.displayName, 120);
  const password = String(body.password || "");
  const role = body.role === "owner" ? "owner" : "editor";
  if (!isValidEmail(email) || password.length < 12) {
    sendJson(res, 422, { ok: false, error: "invalid_admin_account" });
    return;
  }
  try {
    const result = await dbPool.query(
      `INSERT INTO admin_accounts (id, email, password_hash, display_name, role, provider)
       VALUES ($1, $2, $3, $4, $5, 'local')
       RETURNING *`,
      [randomUUID(), email, await hashPassword(password), displayName || email, role]
    );
    await auditAdminAction(session, "admin.account_created", { accountId: result.rows[0].id, role });
    sendJson(res, 201, { ok: true, admin: { ...publicAdminAccount(result.rows[0]), active: result.rows[0].active } });
  } catch (error) {
    sendJson(res, 409, { ok: false, error: "admin_account_exists", message: error.message });
  }
}

async function handleAdminAccountUpdate(req, res, accountId, session) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 12_000));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }
  const existing = await dbPool.query("SELECT id, role, active FROM admin_accounts WHERE id = $1", [accountId]);
  if (!existing.rows.length) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }
  const current = existing.rows[0];
  const displayName = cleanText(body.displayName, 120);
  const active = body.active !== false;
  const role = ["owner", "editor"].includes(body.role) ? body.role : current.role;
  const password = String(body.password || "");
  if (accountId === session.admin.id && (!active || role !== "owner")) {
    sendJson(res, 422, { ok: false, error: "cannot_reduce_own_access" });
    return;
  }
  if (password && password.length < 12) {
    sendJson(res, 422, { ok: false, error: "password_too_short" });
    return;
  }

  if (current.role === "owner" && (!active || role !== "owner")) {
    const ownerCount = Number((await dbPool.query("SELECT count(*)::int AS count FROM admin_accounts WHERE role = 'owner' AND active = true")).rows[0].count);
    if (ownerCount <= 1) {
      sendJson(res, 422, { ok: false, error: "cannot_remove_last_owner" });
      return;
    }
  }

  const result = password
    ? await dbPool.query(
      `UPDATE admin_accounts
       SET display_name = $2, active = $3, role = $4, password_hash = $5, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [accountId, displayName, active, role, await hashPassword(password)]
    )
    : await dbPool.query(
      `UPDATE admin_accounts
       SET display_name = $2, active = $3, role = $4, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [accountId, displayName, active, role]
    );
  if (!active || role !== current.role || password) {
    await dbPool.query("DELETE FROM admin_sessions WHERE admin_id = $1", [accountId]);
  }
  await auditAdminAction(session, "admin.account_updated", { accountId, active, role, passwordChanged: Boolean(password) });
  sendJson(res, 200, { ok: true, admin: { ...publicAdminAccount(result.rows[0]), active: result.rows[0].active } });
}

async function handleAdminIdeaUpdate(req, res, ideaId, session) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 4_000));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const status = cleanText(body.status, 20);
  if (!ideaStatuses.has(status)) {
    sendJson(res, 422, { ok: false, error: "invalid_status" });
    return;
  }

  const db = await getIdeasDb();
  const idea = db.ideas.find((item) => item.id === ideaId);
  if (!idea) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  idea.status = status;
  idea.reviewedAt = new Date().toISOString();
  idea.reviewNote = cleanText(body.reviewNote, 240);
  idea.targetMeetingId = cleanText(body.targetMeetingId, 80);
  idea.updatedAt = new Date().toISOString();
  await saveIdeasDb(db);
  await auditAdminAction(session, "idea.updated", { ideaId, status: idea.status });
  sendJson(res, 200, { ok: true, idea });
}

async function handleAdminContentUpdate(req, res, session) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 2_000_000));
  } catch (error) {
    sendJson(res, error.message === "payload_too_large" ? 413 : 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const content = normalizeContent(body.content || body);
  const savedContent = await saveContent(content);
  await auditAdminAction(session, "content.updated", {
    news: savedContent.news.length,
    posts: savedContent.posts.length,
    meetings: savedContent.meetings.length,
    members: savedContent.members.length
  });
  sendJson(res, 200, { ok: true, content: savedContent });
}

function safeUploadName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName, ext)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
  return `${base}-${Date.now()}${ext}`;
}

async function handleAdminDocumentUpload(req, res, session) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 11_000_000));
  } catch (error) {
    sendJson(res, error.message === "payload_too_large" ? 413 : 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const originalName = cleanText(body.fileName, 160);
  const title = cleanText(body.title, 160);
  const description = cleanText(body.description, 160);
  const visibility = ["public", "private"].includes(body.visibility) ? body.visibility : "public";
  const base64 = String(body.dataBase64 || "");
  const ext = path.extname(originalName).toLowerCase();

  if (!title || ext !== ".pdf" || !base64) {
    sendJson(res, 422, { ok: false, error: "invalid_document" });
    return;
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 5 || bytes.length > 8_000_000 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    sendJson(res, 422, { ok: false, error: "invalid_pdf" });
    return;
  }

  await mkdir(uploadsDir, { recursive: true });
  const fileName = safeUploadName(originalName);
  await writeFile(path.join(uploadsDir, fileName), bytes);

  const content = await getContent();
  const document = {
    id: randomUUID(),
    title,
    description,
    url: `/uploads/${fileName}`,
    createdAt: new Date().toISOString(),
    visibility
  };
  content.documents.unshift(document);
  const savedContent = await saveContent(content);
  notify("Nouveau document CSE", `${document.title} (${document.visibility})`);
  await auditAdminAction(session, "document.uploaded", { documentId: document.id, visibility: document.visibility });
  sendJson(res, 201, { ok: true, document, content: savedContent });
}

async function serveFile(filePath, res, cacheControl = "public, max-age=3600") {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("not_file");
  const ext = path.extname(filePath).toLowerCase();
  setSecurityHeaders(res, { allowSameOriginFrame: ext === ".pdf" });
  res.writeHead(200, {
    "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
    "Cache-Control": cacheControl
  });
  res.end(await readFile(filePath));
}

async function serveUpload(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const fileName = path.basename(decodeURIComponent(url.pathname.replace("/uploads/", "")));
  if (!fileName || fileName.startsWith(".")) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  const requestedPath = path.normalize(path.join(uploadsDir, fileName));
  if (!requestedPath.startsWith(uploadsDir)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }

  try {
    const content = await getContent();
    const document = content.documents.find((item) => item.url === `/uploads/${fileName}`);
    if (document?.visibility === "private" && !(await getAdminSession(req))) {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    await serveFile(requestedPath, res);
  } catch {
    sendJson(res, 404, { ok: false, error: "not_found" });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin.html") {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }
  if (pathname.includes("\0") || pathname.split("/").some((part) => part.startsWith("."))) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  const requestedPath = path.normalize(path.join(publicDir, pathname));
  if (!requestedPath.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }

  try {
    await serveFile(requestedPath, res, path.extname(requestedPath).toLowerCase() === ".html" ? "no-cache" : "public, max-age=3600");
  } catch {
    sendJson(res, 404, { ok: false, error: "not_found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  setTransportSecurityHeader(req, res);

  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      sendJson(res, 200, { ok: true, ...(await getStats()) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/content") {
      sendJson(res, 200, { ok: true, content: getPublicContent(await getContent()) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ideas/approved") {
      const db = await getIdeasDb();
      const ideas = db.ideas
        .filter((idea) => publicIdeaStatuses.has(idea.status))
        .sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0) || String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(publicIdea);
      sendJson(res, 200, { ok: true, ideas });
      return;
    }

    const voteMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/vote$/);
    if (req.method === "POST" && voteMatch) {
      await handleIdeaVote(req, res, voteMatch[1]);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ideas") {
      await handleIdeaSubmission(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/login") {
      await handleAdminLogin(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/admin/")) {
      const session = await requireAdmin(req, res);
      if (!session) return;

      const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "");
      if (isMutation && !requireTrustedMutation(req, res, { json: url.pathname !== "/api/admin/logout" })) return;

      if (req.method === "GET" && url.pathname === "/api/admin/session") {
        sendJson(res, 200, { ok: true, admin: session.admin });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/logout") {
        await handleAdminLogout(req, res, session);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/content") {
        sendJson(res, 200, { ok: true, content: await getContent() });
        return;
      }

      if (req.method === "PUT" && url.pathname === "/api/admin/content") {
        await handleAdminContentUpdate(req, res, session);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/documents") {
        await handleAdminDocumentUpload(req, res, session);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/mail-settings") {
        if (!requireOwner(res, session)) return;
        sendJson(res, 200, { ok: true, settings: publicMailSettings(await getMailSettings()) });
        return;
      }

      if (req.method === "PUT" && url.pathname === "/api/admin/mail-settings") {
        if (!requireOwner(res, session)) return;
        await handleMailSettingsUpdate(req, res, session);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/mail-test") {
        if (!requireOwner(res, session)) return;
        await handleMailTest(req, res, session);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/admins") {
        if (!requireOwner(res, session)) return;
        await handleAdminAccountsList(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/admins") {
        if (!requireOwner(res, session)) return;
        await handleAdminAccountCreate(req, res, session);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/ideas.csv") {
        const db = await getIdeasDb();
        sendText(res, 200, "text/csv; charset=utf-8", ideasToCsv(db.ideas), `idees-cse-${new Date().toISOString().slice(0, 10)}.csv`);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/ideas") {
        const db = await getIdeasDb();
        sendJson(res, 200, { ok: true, ideas: db.ideas });
        return;
      }

      const adminIdeaMatch = url.pathname.match(/^\/api\/admin\/ideas\/([^/]+)$/);
      if (req.method === "PATCH" && adminIdeaMatch) {
        await handleAdminIdeaUpdate(req, res, adminIdeaMatch[1], session);
        return;
      }

      const adminAccountMatch = url.pathname.match(/^\/api\/admin\/admins\/([^/]+)$/);
      if (req.method === "PATCH" && adminAccountMatch) {
        if (!requireOwner(res, session)) return;
        await handleAdminAccountUpdate(req, res, adminAccountMatch[1], session);
        return;
      }
    }

    if (req.method === "GET" && adminPath && url.pathname === adminPath) {
      await serveFile(path.join(publicDir, "admin.html"), res, "no-cache");
      return;
    }

    if (req.method === "GET" && url.pathname === "/connexion-cse") {
      if (!adminPath) {
        sendJson(res, 404, { ok: false, error: "not_found" });
        return;
      }
      res.writeHead(302, { Location: adminPath, "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      await serveUpload(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: "server_error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CSE website listening on http://0.0.0.0:${port}`);
});
