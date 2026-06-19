import http from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv(path.join(__dirname, ".env"));

const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const uploadsDir = path.join(dataDir, "uploads");
const contentFile = path.join(dataDir, "content.json");
const ideasFile = path.join(dataDir, "ideas.json");
const legacyIdeasFile = path.join(dataDir, "ideas.jsonl");
const port = Number(process.env.PORT || 8080);
const adminToken = process.env.ADMIN_TOKEN || "";
const adminPath = process.env.ADMIN_PATH ? normalizeAdminPath(process.env.ADMIN_PATH) : "";
const notificationWebhook = process.env.CSE_NOTIFICATION_WEBHOOK || "";
const databaseUrl = process.env.DATABASE_URL || "";
let dbPool = null;

const ideaStatuses = new Set(["pending", "approved", "in_progress", "treated", "rejected"]);
const publicIdeaStatuses = new Set(["approved", "in_progress"]);

const rateLimitWindowMs = 10 * 60 * 1000;
const rateLimitMax = 5;
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

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' https://images.unsplash.com https://plus.unsplash.com data:",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
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
  return `"${String(value ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
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

function requireAdmin(req, res) {
  if (!adminToken || adminToken.length < 48) {
    sendJson(res, 503, { ok: false, error: "admin_not_configured" });
    return false;
  }
  const token = req.headers["x-admin-token"];
  if (!safeEqual(token, adminToken)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function getClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0] || req.socket.remoteAddress || "local";
  return createHash("sha256").update(rawIp).digest("hex");
}

function isRateLimited(req) {
  const now = Date.now();
  const key = getClientKey(req);
  const bucket = rateBuckets.get(key) || [];
  const recent = bucket.filter((timestamp) => now - timestamp < rateLimitWindowMs);
  if (recent.length >= rateLimitMax) {
    rateBuckets.set(key, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return false;
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpFile, filePath);
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
      body: cleanLongText(item.body, 5000),
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
      photo: cleanText(item.photo, 1_000_000),
      email: cleanText(item.email, 120)
    })).filter((item) => item.firstName || item.lastName) : []
  };
}

async function getContent() {
  if (dbPool) return getContentFromDatabase();
  return getFileContent();
}

async function getFileContent() {
  const content = normalizeContent(await readJson(contentFile, defaultContent));
  if (!content.news.length && !content.posts.length && !content.meetings.length && !content.documents.length && !content.members.length) {
    return structuredClone(defaultContent);
  }
  return content;
}

async function saveContent(content) {
  if (dbPool) return saveContentToDatabase(content);
  const normalized = normalizeContent(content);
  await writeJson(contentFile, normalized);
  return normalized;
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
  if (databaseUrl) {
    await initializeDatabase();
    await migrateFilesToDatabase();
    return;
  }

  await migrateLegacyIdeas();
}

async function initializeDatabase() {
  const { Pool } = await import("pg");
  dbPool = new Pool({ connectionString: databaseUrl });
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
      display_name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'member',
      provider text NOT NULL DEFAULT 'local',
      provider_subject text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

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
  `);
}

async function migrateFilesToDatabase() {
  const contentCount = Number((await dbPool.query("SELECT count(*)::int AS count FROM app_content")).rows[0].count);
  if (contentCount === 0) {
    await saveContentToDatabase(await getFileContent());
  }

  const ideasCount = Number((await dbPool.query("SELECT count(*)::int AS count FROM ideas")).rows[0].count);
  if (ideasCount === 0) {
    const fileDb = await getFileIdeasDb();
    if (fileDb.ideas.length) {
      await saveIdeasToDatabase(fileDb);
    }
  }
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
  if (dbPool) return getIdeasFromDatabase();
  return getFileIdeasDb();
}

async function getFileIdeasDb() {
  const db = await readJson(ideasFile, { ideas: [] });
  if (Array.isArray(db.ideas)) {
    return { ideas: db.ideas.map(normalizeIdea).filter((idea) => idea.message) };
  }

  return { ideas: [] };
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

async function migrateLegacyIdeas() {
  try {
    const db = await getIdeasDb();
    if (db.ideas.length) return;
    const content = await readFile(legacyIdeasFile, "utf8");
    const legacyIdeas = content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    if (!legacyIdeas.length) return;
    await writeJson(ideasFile, {
      ideas: legacyIdeas.map((idea) => ({
        id: cleanText(idea.id, 80) || randomUUID(),
        createdAt: cleanText(idea.createdAt, 40) || new Date().toISOString(),
        category: cleanText(idea.category, 80) || "general",
        message: cleanLongText(idea.message, 1200),
        context: cleanText(idea.context, 240),
        status: "pending",
        votes: 0,
        reviewedAt: "",
        reviewNote: "",
        targetMeetingId: "",
        updatedAt: cleanText(idea.createdAt, 40) || new Date().toISOString()
      })).filter((idea) => idea.message)
    });
  } catch {
    // Legacy migration is best-effort.
  }
}

await initializeStorage();

async function saveIdeasDb(db) {
  if (dbPool) {
    await saveIdeasToDatabase(db);
    return;
  }
  await writeJson(ideasFile, { ideas: Array.isArray(db.ideas) ? db.ideas : [] });
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
  if (isRateLimited(req)) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
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
  if (isRateLimited(req)) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
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

async function handleAdminIdeaUpdate(req, res, ideaId) {
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
  sendJson(res, 200, { ok: true, idea });
}

async function handleAdminContentUpdate(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req, 2_000_000));
  } catch (error) {
    sendJson(res, error.message === "payload_too_large" ? 413 : 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const content = normalizeContent(body.content || body);
  sendJson(res, 200, { ok: true, content: await saveContent(content) });
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

async function handleAdminDocumentUpload(req, res) {
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
  sendJson(res, 201, { ok: true, document, content: savedContent });
}

async function serveFile(filePath, res, cacheControl = "public, max-age=3600") {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("not_file");
  const ext = path.extname(filePath).toLowerCase();
  setSecurityHeaders(res);
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
    if (document?.visibility === "private" && (!adminToken || adminToken.length < 48 || !safeEqual(req.headers["x-admin-token"], adminToken))) {
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

    if (url.pathname.startsWith("/api/admin/")) {
      if (!requireAdmin(req, res)) return;

      if (req.method === "GET" && url.pathname === "/api/admin/session") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/content") {
        sendJson(res, 200, { ok: true, content: await getContent() });
        return;
      }

      if (req.method === "PUT" && url.pathname === "/api/admin/content") {
        await handleAdminContentUpdate(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/documents") {
        await handleAdminDocumentUpload(req, res);
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
        await handleAdminIdeaUpdate(req, res, adminIdeaMatch[1]);
        return;
      }
    }

    if (req.method === "GET" && adminPath && url.pathname === adminPath) {
      await serveFile(path.join(publicDir, "admin.html"), res, "no-cache");
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
