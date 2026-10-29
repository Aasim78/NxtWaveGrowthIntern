import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const root = path.dirname(fileURLToPath(import.meta.url)),
  pub = path.join(root, "public"),
  dbFile = path.join(root, "data", "campaign.json"),
  PORT = Number(process.env.PORT || 3401),
  scrypt = promisify(crypto.scrypt);
const sessions = new Map(),
  attempts = new Map();
let writes = Promise.resolve();
const fresh = () => ({
  manager: null,
  sources: [],
  events: {},
  registrations: [],
});
async function read() {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  try {
    return { ...fresh(), ...JSON.parse(await fs.readFile(dbFile, "utf8")) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    let d = fresh();
    await save(d);
    return d;
  }
}
async function save(d) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  writes = writes.then(async () => {
    let t = dbFile + ".tmp";
    await fs.writeFile(t, JSON.stringify(d, null, 2), { mode: 0o600 });
    await fs.rename(t, dbFile);
  });
  return writes;
}
function json(res, n, d) {
  res.writeHead(n, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(d));
}
async function page(res, name) {
  try {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    res.end(await fs.readFile(path.join(pub, name)));
  } catch {
    json(res, 500, { error: "Page unavailable" });
  }
}
function getCookie(req) {
  let x = (req.headers.cookie || "")
    .split(";")
    .map((y) => y.trim())
    .find((y) => y.startsWith("build60_session="));
  return x ? decodeURIComponent(x.slice(16)) : "";
}
function session(req) {
  let t = getCookie(req),
    s = sessions.get(t);
  if (!s || s.until < Date.now()) {
    if (t) sessions.delete(t);
    return null;
  }
  s.until = Date.now() + 28800000;
  return s;
}
function setCookie(req, res, user) {
  let t = crypto.randomBytes(32).toString("base64url"),
    secure =
      req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
  sessions.set(t, { user, until: Date.now() + 28800000 });
  res.setHeader(
    "Set-Cookie",
    "build60_session=" +
      encodeURIComponent(t) +
      "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800" +
      (secure ? "; Secure" : ""),
  );
}
function clearCookie(req, res) {
  sessions.delete(getCookie(req));
  res.setHeader(
    "Set-Cookie",
    "build60_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
}
async function body(req) {
  if ((req.headers["content-type"] || "").split(";")[0] !== "application/json")
    throw Object.assign(Error("JSON required"), { status: 415 });
  let a = [],
    n = 0;
  for await (let c of req) {
    n += c.length;
    if (n > 16000)
      throw Object.assign(Error("Request too large"), { status: 413 });
    a.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(a).toString());
  } catch {
    throw Object.assign(Error("Invalid JSON"), { status: 400 });
  }
}
function text(x, n) {
  return typeof x === "string" ? x.trim().slice(0, n) : "";
}
function originOK(req) {
  if (!req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}
function slot(d, id) {
  return (
    d.events[id] ||
    (d.events[id] = { visits: 0, briefs: 0, shares: 0, signups: 0 })
  );
}
function findSource(d, id) {
  return d.sources.find((s) => s.id === id);
}
function base(req) {
  if (process.env.PUBLIC_BASE_URL)
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  return (
    (req.socket.encrypted || req.headers["x-forwarded-proto"] === "https"
      ? "https"
      : "http") +
    "://" +
    req.headers.host
  );
}
function safeEmail(x) {
  return (
    typeof x === "string" &&
    x.length < 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)
  );
}
const server = http.createServer(async (req, res) => {
  try {
    let u = new URL(req.url, "http://" + (req.headers.host || "localhost")),
      p = u.pathname;
    if (req.method === "GET" && p === "/style.css") {
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(await fs.readFile(path.join(pub, "style.css")));
    }
    if (req.method === "GET" && p === "/") return page(res, "index.html");
    if (req.method === "GET" && p === "/manager")
      return page(res, "manager.html");
    if (req.method === "GET" && p === "/setup") return page(res, "setup.html");
    if (p.startsWith("/api/") && req.method === "POST" && !originOK(req))
      return json(res, 403, { error: "Request origin rejected" });
    if (req.method === "GET" && p === "/api/setup-status") {
      let d = await read();
      return json(res, 200, { configured: !!d.manager });
    }
    if (req.method === "POST" && p === "/api/setup") {
      let d = await read();
      if (d.manager)
        return json(res, 409, { error: "Manager is already configured" });
      let b = await body(req),
        user = text(b.username, 80).toLowerCase(),
        pw = typeof b.password === "string" ? b.password : "";
      if (user.length < 3 || pw.length < 12)
        return json(res, 400, {
          error:
            "Username must be 3+ characters and password at least 12 characters.",
        });
      let salt = crypto.randomBytes(16),
        hash = await scrypt(pw, salt, 64);
      d.manager = {
        username: user,
        salt: salt.toString("hex"),
        hash: hash.toString("hex"),
      };
      await save(d);
      setCookie(req, res, user);
      return json(res, 201, { ok: true });
    }
    if (req.method === "POST" && p === "/api/login") {
      let ip = req.socket.remoteAddress || "unknown",
        a = attempts.get(ip) || { count: 0, until: 0 };
      if (a.until > Date.now())
        return json(res, 429, { error: "Too many attempts. Wait 15 minutes." });
      let b = await body(req),
        d = await read(),
        user = text(b.username, 80).toLowerCase(),
        pw = typeof b.password === "string" ? b.password : "",
        valid = false;
      if (d.manager && user === d.manager.username) {
        let h = await scrypt(pw, Buffer.from(d.manager.salt, "hex"), 64),
          expect = Buffer.from(d.manager.hash, "hex");
        valid = h.length === expect.length && crypto.timingSafeEqual(h, expect);
      }
      if (!valid) {
        a.count++;
        if (a.count >= 5) {
          a.count = 0;
          a.until = Date.now() + 900000;
        }
        attempts.set(ip, a);
        return json(res, 401, { error: "Username or password is incorrect." });
      }
      attempts.delete(ip);
      setCookie(req, res, user);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/api/logout") {
      clearCookie(req, res);
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && p === "/api/source") {
      let d = await read(),
        s = findSource(d, text(u.searchParams.get("ref"), 100));
      let id = s ? s.id : "direct";
      if (s) slot(d, id).visits++;
      else slot(d, "direct").visits++;
      await save(d);
      return json(res, 200, {
        ref: id,
        label: s ? s.label : "Direct visit",
        role: s ? s.role : "Direct",
      });
    }
    if (req.method === "POST" && p === "/api/track") {
      let b = await body(req),
        d = await read(),
        s = findSource(d, text(b.ref, 100)),
        id = s ? s.id : "direct",
        field = { brief: "briefs", share: "shares" }[b.event];
      if (!field) return json(res, 400, { error: "Unknown event" });
      slot(d, id)[field]++;
      await save(d);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/api/register") {
      let b = await body(req),
        name = text(b.name, 80),
        email = text(b.email, 254).toLowerCase(),
        college = text(b.college, 120),
        year = text(b.graduationYear, 30);
      if (!name || !safeEmail(email) || !college || !year || b.consent !== true)
        return json(res, 400, {
          error: "Complete all fields and agree to the data-use notice.",
        });
      let d = await read();
      if (d.registrations.some((x) => x.email === email))
        return json(res, 409, { error: "This email is already registered." });
      let s = findSource(d, text(b.ref, 100)),
        id = s ? s.id : "direct";
      d.registrations.unshift({
        id: crypto.randomUUID(),
        name,
        email,
        college,
        graduationYear: year,
        source: s
          ? { id: s.id, label: s.label, role: s.role }
          : { id: "direct", label: "Direct / untagged", role: "Direct" },
        registeredAt: new Date().toISOString(),
      });
      slot(d, id).signups++;
      await save(d);
      return json(res, 201, { ok: true });
    }
    if (p.startsWith("/api/manager/")) {
      if (!session(req))
        return json(res, 401, { error: "Manager login required" });
      if (req.method === "GET" && p === "/api/manager/dashboard") {
        let d = await read(),
          sources = d.sources.map((s) => ({
            ...s,
            ...(d.events[s.id] || {
              visits: 0,
              briefs: 0,
              shares: 0,
              signups: 0,
            }),
          })),
          all = sources.concat([
            {
              id: "direct",
              label: "Direct / untagged",
              role: "Direct",
              ...(d.events.direct || {
                visits: 0,
                briefs: 0,
                shares: 0,
                signups: 0,
              }),
            },
          ]),
          totals = all.reduce(
            (a, x) => ({
              visits: a.visits + x.visits,
              briefs: a.briefs + x.briefs,
              shares: a.shares + x.shares,
              signups: a.signups + x.signups,
            }),
            { visits: 0, briefs: 0, shares: 0, signups: 0 },
          );
        return json(res, 200, {
          username: d.manager.username,
          totals,
          sources,
          registrations: d.registrations.slice(0, 300),
        });
      }
      if (req.method === "POST" && p === "/api/manager/sources") {
        let b = await body(req),
          role = text(b.role, 40),
          label = text(b.label, 80),
          valid = [
            "Campus representative",
            "College club",
            "Student group",
            "Social media",
          ];
        if (!valid.includes(role) || label.length < 2)
          return json(res, 400, {
            error: "Choose a sharing role and enter a source name.",
          });
        let d = await read(),
          id = crypto.randomBytes(9).toString("base64url"),
          s = { id, role, label, createdAt: new Date().toISOString() };
        d.sources.unshift(s);
        slot(d, id);
        await save(d);
        return json(res, 201, {
          ...s,
          link: base(req) + "/?ref=" + encodeURIComponent(id),
        });
      }
    }
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    if (!res.headersSent)
      json(res, e.status || 500, {
        error: e.status ? e.message : "Request could not be completed.",
      });
  }
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("Build60 running at http://localhost:" + PORT);
  console.log("Open /setup for first-time manager setup.");
});
