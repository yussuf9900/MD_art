import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import handler, { publicCatalog } from "../server/handler.js";
import { read, write, namespace } from "../server/store.js";
import { seed } from "../server/seed.js";
import { restore } from "../server/validation.js";
import { analytics } from "../server/analytics.js";
let server, base, directory, cookie, current;
const initial = "initial-local-password";
const changed = "changed-local-password";
async function request(
  route,
  { method = "GET", data, session = cookie, origin = base } = {},
) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(session ? { Cookie: session } : {}),
      ...(method !== "GET"
        ? { Origin: origin, "Content-Type": "application/json" }
        : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function state() {
  const result = await request("/api/admin/state");
  assert.equal(result.status, 200);
  current = result.data;
  return current.data;
}
async function change(
  resource,
  value,
  id = "",
  method = "POST",
  revision = current.revision,
) {
  const result = await request(`/api/admin/${resource}${id ? `/${id}` : ""}`, {
    method,
    data: { revision, value },
  });
  if (result.status === 200) await state();
  return result;
}
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "mdart-test-"));
  process.env.MDART_LOCAL_DATA = "1";
  process.env.MDART_DATA_DIR = directory;
  process.env.SESSION_SECRET =
    "test-only-session-secret-at-least-32-characters";
  process.env.ADMIN_INITIAL_PASSWORD = initial;
  delete process.env.VERCEL;
  delete process.env.APP_ORIGIN;
  delete process.env.VERCEL_ANALYTICS_TOKEN;
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});
test("public catalogue exposes three seeds, no private records or credentials", async () => {
  const result = await request("/api/catalog", { session: "" });
  assert.equal(result.status, 200);
  assert.equal(result.data.artworks.length, 3);
  assert.equal(result.data.settings.location, "Italie");
  assert.equal(result.data.artworks[0].priceEUR, 2400);
  assert.equal(result.data.artworks[0].priceXOF, null);
  assert.ok(!("inquiries" in result.data));
  assert.ok(!("audit" in result.data));
  const again = await request("/api/catalog", { session: "" });
  assert.deepEqual(result.data, again.data);
});
test("unauthenticated API access is denied", async () => {
  assert.equal(
    (await request("/api/admin/state", { session: "" })).status,
    401,
  );
  assert.equal(
    (
      await request("/api/admin/settings", {
        session: "",
        method: "POST",
        data: {},
      })
    ).status,
    401,
  );
});
test("cross-origin login and missing origin are denied", async () => {
  assert.equal(
    (
      await request("/api/auth/login", {
        session: "",
        method: "POST",
        origin: "https://evil.example",
        data: { username: "admin", password: initial },
      })
    ).status,
    403,
  );
});
test("wrong credentials are denied and correct initial credentials require password change", async () => {
  assert.equal(
    (
      await request("/api/auth/login", {
        session: "",
        method: "POST",
        data: { username: "admin", password: "incorrect" },
      })
    ).status,
    401,
  );
  const result = await request("/api/auth/login", {
    session: "",
    method: "POST",
    data: { username: "admin", password: initial },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.mustChangePassword, true);
  cookie = result.cookie;
  assert.equal((await request("/api/admin/state")).status, 403);
  assert.equal(
    (await request("/api/auth/session")).data.mustChangePassword,
    true,
  );
});
test("password validation, first change, hashed storage and old password invalidation", async () => {
  assert.equal(
    (
      await request("/api/auth/password", {
        method: "POST",
        data: { currentPassword: initial, newPassword: "short" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/auth/password", {
        method: "POST",
        data: { currentPassword: "incorrect", newPassword: changed },
      })
    ).status,
    400,
  );
  const previous = cookie;
  const result = await request("/api/auth/password", {
    method: "POST",
    data: { currentPassword: initial, newPassword: changed },
  });
  assert.equal(result.status, 200);
  cookie = result.cookie;
  assert.equal(
    (await request("/api/auth/session", { session: previous })).status,
    401,
  );
  const stored = (await read("auth")).data;
  assert.equal(stored.mustChangePassword, false);
  assert.ok(!JSON.stringify(stored).includes(changed));
  assert.equal(
    (
      await request("/api/auth/login", {
        session: "",
        method: "POST",
        data: { username: "admin", password: initial },
      })
    ).status,
    401,
  );
  await state();
});
test("artwork validation and drafting hide works and private images from visitors", async () => {
  const original = current.data.artworks[0];
  assert.equal(
    (await change("artworks", { ...original, title: "", visibility: "draft" }))
      .status,
    400,
  );
  assert.equal(
    (await change("artworks", { ...original, imageIds: ["missing"] })).status,
    400,
  );
  assert.equal(
    (await change("artworks", { ...original, priceXOF: 12.5 })).status,
    400,
  );
  assert.equal(
    (
      await change("artworks", {
        ...original,
        title: "Nouvelle toile",
        visibility: "draft",
        order: 8,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/catalog", { session: "" })).data.artworks.length,
    3,
  );
  const draft = current.data.artworks.find((a) => a.title === "Nouvelle toile");
  assert.ok(draft.id);
  assert.equal(
    (
      await change(
        "artworks",
        { ...draft, visibility: "published", priceXOF: 100000, priceEUR: 250 },
        draft.id,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/catalog", { session: "" })).data.artworks.length,
    4,
  );
});
test("stale revisions and concurrent writes do not overwrite edits", async () => {
  const stale = current.revision;
  const a = current.data.artworks[0];
  assert.equal(
    (await change("artworks", { ...a, title: "Titre actualisé" }, a.id, "PUT"))
      .status,
    200,
  );
  assert.equal(
    (
      await change(
        "artworks",
        { ...a, title: "Écrasement interdit" },
        a.id,
        "PUT",
        stale,
      )
    ).status,
    409,
  );
  assert.equal(current.data.artworks[0].title, "Titre actualisé");
  const record = await read("gallery");
  const results = await Promise.allSettled([
    write("gallery", { ...record.data, schemaVersion: 1 }, record.revision),
    write(
      "gallery",
      { ...record.data, schemaVersion: 1, audit: [] },
      record.revision,
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  await state();
});
test("collections cannot be removed while referenced", async () => {
  assert.equal((await change("collections", null, "1", "DELETE")).status, 409);
  assert.equal(
    (await change("collections", { name: "Série italienne" })).status,
    200,
  );
  const c = current.data.collections.find((c) => c.name === "Série italienne");
  assert.equal(
    (await change("collections", { name: "Italie contemporaine" }, c.id, "PUT"))
      .status,
    200,
  );
  assert.equal((await change("collections", null, c.id, "DELETE")).status, 200);
});
test("media rejects non-image bytes, accepts PNG, edits alt, prevents used-image deletion", async () => {
  assert.equal(
    (
      await change("media", {
        base64: Buffer.from("<svg></svg>").toString("base64"),
        name: "bad.svg",
      })
    ).status,
    400,
  );
  const png = await readFile(new URL("./pixel.png", import.meta.url));
  const result = await change("media", {
    base64: png.toString("base64"),
    name: "test.png",
    alt: "Une image de test",
  });
  assert.equal(result.status, 200);
  const m = result.data.media;
  const response = await fetch(base + m.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(
    (await change("media", { alt: "Image modifiée" }, m.id, "PUT")).status,
    200,
  );
  const a = current.data.artworks[0];
  assert.equal(
    (
      await change(
        "artworks",
        { ...a, imageIds: [m.id, ...a.imageIds] },
        a.id,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal((await change("media", null, m.id, "DELETE")).status, 409);
});
test("featured work, social links, and contacts are validated", async () => {
  assert.equal(
    (
      await change("settings", {
        ...current.data.settings,
        instagram: "javascript:alert(1)",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await change("settings", {
        ...current.data.settings,
        featuredId: "missing",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await change("settings", {
        ...current.data.settings,
        email: "art@example.test",
        whatsapp: "+391234567890",
        featuredId: "2",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/catalog", { session: "" })).data.settings.featuredId,
    "2",
  );
});
test("inquiries persist, are idempotent, reject unavailable works and do not reserve automatically", async () => {
  const value = {
    artworkId: "1",
    submissionId: randomUUID(),
    name: "Client Test",
    email: "client@example.test",
    phone: "+39123456789",
    city: "Rome, Italie",
    message: "Informations",
    currency: "EUR",
    website: "",
  };
  assert.equal(
    (
      await request("/api/inquiries", {
        session: "",
        method: "POST",
        data: { ...value, email: "invalid" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/inquiries", {
        session: "",
        method: "POST",
        data: { ...value, website: "spam" },
      })
    ).status,
    400,
  );
  const first = await request("/api/inquiries", {
    session: "",
    method: "POST",
    data: value,
  });
  assert.equal(first.status, 201);
  const second = await request("/api/inquiries", {
    session: "",
    method: "POST",
    data: value,
  });
  assert.equal(second.data.id, first.data.id);
  assert.equal(
    (
      await request("/api/inquiries", {
        session: "",
        method: "POST",
        data: { ...value, submissionId: randomUUID(), artworkId: "3" },
      })
    ).status,
    409,
  );
  await state();
  assert.equal(current.data.inquiries.length, 1);
  assert.equal(current.data.artworks[0].status, "available");
  const publicData = JSON.stringify(
    (await request("/api/catalog", { session: "" })).data,
  );
  assert.ok(!publicData.includes("client@example.test"));
  assert.ok(!publicData.includes("Client Test"));
});
test("sales require accepted inquiries, preserve snapshots and follow payments and delivery", async () => {
  const i = current.data.inquiries[0];
  const value = {
    inquiryId: i.id,
    amount: 2400,
    currency: "EUR",
    payment: "pending",
    delivery: "preparing",
    tracking: "",
    notes: "",
  };
  assert.equal((await change("sales", value)).status, 400);
  assert.equal(
    (
      await change(
        "inquiries",
        { status: "accepted", notes: "Appeler le client" },
        i.id,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal((await change("sales", value)).status, 200);
  const s = current.data.sales[0];
  assert.equal(s.snapshot.title, "Titre actualisé");
  assert.equal((await change("sales", value)).status, 409);
  assert.equal(
    (
      await change(
        "sales",
        { ...s, payment: "paid", delivery: "shipped", tracking: "IT123" },
        s.id,
        "PUT",
      )
    ).status,
    200,
  );
  const a = current.data.artworks[0];
  assert.equal(
    (
      await change(
        "artworks",
        { ...a, title: "Titre changé après vente" },
        a.id,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(current.data.sales[0].snapshot.title, "Titre actualisé");
});
test("archive removes featured work from public catalogue without deleting requests", async () => {
  const a = current.data.artworks.find((a) => a.id === "2");
  assert.equal(
    (await change("artworks", { ...a, visibility: "archived" }, a.id, "PUT"))
      .status,
    200,
  );
  const data = (await request("/api/catalog", { session: "" })).data;
  assert.ok(!data.artworks.some((a) => a.id === "2"));
  assert.equal(data.settings.featuredId, "");
  assert.equal(current.data.inquiries.length, 1);
});
test("restore validates backup, refuses malicious media, keeps auth and preserves sale history", async () => {
  const snapshot = structuredClone(current.data);
  const bad = structuredClone(snapshot);
  bad.media[0].url = "javascript:alert(1)";
  assert.equal((await change("restore", bad)).status, 400);
  const duplicate = structuredClone(snapshot);
  duplicate.artworks.push(duplicate.artworks[0]);
  assert.equal((await change("restore", duplicate)).status, 400);
  assert.equal((await change("restore", snapshot)).status, 200);
  assert.equal(current.data.sales.length, 1);
  assert.equal((await request("/api/auth/session")).status, 200);
});
test("deletion preserves sales and inquiry snapshots; unused media can be removed", async () => {
  const a = current.data.artworks[0];
  const mediaId = a.imageIds[0];
  assert.equal((await change("artworks", null, a.id, "DELETE")).status, 200);
  assert.equal(current.data.sales[0].snapshot.title, "Titre actualisé");
  assert.equal(current.data.inquiries[0].artworkTitle, "Titre actualisé");
  assert.equal((await change("media", null, mediaId, "DELETE")).status, 200);
});
test("analytics configuration and API adapter preserve grouped metrics", async () => {
  assert.equal((await request("/api/admin/analytics")).data.available, false);
  assert.equal((await request("/api/admin/analytics?days=999")).status, 400);
  const originalFetch = globalThis.fetch;
  process.env.VERCEL_ANALYTICS_TOKEN = "test-only";
  process.env.VERCEL_ANALYTICS_PROJECT_ID = "prj_test";
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.vercel.com");
    assert.equal(parsed.searchParams.get("projectId"), "prj_test");
    assert.ok(parsed.searchParams.get("filter").includes("/admin"));
    return new Response(
      JSON.stringify({ data: [{ pageviews: 12, visitors: 8, country: "IT" }] }),
    );
  };
  try {
    const data = await analytics(7);
    assert.equal(data.available, true);
    assert.equal(data.reports.country[0].visitors, 8);
    assert.equal(data.events, null);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VERCEL_ANALYTICS_TOKEN;
    delete process.env.VERCEL_ANALYTICS_PROJECT_ID;
  }
});
test("preview and production storage namespaces are isolated, local mode is disabled on Vercel", () => {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  assert.equal(namespace(), "production");
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "feature/admin";
  const preview = namespace();
  assert.match(preview, /^preview-/);
  process.env.VERCEL_GIT_COMMIT_REF = "feature/other";
  assert.notEqual(namespace(), preview);
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_GIT_COMMIT_REF;
});
test("logout revokes session and login rate limiting blocks repeated attempts", async () => {
  const old = cookie;
  assert.equal(
    (await request("/api/auth/logout", { method: "POST", data: {} })).status,
    200,
  );
  assert.equal(
    (await request("/api/admin/state", { session: old })).status,
    401,
  );
  let last;
  for (let n = 0; n < 8; n++)
    last = await request("/api/auth/login", {
      session: "",
      method: "POST",
      data: { username: "admin", password: "incorrect" },
    });
  assert.equal(last.status, 429);
});
test("public serializer never exports private business lists", () => {
  const data = seed();
  data.inquiries.push({ email: "private@example.test" });
  data.sales.push({ amount: 10 });
  data.audit.push({ action: "secret" });
  assert.deepEqual(Object.keys(publicCatalog(data)).sort(), [
    "artworks",
    "collections",
    "customEventsEnabled",
    "media",
    "settings",
  ]);
});
