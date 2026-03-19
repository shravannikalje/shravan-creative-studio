const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");
const session = require("express-session");
const dotenv = require("dotenv");
const { OAuth2Client } = require("google-auth-library");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
let APP_VERSION = "0.0.0";

try {
  const packageJson = require(path.join(ROOT_DIR, "package.json"));
  APP_VERSION = String(packageJson?.version || APP_VERSION).trim() || APP_VERSION;
} catch {
  APP_VERSION = "0.0.0";
}

const DATA_DIR = path.join(ROOT_DIR, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const CUSTOM_DEVICES_FILE = path.join(DATA_DIR, "custom-devices.json");
const VISITORS_FILE = path.join(DATA_DIR, "visitors.json");
const VISITOR_AUTO_STATE_FILE = path.join(DATA_DIR, "visitor-auto-state.json");
const ADMIN_ACCESS_REQUESTS_FILE = path.join(DATA_DIR, "admin-access-requests.json");
const LOGIN_FILE = path.join(ROOT_DIR, "login.html");
const ADMIN_FILE = path.join(ROOT_DIR, "admin.html");

const REQUESTED_AUTH_MODE = String(process.env.AUTH_MODE || "password").trim().toLowerCase();
const AUTH_MODE = REQUESTED_AUTH_MODE === "google" ? "google" : "password";
const ACCESS_PASSWORD = String(process.env.ACCESS_PASSWORD || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || ACCESS_PASSWORD || "").trim();
const OWNER_DIRECT_ADMIN_PASSWORD = String(process.env.OWNER_DIRECT_ADMIN_PASSWORD || "7823").trim();
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || "change-this-session-secret").trim();
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
const BUILD_TAG = String(process.env.BUILD_TAG || "").trim();
const DEPLOY_COMMIT = String(
  process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || ""
).trim();
const DEPLOY_BRANCH = String(
  process.env.RENDER_GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || ""
).trim();
const APP_BOOTED_AT = new Date().toISOString();
const ALLOWED_EMAILS = String(process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const CUSTOM_SECTION_EMAILS = String(process.env.CUSTOM_SECTION_EMAILS || process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const CUSTOM_SECTION_PHONE_ONLY = String(process.env.CUSTOM_SECTION_PHONE_ONLY || "true")
  .trim()
  .toLowerCase() !== "false";
const CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE =
  String(process.env.CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE || "true").trim().toLowerCase() !== "false";
const QUERY_LEAD_SOURCES = new Set([
  "whatsapp-inbound",
  "quick-whatsapp",
  "package",
  "estimate",
  "contact-form",
  "quick-query",
  "package-interest",
  "estimate-query",
  "contact-query"
]);

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

const VISITOR_START_TOTAL = toNonNegativeInteger(process.env.VISITOR_START_TOTAL, 500);
const VISITOR_START_TODAY = toNonNegativeInteger(process.env.VISITOR_START_TODAY, 100);
const VISITOR_AUTO_TOTAL_PER_DAY = toNonNegativeInteger(process.env.VISITOR_AUTO_TOTAL_PER_DAY, 50);
const VISITOR_AUTO_DAILY_BOOST = toNonNegativeInteger(process.env.VISITOR_AUTO_DAILY_BOOST, 20);

let visitorRuntimeTotalOffset = null;
let visitorRuntimeTodayOffset = null;

function resolveRuntimeVisitorOffsets(actualTotal, actualToday) {
  if (visitorRuntimeTotalOffset === null) {
    visitorRuntimeTotalOffset = Math.max(VISITOR_START_TOTAL - actualTotal, 0);
  }

  if (visitorRuntimeTodayOffset === null) {
    visitorRuntimeTodayOffset = Math.max(VISITOR_START_TODAY - actualToday, 0);
  }

  return {
    totalOffset: visitorRuntimeTotalOffset,
    todayOffset: visitorRuntimeTodayOffset
  };
}

const oauthClient = AUTH_MODE === "google" && GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
let trustedCustomDevices = {};
const adminApprovalStreams = new Map();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: "designer.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

const TRACKING_SKIP_PREFIXES = ["/api/", "/auth/"];
const TRACKING_SKIP_EXACT_PATHS = new Set([
  "/healthz",
  "/favicon.ico",
  "/login",
  "/login.html",
  "/admin",
  "/admin.html"
]);
const STATIC_FILE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".json",
  ".txt",
  ".xml"
]);

function shouldTrackVisitorRequest(req) {
  if (req.method !== "GET") return false;

  return shouldIncludeInPageAnalytics(req.path);
}

function normalizeTrackedPath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) return "/";

  const withoutQuery = value.split("?")[0].split("#")[0].trim();
  if (!withoutQuery) return "/";

  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

function shouldIncludeInPageAnalytics(rawPath) {
  const requestedPath = normalizeTrackedPath(rawPath);

  if (TRACKING_SKIP_PREFIXES.some((prefix) => requestedPath.startsWith(prefix))) {
    return false;
  }

  if (TRACKING_SKIP_EXACT_PATHS.has(requestedPath)) {
    return false;
  }

  const extension = path.extname(requestedPath).toLowerCase();
  if (extension && STATIC_FILE_EXTENSIONS.has(extension)) {
    return false;
  }

  return true;
}

app.use((req, res, next) => {
  if (shouldTrackVisitorRequest(req)) {
    recordVisitor(req).catch((error) => {
      console.error("Visitor tracking middleware failed", error);
    });
  }

  next();
});

async function ensureLeadStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(LEADS_FILE);
  } catch {
    await fs.writeFile(LEADS_FILE, "[]", "utf8");
  }
}

async function readLeads() {
  await ensureLeadStorage();
  const raw = await fs.readFile(LEADS_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLeads(leads) {
  await ensureLeadStorage();
  await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
}

async function ensureCustomDeviceStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(CUSTOM_DEVICES_FILE);
  } catch {
    await fs.writeFile(CUSTOM_DEVICES_FILE, "{}", "utf8");
  }
}

async function ensureVisitorStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(VISITORS_FILE);
  } catch {
    await fs.writeFile(VISITORS_FILE, "[]", "utf8");
  }
}

async function ensureAdminAccessRequestStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(ADMIN_ACCESS_REQUESTS_FILE);
  } catch {
    await fs.writeFile(ADMIN_ACCESS_REQUESTS_FILE, "[]", "utf8");
  }
}

async function readAdminAccessRequests() {
  await ensureAdminAccessRequestStorage();
  const raw = await fs.readFile(ADMIN_ACCESS_REQUESTS_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item));
  } catch {
    return [];
  }
}

async function writeAdminAccessRequests(requests) {
  await ensureAdminAccessRequestStorage();
  await fs.writeFile(ADMIN_ACCESS_REQUESTS_FILE, JSON.stringify(requests, null, 2), "utf8");
}

async function readVisitors() {
  await ensureVisitorStorage();
  const raw = await fs.readFile(VISITORS_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeVisitors(visitors) {
  await ensureVisitorStorage();
  await fs.writeFile(VISITORS_FILE, JSON.stringify(visitors, null, 2), "utf8");
}

function isIsoDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parseIsoDateOnlyAsUtc(value) {
  if (!isIsoDateOnly(value)) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTodayDateKeyUtc() {
  return new Date().toISOString().slice(0, 10);
}

function diffDateKeysInDays(startDateKey, endDateKey) {
  const start = parseIsoDateOnlyAsUtc(startDateKey);
  const end = parseIsoDateOnlyAsUtc(endDateKey);

  if (!start || !end) return 0;

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return 0;

  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

async function ensureVisitorAutoStateStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(VISITOR_AUTO_STATE_FILE);
  } catch {
    const initialState = {
      baseDate: getTodayDateKeyUtc()
    };

    await fs.writeFile(VISITOR_AUTO_STATE_FILE, JSON.stringify(initialState, null, 2), "utf8");
  }
}

async function readVisitorAutoState() {
  await ensureVisitorAutoStateStorage();

  try {
    const raw = await fs.readFile(VISITOR_AUTO_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const baseDate = String(parsed?.baseDate || "").trim();

    if (isIsoDateOnly(baseDate)) {
      return { baseDate };
    }
  } catch {
    // fallback handled below
  }

  const fallbackState = {
    baseDate: getTodayDateKeyUtc()
  };

  await fs.writeFile(VISITOR_AUTO_STATE_FILE, JSON.stringify(fallbackState, null, 2), "utf8");
  return fallbackState;
}

async function getVisitorAutoBoost(todayDateKey = getTodayDateKeyUtc()) {
  if (VISITOR_AUTO_TOTAL_PER_DAY <= 0 && VISITOR_AUTO_DAILY_BOOST <= 0) {
    return {
      totalBoost: 0,
      todayBoost: 0,
      baseDate: todayDateKey,
      elapsedDays: 0
    };
  }

  const state = await readVisitorAutoState();
  const normalizedBaseDate = isIsoDateOnly(state.baseDate) ? state.baseDate : todayDateKey;
  const baseDate = normalizedBaseDate > todayDateKey ? todayDateKey : normalizedBaseDate;
  const elapsedDays = diffDateKeysInDays(baseDate, todayDateKey);

  return {
    totalBoost: (elapsedDays * VISITOR_AUTO_TOTAL_PER_DAY) + VISITOR_AUTO_DAILY_BOOST,
    todayBoost: VISITOR_AUTO_DAILY_BOOST,
    baseDate,
    elapsedDays
  };
}

async function recordVisitor(req) {
  try {
    const pageRequested = req.path;
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 200);
    const referer = String(req.headers.referer || "").slice(0, 200);
    const ipAddress = String(req.ip || "").slice(0, 50);

    const visit = {
      timestamp: now,
      date,
      page: pageRequested,
      ip: ipAddress,
      userAgent,
      referer
    };

    const visitors = await readVisitors();
    visitors.push(visit);

    const recentVisitors = visitors.slice(-5000);
    await writeVisitors(recentVisitors);
  } catch (error) {
    console.error("Failed to record visitor", error);
  }
}

async function loadTrustedCustomDevices() {
  await ensureCustomDeviceStorage();

  try {
    const raw = await fs.readFile(CUSTOM_DEVICES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    trustedCustomDevices = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    trustedCustomDevices = {};
  }
}

async function persistTrustedCustomDevices() {
  await ensureCustomDeviceStorage();
  await fs.writeFile(CUSTOM_DEVICES_FILE, JSON.stringify(trustedCustomDevices, null, 2), "utf8");
}

function sanitizeText(value, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function sanitizeRedirectPath(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  if (!rawValue.startsWith("/") || rawValue.startsWith("//") || rawValue.includes("://")) {
    return "";
  }

  try {
    const parsed = new URL(rawValue, "http://localhost");
    const normalizedPath = `${parsed.pathname || "/"}${parsed.search || ""}${parsed.hash || ""}`;

    if (!normalizedPath.startsWith("/")) {
      return "";
    }

    if (normalizedPath.startsWith("/api/") || normalizedPath.startsWith("/auth/")) {
      return "";
    }

    return normalizedPath;
  } catch {
    return "";
  }
}

function isAdminRedirectPath(value) {
  return value === "/admin" || value === "/admin.html";
}

function getPostLoginRedirect(requestedPath, isAdmin = false) {
  const safeNextPath = sanitizeRedirectPath(requestedPath);

  if (isAdminRedirectPath(safeNextPath)) {
    return isAdmin ? "/admin" : "/";
  }

  if (!safeNextPath || safeNextPath === "/" || safeNextPath === "/login" || safeNextPath === "/login.html") {
    return "/";
  }

  return safeNextPath;
}

function redirectToLogin(req, res) {
  const nextPath = sanitizeRedirectPath(req.originalUrl || req.path || "/");

  if (!nextPath || nextPath === "/login" || nextPath === "/login.html") {
    return res.redirect("/login");
  }

  return res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

function buildLeadRecord(body, req) {
  const estimate = body?.estimate && typeof body.estimate === "object"
    ? {
        service: sanitizeText(body.estimate.service, 80),
        delivery: sanitizeText(body.estimate.delivery, 80),
        revisions: Number.isFinite(Number(body.estimate.revisions)) ? Number(body.estimate.revisions) : null,
        quantity: Number.isFinite(Number(body.estimate.quantity)) ? Number(body.estimate.quantity) : null,
        assetsReady: Boolean(body.estimate.assetsReady),
        total: Number.isFinite(Number(body.estimate.total)) ? Number(body.estimate.total) : null
      }
    : null;

  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    source: sanitizeText(body?.source, 60) || "website",
    name: sanitizeText(body?.name, 90),
    email: sanitizeText(body?.email, 140),
    phone: sanitizeText(body?.phone, 30),
    service: sanitizeText(body?.service, 90),
    budget: sanitizeText(body?.budget, 60),
    details: sanitizeText(body?.details, 1200),
    packageName: sanitizeText(body?.packageName, 90),
    packagePrice: sanitizeText(body?.packagePrice, 60),
    estimate,
    userAgent: sanitizeText(req.headers["user-agent"] || "", 300),
    createdAt: new Date().toISOString()
  };
}

function isQueryLeadRecord(lead) {
  const source = String(lead?.source || "").trim().toLowerCase();
  if (!source) return false;

  if (source.includes("query")) {
    return true;
  }

  if (source.includes("whatsapp")) {
    return true;
  }

  return QUERY_LEAD_SOURCES.has(source);
}

function mapLeadAsQueryRecordForClient(lead) {
  return {
    id: sanitizeText(lead?.id || "", 80),
    source: sanitizeText(lead?.source || "", 60),
    name: sanitizeText(lead?.name || "", 90),
    email: sanitizeText(lead?.email || "", 140),
    phone: sanitizeText(lead?.phone || "", 30),
    service: sanitizeText(lead?.service || lead?.packageName || "", 90),
    budget: sanitizeText(lead?.budget || lead?.packagePrice || "", 80),
    details: sanitizeText(lead?.details || "", 1200),
    createdAt: sanitizeText(lead?.createdAt || "", 80)
  };
}

function parseWhatsAppMessageTimestamp(rawTimestamp) {
  const parsed = Number(rawTimestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date().toISOString();
  }

  const epochMs = parsed > 10_000_000_000 ? parsed : parsed * 1000;
  const parsedDate = new Date(epochMs);
  if (Number.isNaN(parsedDate.getTime())) {
    return new Date().toISOString();
  }

  return parsedDate.toISOString();
}

function getWhatsAppMessagePreview(message) {
  const type = sanitizeText(message?.type || "", 40).toLowerCase();

  switch (type) {
    case "text":
      return sanitizeText(message?.text?.body || "", 1200) || "[text message]";
    case "button":
      return sanitizeText(message?.button?.text || "", 1200) || "[button reply]";
    case "interactive": {
      const interactive = message?.interactive || {};
      const buttonReply = sanitizeText(
        interactive?.button_reply?.title || interactive?.button_reply?.id || "",
        280
      );
      const listReply = sanitizeText(
        interactive?.list_reply?.title || interactive?.list_reply?.description || interactive?.list_reply?.id || "",
        280
      );

      return sanitizeText(buttonReply || listReply || "[interactive message]", 1200);
    }
    case "image":
      return sanitizeText(message?.image?.caption || "", 1200) || "[image]";
    case "video":
      return sanitizeText(message?.video?.caption || "", 1200) || "[video]";
    case "document":
      return sanitizeText(message?.document?.caption || "", 1200)
        || sanitizeText(message?.document?.filename || "", 280)
        || "[document]";
    case "audio":
      return "[audio message]";
    case "sticker":
      return "[sticker]";
    case "location": {
      const locationName = sanitizeText(message?.location?.name || "", 120);
      const locationAddress = sanitizeText(message?.location?.address || "", 300);
      const lat = Number(message?.location?.latitude);
      const lng = Number(message?.location?.longitude);
      const coords = Number.isFinite(lat) && Number.isFinite(lng)
        ? `${lat}, ${lng}`
        : "";

      return sanitizeText(
        [locationName, locationAddress, coords].filter(Boolean).join(" - "),
        1200
      ) || "[location shared]";
    }
    case "contacts":
      return "[contact card shared]";
    default:
      return sanitizeText(`[${type || "unknown"} message]`, 1200);
  }
}

function buildWhatsAppDedupKey(message, previewText = "") {
  const messageId = sanitizeText(message?.id || "", 220);
  if (messageId) {
    return `id:${messageId}`;
  }

  const from = sanitizeText(message?.from || "", 30);
  const timestamp = sanitizeText(message?.timestamp || "", 40);
  const compactPreview = sanitizeText(previewText || "", 180);
  return sanitizeText(`fallback:${from}:${timestamp}:${compactPreview}`, 300);
}

function buildWhatsAppLeadRecord({ message, contactName, businessNumber, previewText }) {
  const messageType = sanitizeText(message?.type || "unknown", 40).toLowerCase() || "unknown";
  const fromNumber = sanitizeText(message?.from || "", 30);
  const phoneNumber = fromNumber ? `+${fromNumber}` : "";
  const messagePreview = sanitizeText(previewText || getWhatsAppMessagePreview(message), 1200);
  const summaryParts = [
    messagePreview,
    phoneNumber ? `From: ${phoneNumber}` : "",
    businessNumber ? `To: ${businessNumber}` : "",
    `Type: ${messageType}`
  ].filter(Boolean);

  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    source: "whatsapp-inbound",
    name: sanitizeText(contactName || "WhatsApp User", 90),
    email: "",
    phone: phoneNumber,
    service: "WhatsApp Query",
    budget: "",
    details: sanitizeText(summaryParts.join(" | "), 1200),
    packageName: "",
    packagePrice: "",
    estimate: null,
    userAgent: "whatsapp-webhook",
    waMessageId: sanitizeText(message?.id || "", 220),
    waMessageType: messageType,
    createdAt: parseWhatsAppMessageTimestamp(message?.timestamp)
  };
}

async function ingestWhatsAppWebhookPayload(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  if (payload?.object !== "whatsapp_business_account" || !entries.length) {
    return { received: 0, inserted: 0 };
  }

  const leads = await readLeads();
  const existingMessageKeys = new Set(
    leads
      .map((lead) => {
        const waMessageId = sanitizeText(lead?.waMessageId || "", 220);
        if (waMessageId) {
          return `id:${waMessageId}`;
        }

        return sanitizeText(lead?.whatsappDedupKey || "", 300);
      })
      .filter(Boolean)
  );

  let received = 0;
  let inserted = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const messages = Array.isArray(value?.messages) ? value.messages : [];

      if (!messages.length) {
        continue;
      }

      const businessNumber = sanitizeText(value?.metadata?.display_phone_number || "", 40);
      const contactNameByWaId = new Map(
        contacts
          .map((contact) => [
            sanitizeText(contact?.wa_id || "", 30),
            sanitizeText(contact?.profile?.name || "", 90)
          ])
          .filter(([waId]) => Boolean(waId))
      );

      for (const message of messages) {
        received += 1;
        const previewText = getWhatsAppMessagePreview(message);
        const dedupKey = buildWhatsAppDedupKey(message, previewText);
        if (!dedupKey || existingMessageKeys.has(dedupKey)) {
          continue;
        }

        const waId = sanitizeText(message?.from || "", 30);
        const contactName = contactNameByWaId.get(waId) || "";

        const record = buildWhatsAppLeadRecord({
          message,
          contactName,
          businessNumber,
          previewText
        });

        record.whatsappDedupKey = dedupKey;

        leads.push(record);
        existingMessageKeys.add(dedupKey);
        inserted += 1;
      }
    }
  }

  if (inserted > 0) {
    await writeLeads(leads.slice(-2000));
  }

  return { received, inserted };
}

function isAllowedEmail(email) {
  return ALLOWED_EMAILS.includes(String(email || "").toLowerCase());
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || "").toLowerCase());
}

function sanitizeDeviceToken(value) {
  const token = sanitizeText(String(value || ""), 220);
  return /^[a-zA-Z0-9_-]{16,220}$/.test(token) ? token : "";
}

function sortAdminAccessRequestsDesc(requests) {
  const safeRequests = Array.isArray(requests)
    ? requests.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];

  return [...safeRequests].sort((a, b) => {
    const bKey = String(b.updatedAt || b.requestedAt || "");
    const aKey = String(a.updatedAt || a.requestedAt || "");
    return bKey.localeCompare(aKey);
  });
}

function getLatestAdminAccessRequestForDevice(requests, deviceToken) {
  return sortAdminAccessRequestsDesc(requests).find((request) => request.deviceToken === deviceToken) || null;
}

function mapAdminAccessRequestForClient(request) {
  return {
    id: request.id,
    deviceLabel: request.deviceLabel,
    requestedPath: request.requestedPath,
    status: request.status,
    requestedAt: request.requestedAt,
    reviewedAt: request.reviewedAt,
    reviewer: request.reviewer,
    userAgent: request.userAgent
  };
}

function emitAdminApprovalEvent(requestId, status) {
  const streamSet = adminApprovalStreams.get(requestId);
  if (!streamSet || !streamSet.size) return;

  const payload = JSON.stringify({
    requestId,
    status,
    timestamp: new Date().toISOString()
  });

  for (const stream of [...streamSet]) {
    if (!stream || stream.writableEnded || stream.destroyed) {
      streamSet.delete(stream);
      continue;
    }

    try {
      stream.write(`data: ${payload}\n\n`);
    } catch {
      streamSet.delete(stream);
    }
  }

  if (!streamSet.size) {
    adminApprovalStreams.delete(requestId);
  }
}

function addAdminApprovalStream(requestId, stream) {
  if (!adminApprovalStreams.has(requestId)) {
    adminApprovalStreams.set(requestId, new Set());
  }

  adminApprovalStreams.get(requestId).add(stream);
}

function removeAdminApprovalStream(requestId, stream) {
  const streamSet = adminApprovalStreams.get(requestId);
  if (!streamSet) return;

  streamSet.delete(stream);
  if (!streamSet.size) {
    adminApprovalStreams.delete(requestId);
  }
}

async function createOrRefreshAdminAccessRequest({ deviceToken, deviceLabel, userAgent, requestedPath }) {
  const requests = await readAdminAccessRequests();
  const now = new Date().toISOString();
  const latestRequest = getLatestAdminAccessRequestForDevice(requests, deviceToken);

  if (latestRequest && latestRequest.status === "pending") {
    latestRequest.deviceLabel = sanitizeText(deviceLabel, 140) || latestRequest.deviceLabel || "Unknown device";
    latestRequest.userAgent = sanitizeText(userAgent, 300) || latestRequest.userAgent || "";
    latestRequest.requestedPath = sanitizeRedirectPath(requestedPath) || latestRequest.requestedPath || "/admin";
    latestRequest.updatedAt = now;
    await writeAdminAccessRequests(requests);
    emitAdminApprovalEvent(latestRequest.id, "pending");
    return latestRequest;
  }

  const request = {
    id: `adminreq_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    deviceToken,
    deviceLabel: sanitizeText(deviceLabel, 140) || "Unknown device",
    requestedPath: sanitizeRedirectPath(requestedPath) || "/admin",
    status: "pending",
    userAgent: sanitizeText(userAgent, 300),
    requestedAt: now,
    updatedAt: now,
    reviewedAt: "",
    reviewer: ""
  };

  requests.push(request);
  await writeAdminAccessRequests(requests);
  emitAdminApprovalEvent(request.id, "pending");
  return request;
}

async function setAdminAccessRequestStatus(requestId, nextStatus, reviewer = "Owner") {
  const requests = await readAdminAccessRequests();
  const request = requests.find((item) => item.id === requestId);

  if (!request) {
    return null;
  }

  const now = new Date().toISOString();
  request.status = nextStatus;
  request.updatedAt = now;
  request.reviewedAt = now;
  request.reviewer = sanitizeText(reviewer, 100) || "Owner";

  await writeAdminAccessRequests(requests);
  emitAdminApprovalEvent(request.id, request.status);
  return request;
}

async function getVisibleAdminAccessRequests(limit = 12) {
  const requests = await readAdminAccessRequests();
  return sortAdminAccessRequestsDesc(requests)
    .slice(0, limit)
    .map(mapAdminAccessRequestForClient);
}

function getCustomDeviceToken(req) {
  return sanitizeDeviceToken(req.headers["x-custom-device-token"] || "");
}

function isMobileUserAgent(userAgent) {
  return /(android|iphone|ipad|ipod|mobile|windows phone|opera mini)/i.test(String(userAgent || ""));
}

async function canAccessCustomSection(req) {
  const user = req.session?.user;
  if (!user) return false;

  const email = String(user.email || "").toLowerCase();
  if (!email) return false;

  const authType = String(user.authType || "google").toLowerCase();
  if (authType !== "password") {
    const isAllowedEmailForCustom = CUSTOM_SECTION_EMAILS.includes(email);
    if (!isAllowedEmailForCustom) return false;
  }

  if (CUSTOM_SECTION_PHONE_ONLY && !isMobileUserAgent(req.headers["user-agent"])) {
    return false;
  }

  if (!CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE) {
    return true;
  }

  const deviceToken = getCustomDeviceToken(req);
  if (!deviceToken) {
    return false;
  }

  const trustedToken = sanitizeDeviceToken(trustedCustomDevices[email]);
  if (!trustedToken) {
    trustedCustomDevices[email] = deviceToken;
    await persistTrustedCustomDevices();
    return true;
  }

  return trustedToken === deviceToken;
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    return redirectToLogin(req, res);
  }

  if (!req.session.user.isAdmin) {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ ok: false, error: "Admin access required" });
    }
    return redirectToLogin(req, res);
  }

  return next();
}

function getStudioStatus() {
  const now = new Date();

  const timeString = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(now);

  const hour24 = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false
    }).format(now)
  );

  const isOpen = hour24 >= 10 && hour24 < 20;
  const second = now.getSeconds();
  const minute = now.getMinutes();

  const activeProjects = 3 + (minute % 4);
  const queueLength = 1 + (second % 5);
  const responseMinutes = isOpen ? 12 + (minute % 18) : 120 + (minute % 60);

  return {
    status: isOpen ? "online" : "offline",
    isOpen,
    studioTimeIST: timeString,
    responseWindow: isOpen
      ? `~${responseMinutes} minutes`
      : "Next live window: 10:00 AM - 8:00 PM IST",
    activeProjects,
    queueLength,
    timestamp: now.toISOString()
  };
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/version", (req, res) => {
  const shortCommit = DEPLOY_COMMIT ? DEPLOY_COMMIT.slice(0, 7) : "";

  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    version: sanitizeText(APP_VERSION, 40) || "0.0.0",
    buildTag: sanitizeText(BUILD_TAG, 120),
    commit: sanitizeText(shortCommit, 20),
    branch: sanitizeText(DEPLOY_BRANCH, 120),
    bootedAt: APP_BOOTED_AT,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/whatsapp/webhook", (req, res) => {
  const mode = sanitizeText(req.query?.["hub.mode"] || "", 40).toLowerCase();
  const verifyToken = sanitizeText(req.query?.["hub.verify_token"] || "", 220);
  const challenge = sanitizeText(req.query?.["hub.challenge"] || "", 500);

  if (!WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(503).send("WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured");
  }

  if (mode === "subscribe" && verifyToken === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge || "ok");
  }

  return res.status(403).send("Forbidden");
});

app.post("/api/whatsapp/webhook", async (req, res) => {
  try {
    const summary = await ingestWhatsAppWebhookPayload(req.body);

    if (summary.inserted > 0) {
      console.log(`[whatsapp] Stored ${summary.inserted} inbound message(s) from ${summary.received} received event(s)`);
    }

    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    console.error("Failed to process WhatsApp webhook", error);
    return res.status(500).json({ ok: false, error: "Failed to process WhatsApp webhook" });
  }
});

app.get(["/login", "/login.html"], async (req, res) => {
  const requestedNextPath = sanitizeRedirectPath(req.query?.next || "");
  const wantsAdminAccess = isAdminRedirectPath(requestedNextPath);

  if (req.session?.user && (!wantsAdminAccess || req.session.user.isAdmin)) {
    const redirectTo = getPostLoginRedirect(requestedNextPath, Boolean(req.session.user.isAdmin));
    return res.redirect(redirectTo);
  }

  try {
    const loginHtml = await fs.readFile(LOGIN_FILE, "utf8");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(loginHtml);
  } catch (error) {
    return res.status(500).send("Login page not found. Please create login.html.");
  }
});

app.post("/auth/password", async (req, res) => {
  try {
    if (AUTH_MODE !== "password") {
      return res.status(403).json({ ok: false, error: "Password login is disabled" });
    }

    if (!ACCESS_PASSWORD) {
      return res.status(500).json({
        ok: false,
        error: "Password login is not configured. Set ACCESS_PASSWORD in .env"
      });
    }

    const password = sanitizeText(req.body?.password || "", 120);
    const requestedNextPath = sanitizeRedirectPath(req.body?.next || "");
    const wantsAdminAccess = isAdminRedirectPath(requestedNextPath);
    const adminDeviceToken = sanitizeDeviceToken(req.body?.adminDeviceToken || "");
    const adminDeviceLabel = sanitizeText(req.body?.adminDeviceLabel || "", 140);
    if (!password) {
      return res.status(400).json({ ok: false, error: "Password is required" });
    }

    const isOwnerDirectAdminPassword = Boolean(OWNER_DIRECT_ADMIN_PASSWORD) && password === OWNER_DIRECT_ADMIN_PASSWORD;
    const isSharedAdminPassword = Boolean(ADMIN_PASSWORD) && password === ADMIN_PASSWORD;
    const canLogin = password === ACCESS_PASSWORD || isSharedAdminPassword || isOwnerDirectAdminPassword;
    if (!canLogin) {
      return res.status(401).json({ ok: false, error: "Invalid password" });
    }

    let grantAdminAccess = false;

    if (isOwnerDirectAdminPassword) {
      grantAdminAccess = true;
    }

    if (isSharedAdminPassword) {
      if (!adminDeviceToken) {
        return res.status(400).json({ ok: false, error: "Admin device verification failed. Refresh and try again." });
      }

      if (wantsAdminAccess) {
        const accessRequest = await createOrRefreshAdminAccessRequest({
          deviceToken: adminDeviceToken,
          deviceLabel: adminDeviceLabel,
          userAgent: req.headers["user-agent"],
          requestedPath: requestedNextPath || "/admin"
        });

        req.session.pendingAdminAccess = {
          requestId: accessRequest.id,
          deviceToken: adminDeviceToken,
          requestedNextPath: requestedNextPath || "/admin",
          requestedAt: new Date().toISOString()
        };

        return req.session.save(() => {
          res.status(202).json({
            ok: false,
            approvalRequired: true,
            requestId: accessRequest.id,
            status: accessRequest.status,
            message: "Owner verification pending"
          });
        });
      }
    }

    delete req.session.pendingAdminAccess;

    req.session.user = {
      email: "password-user@studio.local",
      name: grantAdminAccess ? "Owner" : "User",
      picture: "",
      isAdmin: grantAdminAccess,
      authType: "password"
    };

    return req.session.save(() => {
      const redirectTo = isOwnerDirectAdminPassword
        ? "/admin"
        : getPostLoginRedirect(requestedNextPath, grantAdminAccess);

      res.json({
        ok: true,
        user: req.session.user,
        redirectTo
      });
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Password login failed" });
  }
});

app.get("/auth/admin-approval-status", async (req, res) => {
  try {
    const requestId = sanitizeText(req.query?.requestId || "", 120);
    const pendingAdminAccess = req.session?.pendingAdminAccess;

    if (!requestId || !pendingAdminAccess || pendingAdminAccess.requestId !== requestId) {
      return res.status(404).json({ ok: false, status: "missing", error: "No pending admin approval found" });
    }

    const requests = await readAdminAccessRequests();
    const accessRequest = requests.find((request) => (
      request.id === requestId && request.deviceToken === pendingAdminAccess.deviceToken
    ));

    if (!accessRequest) {
      delete req.session.pendingAdminAccess;
      return req.session.save(() => {
        res.status(404).json({ ok: false, status: "missing", error: "Admin verify request not found" });
      });
    }

    if (accessRequest.status === "approved") {
      req.session.user = {
        email: "password-user@studio.local",
        name: "Owner",
        picture: "",
        isAdmin: true,
        authType: "password"
      };

      delete req.session.pendingAdminAccess;

      return req.session.save(() => {
        res.json({
          ok: true,
          approved: true,
          status: "approved",
          redirectTo: getPostLoginRedirect(pendingAdminAccess.requestedNextPath, true)
        });
      });
    }

    if (accessRequest.status === "rejected") {
      delete req.session.pendingAdminAccess;
      return req.session.save(() => {
        res.status(403).json({
          ok: false,
          approved: false,
          status: "rejected",
          error: "Owner ने verify नाही केलं. Admin panel access मिळाला नाही."
        });
      });
    }

    return res.json({
      ok: true,
      approved: false,
      status: "pending",
      message: "Owner verification pending"
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to check admin approval status" });
  }
});

app.get("/auth/admin-approval-stream", async (req, res) => {
  try {
    const requestId = sanitizeText(req.query?.requestId || "", 120);
    const pendingAdminAccess = req.session?.pendingAdminAccess;

    if (!requestId || !pendingAdminAccess || pendingAdminAccess.requestId !== requestId) {
      return res.status(404).json({ ok: false, error: "No pending admin approval stream found" });
    }

    const requests = await readAdminAccessRequests();
    const accessRequest = requests.find((request) => (
      request.id === requestId && request.deviceToken === pendingAdminAccess.deviceToken
    ));

    if (!accessRequest) {
      return res.status(404).json({ ok: false, error: "Admin verify request not found" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    addAdminApprovalStream(requestId, res);
    emitAdminApprovalEvent(requestId, accessRequest.status || "pending");

    const keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(":keepalive\n\n");
      }
    }, 20000);

    req.on("close", () => {
      clearInterval(keepAliveTimer);
      removeAdminApprovalStream(requestId, res);
      res.end();
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to open admin approval stream" });
  }
});

app.post("/auth/google", async (req, res) => {
  try {
    if (AUTH_MODE !== "google") {
      return res.status(403).json({
        ok: false,
        error: "Google login is disabled. Use password login."
      });
    }

    if (!GOOGLE_CLIENT_ID || !oauthClient) {
      return res.status(500).json({
        ok: false,
        error: "Google login is not configured. Set GOOGLE_CLIENT_ID in .env"
      });
    }

    const credential = sanitizeText(req.body?.credential || "", 5000);
    if (!credential) {
      return res.status(400).json({ ok: false, error: "Missing Google credential" });
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const email = String(payload?.email || "").toLowerCase();

    if (!payload?.email_verified || !email) {
      return res.status(403).json({ ok: false, error: "Email is not verified by Google" });
    }

    if (!isAllowedEmail(email)) {
      return res.status(403).json({
        ok: false,
        error: "This Gmail is not allowed for website access"
      });
    }

    req.session.user = {
      email,
      name: sanitizeText(payload?.name || email, 100),
      picture: sanitizeText(payload?.picture || "", 500),
      isAdmin: isAdminEmail(email),
      authType: "google"
    };

    return req.session.save(() => {
      res.json({
        ok: true,
        user: req.session.user,
        redirectTo: getPostLoginRedirect(req.body?.next, req.session.user.isAdmin)
      });
    });
  } catch (error) {
    return res.status(401).json({ ok: false, error: "Google login failed" });
  }
});

app.get("/auth/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, authenticated: false });
  }

  return res.json({ ok: true, authenticated: true, user: req.session.user });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("designer.sid");
    res.json({ ok: true });
  });
});

app.get(["/admin", "/admin.html"], requireAdmin, async (req, res) => {
  try {
    const adminHtml = await fs.readFile(ADMIN_FILE, "utf8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(adminHtml);
  } catch (error) {
    return res.status(500).send("Admin page not found. Please create admin.html.");
  }
});

app.use((req, res, next) => {
  const publicPaths = new Set([
    "/login",
    "/login.html",
    "/auth/password",
    "/auth/admin-approval-status",
    "/auth/admin-approval-stream",
    "/auth/google",
    "/auth/me",
    "/auth/logout",
    "/api/whatsapp/webhook",
    "/healthz",
    "/favicon.ico"
  ]);

  if (publicPaths.has(req.path)) {
    return next();
  }

  if (req.session?.user) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  return redirectToLogin(req, res);
});

app.get("/api/live-status", (req, res) => {
  res.json(getStudioStatus());
});

app.get("/api/admin-access/requests", requireAdmin, async (req, res) => {
  try {
    const requests = await getVisibleAdminAccessRequests();
    res.json({ ok: true, requests });
  } catch (error) {
    console.error("Failed to read admin access requests", error);
    res.status(500).json({ ok: false, error: "Failed to read admin access requests" });
  }
});

app.post("/api/admin-access/requests/:requestId/verify", requireAdmin, async (req, res) => {
  try {
    const requestId = sanitizeText(req.params.requestId || "", 120);
    const updatedRequest = await setAdminAccessRequestStatus(requestId, "approved", req.session?.user?.email || "Owner");

    if (!updatedRequest) {
      return res.status(404).json({ ok: false, error: "Admin access request not found" });
    }

    res.json({ ok: true, request: mapAdminAccessRequestForClient(updatedRequest) });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to verify admin access request" });
  }
});

app.post("/api/admin-access/requests/:requestId/unverify", requireAdmin, async (req, res) => {
  try {
    const requestId = sanitizeText(req.params.requestId || "", 120);
    const updatedRequest = await setAdminAccessRequestStatus(requestId, "rejected", req.session?.user?.email || "Owner");

    if (!updatedRequest) {
      return res.status(404).json({ ok: false, error: "Admin access request not found" });
    }

    res.json({ ok: true, request: mapAdminAccessRequestForClient(updatedRequest) });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to unverify admin access request" });
  }
});

app.get("/api/custom-access", async (req, res) => {
  try {
    const allowed = await canAccessCustomSection(req);

    res.json({
      ok: true,
      allowed,
      phoneOnly: CUSTOM_SECTION_PHONE_ONLY,
      trustedDeviceRequired: CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      allowed: false,
      error: "Custom access check failed"
    });
  }
});

app.get("/custom-content.html", async (req, res) => {
  if (!(await canAccessCustomSection(req))) {
    return res.status(404).send("Not found");
  }

  return res.sendFile(path.join(ROOT_DIR, "custom-content.html"));
});

app.get("/api/live-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const sendStatus = () => {
    const payload = getStudioStatus();
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendStatus();
  const intervalId = setInterval(sendStatus, 1000);

  req.on("close", () => {
    clearInterval(intervalId);
    res.end();
  });
});

app.post("/api/leads", async (req, res) => {
  try {
    const lead = buildLeadRecord(req.body, req);

    const leads = await readLeads();
    leads.push(lead);

    const recentLeads = leads.slice(-2000);
    await writeLeads(recentLeads);

    res.status(201).json({ ok: true, id: lead.id });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to store lead" });
  }
});

app.get("/api/leads", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const leads = await readLeads();
    const recent = leads.slice(-limit).reverse();

    res.json({
      ok: true,
      total: leads.length,
      leads: recent
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to read leads" });
  }
});

app.get("/api/queries", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 300);
    const leads = await readLeads();
    const queryLeads = leads.filter(isQueryLeadRecord);
    const recent = queryLeads
      .slice(-limit)
      .reverse()
      .map(mapLeadAsQueryRecordForClient);

    res.json({
      ok: true,
      total: queryLeads.length,
      queries: recent
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to read queries" });
  }
});

app.get("/api/leads/stats", requireAdmin, async (req, res) => {
  try {
    const leads = await readLeads();
    const bySource = leads.reduce((acc, lead) => {
      const key = lead.source || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const todayDate = new Date().toISOString().slice(0, 10);
    const todayCount = leads.filter((lead) => String(lead.createdAt || "").startsWith(todayDate)).length;

    res.json({
      ok: true,
      total: leads.length,
      today: todayCount,
      bySource
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to read lead stats" });
  }
});

app.get("/api/visitors/stats", requireAdmin, async (req, res) => {
  try {
    const visitors = await readVisitors();
    const pageVisits = visitors.filter((visit) => shouldIncludeInPageAnalytics(visit.page));
    const todayDate = getTodayDateKeyUtc();

    const todayCount = pageVisits.filter((visit) => {
      const visitDate = String(visit.date || visit.timestamp || "");
      return visitDate.startsWith(todayDate);
    }).length;

    const autoBoost = await getVisitorAutoBoost(todayDate);
    const totalAutoBoost = autoBoost.totalBoost;
    const todayAutoBoost = autoBoost.todayBoost;

    const { totalOffset, todayOffset } = resolveRuntimeVisitorOffsets(pageVisits.length, todayCount);
    const nonTodayOffset = Math.max(totalOffset - todayOffset, 0);

    const uniqueIps = new Set(
      pageVisits
        .map((visit) => String(visit.ip || "").trim())
        .filter(Boolean)
    ).size;

    const dailyVisitCounter = pageVisits.reduce((acc, visit) => {
      const dateKey = String(visit.date || visit.timestamp || "").slice(0, 10);
      if (!dateKey) return acc;

      acc[dateKey] = (acc[dateKey] || 0) + 1;
      return acc;
    }, {});

    if (todayOffset > 0 || todayAutoBoost > 0) {
      dailyVisitCounter[todayDate] = (dailyVisitCounter[todayDate] || 0) + todayOffset + todayAutoBoost;
    }

    if (nonTodayOffset > 0) {
      const seedDate = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      dailyVisitCounter[seedDate] = (dailyVisitCounter[seedDate] || 0) + nonTodayOffset;
    }

    const dailyVisits = Object.entries(dailyVisitCounter)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .reverse()
      .map(([date, count]) => ({ date, count }));

    const pageVisitCounter = pageVisits.reduce((acc, visit) => {
      const pageKey = normalizeTrackedPath(visit.page);
      acc[pageKey] = (acc[pageKey] || 0) + 1;
      return acc;
    }, {});

    if (totalOffset > 0 || totalAutoBoost > 0) {
      pageVisitCounter["/"] = (pageVisitCounter["/"] || 0) + totalOffset + totalAutoBoost;
    }

    const topPages = Object.entries(pageVisitCounter)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, 7)
      .map(([page, count]) => ({ page, count }));

    res.json({
      ok: true,
      total: pageVisits.length + totalOffset + totalAutoBoost,
      today: todayCount + todayOffset + todayAutoBoost,
      uniqueIps,
      rawTotal: visitors.length,
      autoBoost: {
        totalPerDay: VISITOR_AUTO_TOTAL_PER_DAY,
        todayPerDay: VISITOR_AUTO_DAILY_BOOST,
        baseDate: autoBoost.baseDate,
        elapsedDays: autoBoost.elapsedDays
      },
      dailyVisits,
      topPages
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to read visitor stats" });
  }
});

app.use(express.static(ROOT_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.use((req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

async function bootstrap() {
  await ensureLeadStorage();
  await loadTrustedCustomDevices();

  console.log(`[auth] mode: ${AUTH_MODE}`);

  if (AUTH_MODE === "password") {
    if (!ACCESS_PASSWORD) {
      console.warn("[auth] ACCESS_PASSWORD is missing in .env");
    }

    if (!ADMIN_PASSWORD) {
      console.warn("[auth] ADMIN_PASSWORD is missing in .env (admin panel will be inaccessible)");
    }
  } else {
    if (!GOOGLE_CLIENT_ID) {
      console.warn("[auth] GOOGLE_CLIENT_ID is missing in .env");
    }

    if (!ALLOWED_EMAILS.length) {
      console.warn("[auth] ALLOWED_EMAILS is empty in .env");
    }

    if (!ADMIN_EMAILS.length) {
      console.warn("[auth] ADMIN_EMAILS is empty in .env");
    }
  }

  if (AUTH_MODE !== "password" && !CUSTOM_SECTION_EMAILS.length) {
    console.warn("[custom] CUSTOM_SECTION_EMAILS is empty in .env");
  }

  if (CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE) {
    console.log("[custom] Trusted device lock enabled (first allowed mobile device will be paired)");
  }

  if (!WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.warn("[whatsapp] WHATSAPP_WEBHOOK_VERIFY_TOKEN is missing in .env (inbound WhatsApp webhook verification will fail)");
  }

  app.listen(PORT, () => {
    console.log(`Shravan Creative Studio backend running at http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
