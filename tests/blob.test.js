import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { read, write } from "../server/store.js";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

const keys = ["MDART_LOCAL_DATA", "VERCEL", "VERCEL_ENV", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN", "BLOB_READ_WRITE_TOKEN"];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalDispatcher = getGlobalDispatcher();
let agent;
// Synthetic, unsigned credential: only the HTTP transport is mocked.
const oidc = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;

beforeEach(() => {
  for (const key of keys) delete process.env[key];
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.BLOB_STORE_ID = "store_teststore";
  process.env.VERCEL_OIDC_TOKEN = oidc;
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});
afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await agent.close();
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test("private Blob reads use Vercel OIDC without a static token and bypass cache", async () => {
  agent.get("https://teststore.private.blob.vercel-storage.com").intercept({
    path: "/mdart/production/gallery.json?cache=0", method: "GET",
    headers: { authorization: `Bearer ${oidc}` },
  }).reply(200, { artworks: [] }, { headers: { etag: "revision-1" } });
  assert.deepEqual(await read("gallery"), { data: { artworks: [] }, revision: "revision-1" });
});

test("Vercel OIDC takes priority over an obsolete static credential", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "obsolete-test-token";
  agent.get("https://teststore.private.blob.vercel-storage.com").intercept({
    path: "/mdart/production/auth.json?cache=0", method: "GET",
    headers: { authorization: `Bearer ${oidc}` },
  }).reply(404);
  assert.equal(await read("auth"), null);
});

test("OIDC writes keep conditional overwrite protection", async () => {
  agent.get("https://vercel.com").intercept({
    path: "/api/blob/?pathname=mdart%2Fproduction%2Fgallery.json", method: "PUT",
    headers: {
      authorization: `Bearer ${oidc}`, "x-vercel-blob-store-id": "teststore",
      "x-if-match": "revision-1", "x-allow-overwrite": "1",
      "x-vercel-blob-access": "private",
    },
    body: JSON.stringify({ artworks: [] }),
  }).reply(200, { etag: "revision-2" });
  assert.equal(await write("gallery", { artworks: [] }, "revision-1"), "revision-2");
});

test("missing Blob configuration produces an actionable service error", async () => {
  delete process.env.BLOB_STORE_ID;
  delete process.env.VERCEL_OIDC_TOKEN;
  for (const operation of [() => read("gallery"), () => write("gallery", {}, null)]) {
    await assert.rejects(operation, (error) => error.status === 503 && error.message.includes("BLOB_STORE_ID"));
  }
});
