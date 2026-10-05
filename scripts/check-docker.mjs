#!/usr/bin/env node
// Read-only HTTP smoke checks. No accounts, cookies, or provider calls.
const TIMEOUT_MS = 10_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class CheckFailure extends Error {}

function expect(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

function origin(variable, fallback) {
  const value = new URL(process.env[variable] || fallback);
  expect(
    ["http:", "https:"].includes(value.protocol) &&
      !value.username && !value.password &&
      value.pathname === "/" && !value.search && !value.hash,
    "invalid origin configuration",
  );
  return value.origin;
}

async function request(base, path, accept) {
  const url = new URL(path, base);
  expect(url.origin === base, "asset must stay on the configured origin");
  return fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function contentType(response, pattern) {
  expect(pattern.test(response.headers.get("content-type") || ""), "unexpected content type");
}

async function json(base, path, status = 200) {
  const response = await request(base, path, "application/json");
  expect(response.status === status, `expected HTTP ${status}, got ${response.status}`);
  contentType(response, /\bapplication\/json\b/i);
  try {
    return await response.json();
  } catch {
    throw new CheckFailure("invalid JSON response");
  }
}

function ready(payload) {
  expect(payload?.status === "ready", "API is not ready");
  expect(payload?.checks?.database === "ok", "database check is not ok");
  expect(payload?.checks?.redis === "ok", "Redis check is not ok");
}

function decodeAttribute(value) {
  return value.replaceAll("&amp;", "&");
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? decodeAttribute(match[1]) : "";
}

function imageSource(html, source, base) {
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attribute(tag[0], "src");
    if (!src) continue;
    const url = new URL(src, base);
    if (url.origin !== base) continue;
    if (url.pathname === source ||
        (url.pathname === "/_next/image" && url.searchParams.get("url") === source)) {
      return url.pathname + url.search;
    }
  }
  throw new CheckFailure("expected brand image is missing from page");
}

function staticAssets(html) {
  const assets = [];
  for (const tag of html.matchAll(/<(?:link|script)\b[^>]*>/gi)) {
    const path = attribute(tag[0], "src") || attribute(tag[0], "href");
    if (path.startsWith("/_next/static/") && /\.(?:css|js)(?:\?|$)/.test(path)) assets.push(path);
  }
  return assets;
}

async function page(base, path) {
  const response = await request(base, path, "text/html");
  expect(response.status === 200, `expected HTTP 200, got ${response.status}`);
  contentType(response, /\btext\/html\b/i);
  const html = await response.text();
  expect(/<html\b/i.test(html) && html.includes("KODMOD"), "expected KODMOD page is missing");
  return html;
}

async function png(base, path) {
  const response = await request(base, path, "image/png");
  expect(response.status === 200, `expected HTTP 200, got ${response.status}`);
  contentType(response, /\bimage\/png\b/i);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.length > 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE), "invalid PNG asset");
}

async function main() {
  let web;
  let api;
  try {
    web = origin("DOCKER_WEB_ORIGIN", "http://127.0.0.1:3100");
    api = origin("DOCKER_API_ORIGIN", "http://127.0.0.1:8109");
  } catch {
    console.error("FAIL origin configuration");
    process.exitCode = 1;
    return;
  }

  let failed = 0;
  const prefix = process.env.DOCKER_API_PREFIX || "";
  expect(prefix === "" || /^\/[a-zA-Z0-9_-]+$/.test(prefix), "invalid API prefix");
  const apiJson = (path, status = 200) => json(api, prefix + path, status);
  async function check(name, action) {
    try {
      await action();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      const detail = error instanceof CheckFailure ? error.message : "request failed or timed out";
      console.error(`FAIL ${name}: ${detail}`);
    }
  }

  if (web.startsWith("https://") && api === web && prefix === "/api") {
    await check("public metrics blocked for plain and encoded paths", async () => {
      for (const path of ["/metrics", "/api/metrics", "/api/metrics%2F", "/api/metrics%252F"]) {
        expect((await request(web, path, "text/plain")).status === 404, "public metrics path is accessible");
      }
    });
  }

  let landing;
  let login;
  await check("landing page", async () => { landing = await page(web, "/"); });
  await check("login page", async () => {
    login = await page(web, "/masuk");
    expect(login.includes("Senang bertemu lagi."), "expected login page is missing");
  });

  for (const [name, html, source] of [
    ["landing brand", landing, "/brand/symbol.png"],
    ["login brand", login, "/brand/logo.png"],
  ]) {
    await check(name, async () => {
      expect(typeof html === "string", "page could not be loaded");
      const displayedSource = imageSource(html, source, web);
      await png(web, source);
      if (displayedSource !== source) await png(web, displayedSource);
    });
  }

  await check("landing illustration", async () => {
    expect(typeof landing === "string" && typeof login === "string", "pages could not be loaded");
    const source = "/images/landing/hero-learning.svg";
    imageSource(landing, source, web);
    imageSource(login, source, web);
    const response = await request(web, source, "image/svg+xml");
    expect(response.status === 200, `expected HTTP 200, got ${response.status}`);
    contentType(response, /\bimage\/svg\+xml\b/i);
    expect(/<svg\b/.test(await response.text()), "invalid SVG asset");
  });

  await check("Next static CSS and JavaScript", async () => {
    for (const html of [landing, login]) {
      expect(typeof html === "string", "page could not be loaded");
      const paths = staticAssets(html);
      const css = paths.find((path) => /\.css(?:\?|$)/.test(path));
      const js = paths.find((path) => /\.js(?:\?|$)/.test(path));
      expect(css && js, "page is missing Next CSS or JavaScript");
      for (const [path, type] of [[css, /\btext\/css\b/i], [js, /\b(?:text|application)\/javascript\b/i]]) {
        const response = await request(web, path, "*/*");
        expect(response.status === 200, `expected HTTP 200, got ${response.status}`);
        contentType(response, type);
        expect((await response.arrayBuffer()).byteLength > 0, "empty static asset");
      }
    }
  });

  await check("API liveness", async () => {
    expect((await apiJson("/live"))?.status === "alive", "API is not alive");
  });
  await check("API readiness (DB and Redis)", async () => ready(await apiJson("/ready")));
  await check("guided, reviewed material and admin usage routes", async () => {
    const spec = await apiJson("/openapi.json");
    for (const path of ["/learning/start", "/quiz/active", "/teacher/quizzes/propose", "/admin/materials", "/admin/insights/ai-usage", "/classes/{class_id}/imports"]) expect(spec.paths?.[path], `missing ${path}`);
  });
  await check("web API fallback readiness (DB and Redis)", async () => ready(await json(web, "/api/ready")));
  await check("student page redirects to login", async () => {
    const response = await request(web, "/siswa", "text/html");
    expect([302, 303, 307, 308].includes(response.status), "expected login redirect");
    const location = response.headers.get("location");
    expect(location, "redirect is missing Location");
    const destination = new URL(location, web);
    expect(destination.origin === web && destination.pathname === "/masuk", "unexpected redirect destination");
  });
  await check("API rejects missing authentication", async () => { await apiJson("/auth/me", 401); });
  await check("web API fallback rejects missing authentication", async () => { await json(web, "/api/auth/me", 401); });

  process.exitCode = failed ? 1 : 0;
}

await main();
