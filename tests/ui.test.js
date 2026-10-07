import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { seed } from "../server/seed.js";
import { publicCatalog } from "../server/handler.js";
import { loadCatalog, unavailableCatalog } from "../src/catalog.js";
import { artwork } from "../server/validation.js";

function dom(html) {
  const window = new JSDOM(html, {
    url: "http://localhost:5173",
    pretendToBeVisual: true,
  }).window;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.FormData = window.FormData;
  globalThis.confirm = () => true;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  return window;
}
async function eventually(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), "UI action did not reach its expected state");
}
async function click(selector) {
  const node = document.querySelector(selector);
  assert.ok(node, selector);
  node.click();
  await new Promise((resolve) => setImmediate(resolve));
}
function fill(form, name, value) {
  const input = form.elements.namedItem(name);
  assert.ok(input, name);
  input.value = value;
}
async function submit(form) {
  await new Promise((resolve) => setImmediate(resolve));
  form.dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => setImmediate(resolve));
}
let galleryWindow;
test("public DOM renders catalogue, euros/FCFA, featured work, Italy and validated contacts", async () => {
  galleryWindow = dom(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
  );
  const data = seed();
  data.artworks[0].priceXOF = 100000;
  data.settings.email = "artist@example.test";
  data.settings.whatsapp = "+391234567890";
  data.settings.featuredId = "2";
  globalThis.fetch = async () =>
    new Response(JSON.stringify(publicCatalog(data)));
  const result = await loadCatalog();
  assert.equal(result.artworks.length, 3);
  assert.equal(result.featuredId, "2");
  assert.equal(document.querySelectorAll(".gallery-card").length, 3);
  assert.equal(
    document.querySelector(".artwork-name").textContent,
    "Reine d’Or et d’Indigo",
  );
  assert.equal(
    document.querySelector("#detail-artwork-img").getAttribute("src"),
    "/assets/peinture2.jpg",
  );
  assert.ok(
    document.querySelector(".gallery-price").textContent.includes("100"),
  );
  assert.ok(
    document.querySelector(".artist-lead").textContent.includes("Italie"),
  );
  assert.ok(
    document.querySelector(".btn-whatsapp").href.includes("391234567890"),
  );
  assert.ok(
    document.querySelector('.btn-open-purchase[data-painting-id="3"]').disabled,
  );
  assert.equal(document.querySelectorAll(".room-thumb-btn").length, 3);
  assert.ok(
    !document
      .querySelector(".purchase-success p")
      .textContent.includes("adressés"),
  );
});
test("empty or failed catalogue never offers a stale artwork for purchase", async () => {
  galleryWindow.close();
  galleryWindow = dom(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
  );
  const data = seed();
  data.artworks.forEach((a) => (a.visibility = "draft"));
  globalThis.fetch = async () =>
    new Response(JSON.stringify(publicCatalog(data)));
  const result = await loadCatalog();
  assert.equal(result.artworks.length, 0);
  assert.equal(document.querySelector("#piece-maitresse").hidden, true);
  assert.equal(document.querySelector("#btn-hero-order").hidden, true);
  unavailableCatalog();
  assert.ok(
    document
      .querySelector(".collection-grid")
      .textContent.includes("indisponible"),
  );
  assert.ok(
    [...document.querySelectorAll(".btn-open-purchase")].every((b) => b.hidden),
  );
  galleryWindow.close();
});
test("admin DOM navigates every section and saves artwork, settings, request and sale forms", async () => {
  const adminWindow = dom(
    await readFile(new URL("../admin.html", import.meta.url), "utf8"),
  );
  let data = seed();
  let version = 1;
  const calls = [];
  const i = {
    id: "test-inquiry",
    artworkId: "1",
    artworkTitle: data.artworks[0].title,
    name: "Client Test",
    email: "client@example.test",
    phone: "+39123456789",
    city: "Rome",
    message: "Bonjour",
    currency: "EUR",
    status: "new",
    notes: "",
    createdAt: new Date().toISOString(),
  };
  data.inquiries.push(i);
  globalThis.fetch = async (url, options = {}) => {
    calls.push(url);
    if (url === "/api/auth/session")
      return Response.json({ username: "admin", mustChangePassword: false });
    if (url === "/api/admin/state")
      return Response.json({
        data: structuredClone(data),
        revision: String(version),
        local: true,
        imagePrefix: "mdart/local/images/",
      });
    if (url.startsWith("/api/admin/analytics"))
      return Response.json({
        available: false,
        message: "Vercel Analytics n’est pas encore configuré.",
      });
    const payload = JSON.parse(options.body);
    assert.equal(payload.revision, String(version));
    if (url === "/api/admin/artworks")
      data.artworks.push({
        ...artwork(payload.value, data),
        id: "new-art",
        createdAt: new Date().toISOString(),
      });
    else if (url === "/api/admin/settings") data.settings = payload.value;
    else if (url === "/api/admin/inquiries/test-inquiry")
      Object.assign(i, payload.value);
    else if (url === "/api/admin/sales")
      data.sales.push({
        ...payload.value,
        id: "test-sale",
        createdAt: new Date().toISOString(),
        snapshot: { title: data.artworks[0].title },
      });
    else if (url === "/api/admin/collections")
      data.collections.push({ ...payload.value, id: "test-collection" });
    else throw new Error(`Unexpected request ${url}`);
    version++;
    return Response.json({ revision: String(version), ok: true });
  };
  await import("../src/admin/main.js");
  await eventually(() => document.querySelector(".layout"));
  assert.ok(document.querySelector("h1").textContent.includes("atelier"));
  for (const section of [
    "artworks",
    "media",
    "collections",
    "inquiries",
    "sales",
    "analytics",
    "settings",
    "backup",
    "dashboard",
  ]) {
    await click(`[data-action="navigate"][data-id="${section}"]`);
    await eventually(
      () => document.querySelector(".nav .active")?.dataset.id === section,
    );
    assert.ok(document.querySelector("h1"));
    if (section === "analytics")
      await eventually(
        () =>
          document
            .querySelector(".notice-inline")
            ?.textContent.includes("Mode local") &&
          document
            .querySelector(".main")
            .textContent.includes("Analytics n’est pas"),
      );
  }
  await click('[data-action="new-art"]');
  await eventually(() => document.querySelector("#art-form"));
  let form = document.querySelector("#art-form");
  fill(form, "title", "Toile italienne");
  fill(form, "priceEUR", "125.50");
  fill(form, "priceXOF", "80000");
  fill(form, "primaryImage", "seed-1");
  fill(form, "visibility", "published");
  await submit(form);
  await eventually(
    () => data.artworks.length === 4 && !document.querySelector("#editor").open,
  );
  assert.equal(data.artworks[3].priceEUR, 125.5);
  assert.equal(data.artworks[3].priceXOF, 80000);
  await click('[data-action="navigate"][data-id="settings"]');
  await eventually(() => document.querySelector("#settings-form"));
  form = document.querySelector("#settings-form");
  fill(form, "location", "Rome, Italie");
  await submit(form);
  await eventually(
    () =>
      data.settings.location === "Rome, Italie" &&
      !document.querySelector('[type="submit"]').disabled,
  );
  await click('[data-action="navigate"][data-id="inquiries"]');
  await eventually(() =>
    document.querySelector('[data-action="edit-inquiry"]'),
  );
  await click('[data-action="edit-inquiry"]');
  form = document.querySelector("#inquiry-form");
  fill(form, "status", "accepted");
  fill(form, "notes", "Client contacté");
  await submit(form);
  await eventually(
    () => i.status === "accepted" && !document.querySelector("#editor").open,
  );
  await click('[data-action="edit-inquiry"]');
  await click('[data-action="new-sale"]');
  form = document.querySelector("#sale-form");
  fill(form, "amount", "2300");
  fill(form, "payment", "paid");
  fill(form, "delivery", "shipped");
  await submit(form);
  await eventually(
    () => data.sales.length === 1 && !document.querySelector("#editor").open,
  );
  assert.equal(data.sales[0].amount, 2300);
  assert.equal(data.sales[0].payment, "paid");
  await click('[data-action="navigate"][data-id="collections"]');
  await eventually(() =>
    document.querySelector('[data-action="new-collection"]'),
  );
  await click('[data-action="new-collection"]');
  form = document.querySelector("#collection-form");
  fill(form, "name", "Regards d’Italie");
  await submit(form);
  await eventually(
    () =>
      data.collections.length === 4 && !document.querySelector("#editor").open,
  );
  assert.ok(calls.includes("/api/admin/artworks"));
  assert.ok(calls.includes("/api/admin/sales"));
  adminWindow.close();
});
