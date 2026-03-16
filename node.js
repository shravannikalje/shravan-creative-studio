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
const DATA_DIR = path.join(ROOT_DIR, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const CUSTOM_DEVICES_FILE = path.join(DATA_DIR, "custom-devices.json");
const VISITORS_FILE = path.join(DATA_DIR, "visitors.json");
const LOGIN_FILE = path.join(ROOT_DIR, "login.html");
const ADMIN_FILE = path.join(ROOT_DIR, "admin.html");

const REQUESTED_AUTH_MODE = String(process.env.AUTH_MODE || "password").trim().toLowerCase();
const AUTH_MODE = REQUESTED_AUTH_MODE === "google" ? "google" : "password";
const ACCESS_PASSWORD = String(process.env.ACCESS_PASSWORD || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || ACCESS_PASSWORD || "").trim();
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || "change-this-session-secret").trim();
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

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

const VISITOR_START_TOTAL = toNonNegativeInteger(process.env.VISITOR_START_TOTAL, 300);
const VISITOR_START_TODAY = toNonNegativeInteger(process.env.VISITOR_START_TODAY, 100);

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
    return res.redirect("/login");
  }

  if (!req.session.user.isAdmin) {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ ok: false, error: "Admin access required" });
    }
    return res.status(403).send("Admin access required");
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

app.get(["/login", "/login.html"], async (req, res) => {
  if (req.session?.user) {
    return res.redirect("/");
  }

  try {
    const loginHtml = await fs.readFile(LOGIN_FILE, "utf8");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(loginHtml);
  } catch (error) {
    return res.status(500).send("Login page not found. Please create login.html.");
  }
});

app.post("/auth/password", (req, res) => {
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
    if (!password) {
      return res.status(400).json({ ok: false, error: "Password is required" });
    }

    const isAdmin = Boolean(ADMIN_PASSWORD) && password === ADMIN_PASSWORD;
    const canLogin = password === ACCESS_PASSWORD || isAdmin;
    if (!canLogin) {
      return res.status(401).json({ ok: false, error: "Invalid password" });
    }

    req.session.user = {
      email: "password-user@studio.local",
      name: isAdmin ? "Owner" : "User",
      picture: "",
      isAdmin,
      authType: "password"
    };

    return req.session.save(() => {
      res.json({ ok: true, user: req.session.user });
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Password login failed" });
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
      res.json({ ok: true, user: req.session.user });
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
    "/auth/google",
    "/auth/me",
    "/auth/logout",
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

  return res.redirect("/login");
});

app.get("/api/live-status", (req, res) => {
  res.json(getStudioStatus());
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
    const todayDate = new Date().toISOString().slice(0, 10);

    const todayCount = pageVisits.filter((visit) => {
      const visitDate = String(visit.date || visit.timestamp || "");
      return visitDate.startsWith(todayDate);
    }).length;

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

    if (todayOffset > 0) {
      dailyVisitCounter[todayDate] = (dailyVisitCounter[todayDate] || 0) + todayOffset;
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

    if (totalOffset > 0) {
      pageVisitCounter["/"] = (pageVisitCounter["/"] || 0) + totalOffset;
    }

    const topPages = Object.entries(pageVisitCounter)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, 7)
      .map(([page, count]) => ({ page, count }));

    res.json({
      ok: true,
      total: pageVisits.length + totalOffset,
      today: todayCount + todayOffset,
      uniqueIps,
      rawTotal: visitors.length,
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

  app.listen(PORT, () => {
    console.log(`Shravan Creative Studio backend running at http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
