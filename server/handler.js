import { randomUUID } from "node:crypto";
import { handleUpload } from "@vercel/blob/client";
import { head, del } from "@vercel/blob";
import {
  write,
  ensure,
  mutate,
  HttpError,
  isLocal,
  namespace,
} from "./store.js";
import { seed } from "./seed.js";
import {
  authSeed,
  passwordMatches,
  passwordHash,
  validatePassword,
  requireAdmin,
  checkOrigin,
  setCookie,
  issueSession,
  rateLimit,
} from "./auth.js";
import * as validate from "./validation.js";
import { analytics } from "./analytics.js";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const business = () => ensure("gallery", seed);
const now = () => new Date().toISOString();
const published = (a) => a.visibility === "published";
export function publicCatalog(state) {
  const artworks = state.artworks
    .filter(published)
    .sort((a, b) => a.order - b.order);
  const used = new Set(artworks.flatMap((a) => a.imageIds));
  return {
    artworks,
    collections: state.collections,
    media: state.media.filter((m) => used.has(m.id)),
    settings: state.settings,
    customEventsEnabled: process.env.ANALYTICS_CUSTOM_EVENTS === "1",
  };
}
function audit(state, action) {
  state.audit.unshift({ id: randomUUID(), action, createdAt: now() });
  state.audit = state.audit.slice(0, 200);
}
async function body(req, maximum = 2 * 1024 * 1024) {
  if (req.body !== undefined) {
    const raw =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > maximum)
      throw new HttpError(413, "Requête trop volumineuse.");
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new HttpError(400, "Objet JSON requis.");
      return parsed;
    } catch {
      throw new HttpError(400, "JSON invalide.");
    }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new HttpError(413, "Requête trop volumineuse.");
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new HttpError(400, "Objet JSON requis.");
    return parsed;
  } catch {
    throw new HttpError(400, "JSON invalide.");
  }
}
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function method(req, allowed) {
  if (!allowed.includes(req.method))
    throw new HttpError(405, "Méthode non autorisée.");
}
function find(list, id) {
  const item = list.find((v) => v.id === id);
  if (!item) throw new HttpError(404, "Élément introuvable.");
  return item;
}
function signature(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    ? "image/jpeg"
    : Buffer.from(bytes.subarray(0, 8)).equals(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        )
      ? "image/png"
      : Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
          Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP"
        ? "image/webp"
        : null;
}
async function checkImage(url) {
  const meta = await head(url, {
    token: process.env.BLOB_PUBLIC_READ_WRITE_TOKEN,
  });
  if (
    !meta.pathname.startsWith(`mdart/${namespace()}/images/`) ||
    meta.size > 10 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(meta.contentType)
  )
    throw new HttpError(400, "Image non autorisée.");
  const response = await fetch(meta.url, {
    headers: { Range: "bytes=0-11" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new HttpError(400, "Impossible de vérifier l’image.");
  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0);
  try {
    while (bytes.length < 12) {
      const part = await reader.read();
      if (part.done) break;
      bytes = Buffer.concat([bytes, Buffer.from(part.value)]);
    }
  } finally {
    await reader.cancel();
  }
  if (signature(bytes) !== meta.contentType)
    throw new HttpError(
      400,
      "Le contenu du fichier ne correspond pas à une image autorisée.",
    );
  return meta;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const url = new URL(req.url, "http://localhost");
    const route = (
      url.pathname === "/api/index" && url.searchParams.has("_route")
        ? `/api/${url.searchParams.get("_route")}`
        : url.pathname
    ).replace(/\/$/, "");
    // Blob callbacks authenticate with the SDK's signature, rather than a browser cookie.
    if (route === "/api/admin/upload" && req.method === "POST") {
      const input = await body(req);
      if (input.type !== "blob.upload-completed") {
        checkOrigin(req);
        await requireAdmin(req);
      }
      if (!process.env.BLOB_PUBLIC_READ_WRITE_TOKEN)
        throw new HttpError(503, "Stockage des images non configuré.");
      const result = await handleUpload({
        body: input,
        request: req,
        token: process.env.BLOB_PUBLIC_READ_WRITE_TOKEN,
        onBeforeGenerateToken: async (pathname) => {
          if (
            !pathname.startsWith(`mdart/${namespace()}/images/`) ||
            !/\.(jpe?g|png|webp)$/i.test(pathname)
          )
            throw new HttpError(400, "Nom de fichier refusé.");
          return {
            allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
            maximumSizeInBytes: 10 * 1024 * 1024,
            addRandomSuffix: true,
            callbackUrl: `${process.env.APP_ORIGIN || `https://${req.headers["x-forwarded-host"] || req.headers.host}`}/api/admin/upload`,
          };
        },
        onUploadCompleted: async () => {},
      });
      return send(res, 200, result);
    }
    if (route.startsWith("/api/local-media/") && isLocal()) {
      method(req, ["GET"]);
      const filename = route.split("/").pop();
      if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename))
        throw new HttpError(404, "Image introuvable.");
      const data = await readFile(
        path.join(
          process.env.MDART_DATA_DIR || ".local-data",
          "images",
          filename,
        ),
      );
      res.setHeader(
        "Content-Type",
        filename.endsWith(".jpg")
          ? "image/jpeg"
          : filename.endsWith(".png")
            ? "image/png"
            : "image/webp",
      );
      res.end(data);
      return;
    }
    if (req.method !== "GET") checkOrigin(req);
    if (route === "/api/catalog") {
      method(req, ["GET"]);
      return send(res, 200, publicCatalog((await business()).data));
    }
    if (route === "/api/auth/login") {
      method(req, ["POST"]);
      await rateLimit(req, "login", 8, 15 * 60000);
      const input = await body(req);
      const username = validate.text(input.username, "Identifiant", 100, true);
      const password = input.password;
      if (
        typeof password !== "string" ||
        !password.length ||
        password.length > 128
      )
        throw new HttpError(400, "Mot de passe invalide.");
      let sid;
      let mustChangePassword;
      await mutate("auth", authSeed, async (data) => {
        if (
          username !== data.username ||
          !passwordMatches(password, data.passwordHash)
        )
          throw new HttpError(401, "Identifiants incorrects.");
        sid = await issueSession(res, data);
        mustChangePassword = data.mustChangePassword;
      });
      setCookie(res, sid);
      return send(res, 200, { mustChangePassword });
    }
    if (route === "/api/auth/session") {
      method(req, ["GET"]);
      const { data } = await requireAdmin(req, true);
      return send(res, 200, {
        username: data.username,
        mustChangePassword: data.mustChangePassword,
      });
    }
    if (route === "/api/auth/logout") {
      method(req, ["POST"]);
      const auth = await requireAdmin(req, true);
      await mutate("auth", authSeed, (data) => {
        data.sessions = data.sessions.filter((s) => s.hash !== auth.sidHash);
      });
      setCookie(res);
      return send(res, 200, { ok: true });
    }
    if (route === "/api/auth/password") {
      method(req, ["POST"]);
      await requireAdmin(req, true);
      await rateLimit(req, "password", 8, 15 * 60000);
      const input = await body(req);
      validatePassword(input.newPassword);
      const old = input.currentPassword;
      if (typeof old !== "string" || !old.length || old.length > 128)
        throw new HttpError(400, "Mot de passe actuel invalide.");
      let sid;
      await mutate("auth", authSeed, async (data) => {
        if (!passwordMatches(old, data.passwordHash))
          throw new HttpError(400, "Mot de passe actuel incorrect.");
        if (input.newPassword === old)
          throw new HttpError(400, "Choisissez un nouveau mot de passe.");
        data.passwordHash = passwordHash(input.newPassword);
        data.mustChangePassword = false;
        data.sessions = [];
        sid = await issueSession(res, data);
      });
      setCookie(res, sid);
      return send(res, 200, { ok: true });
    }
    if (route === "/api/inquiries") {
      method(req, ["POST"]);
      const input = await body(req);
      if (input.website) throw new HttpError(400, "Soumission refusée.");
      const value = validate.inquiry(input);
      const submissionId = validate.text(
        input.submissionId,
        "Soumission",
        100,
        true,
      );
      if (!/^[a-f0-9-]{36}$/.test(submissionId))
        throw new HttpError(400, "Identifiant de soumission invalide.");
      await rateLimit(req, "inquiry", 5, 60 * 60000);
      const result = await mutate("gallery", seed, (state) => {
        const existing = state.inquiries.find(
          (i) => i.submissionId === submissionId,
        );
        if (existing) return { id: existing.id };
        const art = find(state.artworks.filter(published), value.artworkId);
        if (art.status !== "available")
          throw new HttpError(409, "Cette œuvre n’est plus disponible.");
        const record = {
          ...value,
          id: randomUUID(),
          submissionId,
          artworkTitle: art.title,
          status: "new",
          notes: "",
          createdAt: now(),
        };
        state.inquiries.unshift(record);
        return { id: record.id };
      });
      return send(res, 201, result);
    }
    if (!route.startsWith("/api/admin/"))
      throw new HttpError(404, "Route introuvable.");
    await requireAdmin(req);
    if (route === "/api/admin/state") {
      method(req, ["GET"]);
      const current = await business();
      return send(res, 200, {
        ...current,
        local: isLocal(),
        imagePrefix: `mdart/${namespace()}/images/`,
      });
    }
    if (route === "/api/admin/analytics") {
      method(req, ["GET"]);
      return send(
        res,
        200,
        await analytics(Number(url.searchParams.get("days") || 7)),
      );
    }
    method(req, ["POST", "PUT", "DELETE"]);
    const input = await body(
      req,
      isLocal() && route === "/api/admin/media"
        ? 16 * 1024 * 1024
        : 2 * 1024 * 1024,
    );
    const current = await business();
    if (input.revision !== current.revision)
      throw new HttpError(
        409,
        "Les données ont changé. Rechargez avant de modifier.",
      );
    let state = current.data;
    const parts = route.split("/");
    const resource = parts[3];
    const id = parts[4];
    let result = { ok: true };
    let deleteAfter = null;
    if (resource === "artworks") {
      if (req.method === "DELETE") {
        find(state.artworks, id);
        state.artworks = state.artworks.filter((a) => a.id !== id);
        if (state.settings.featuredId === id) state.settings.featuredId = "";
        audit(state, "Suppression d’une œuvre");
      } else {
        const value = validate.artwork(input.value, state);
        if (id) Object.assign(find(state.artworks, id), value);
        else
          state.artworks.push({ ...value, id: randomUUID(), createdAt: now() });
        if (
          state.settings.featuredId === id &&
          value.visibility !== "published"
        )
          state.settings.featuredId = "";
        audit(state, id ? "Modification d’une œuvre" : "Ajout d’une œuvre");
      }
    } else if (resource === "collections") {
      if (req.method === "DELETE") {
        find(state.collections, id);
        if (state.artworks.some((a) => a.collectionId === id))
          throw new HttpError(
            409,
            "Cette collection contient des œuvres. Réaffectez-les d’abord.",
          );
        state.collections = state.collections.filter((c) => c.id !== id);
      } else {
        const name = validate.text(input.value?.name, "Collection", 200, true);
        if (id) find(state.collections, id).name = name;
        else state.collections.push({ id: randomUUID(), name });
      }
      audit(state, "Modification des collections");
    } else if (resource === "settings") {
      state.settings = validate.settings(input.value, state);
      audit(state, "Modification des paramètres");
    } else if (resource === "inquiries") {
      Object.assign(
        find(state.inquiries, id),
        validate.inquiryUpdate(input.value),
      );
      audit(state, "Suivi d’une demande");
    } else if (resource === "sales") {
      const value = validate.saleUpdate(input.value);
      if (id) Object.assign(find(state.sales, id), value);
      else {
        const request = find(state.inquiries, input.value.inquiryId);
        if (request.status !== "accepted")
          throw new HttpError(
            400,
            "Acceptez la demande avant de créer une vente.",
          );
        if (state.sales.some((s) => s.inquiryId === request.id))
          throw new HttpError(409, "Une vente existe déjà pour cette demande.");
        const art = find(state.artworks, request.artworkId);
        state.sales.unshift({
          ...value,
          id: randomUUID(),
          inquiryId: request.id,
          createdAt: now(),
          snapshot: {
            artworkId: art.id,
            title: art.title,
            dimensions: art.dimensions,
            medium: art.medium,
            priceEUR: art.priceEUR,
            priceXOF: art.priceXOF,
          },
        });
      }
      audit(state, "Suivi d’une vente");
    } else if (resource === "media") {
      if (req.method === "DELETE") {
        const media = find(state.media, id);
        if (state.artworks.some((a) => a.imageIds.includes(id)))
          throw new HttpError(409, "Cette image est utilisée par une œuvre.");
        state.media = state.media.filter((m) => m.id !== id);
        deleteAfter = media;
      } else if (id) {
        find(state.media, id).alt = validate.text(
          input.value?.alt,
          "Texte alternatif",
          300,
        );
      } else {
        let imageUrl;
        if (isLocal()) {
          const encoded = validate.text(
            input.value?.base64,
            "Image",
            15 * 1024 * 1024,
            true,
          );
          const bytes = Buffer.from(encoded, "base64");
          const mime = signature(bytes);
          if (!mime || bytes.length > 10 * 1024 * 1024)
            throw new HttpError(400, "Image invalide ou trop volumineuse.");
          const filename = `${randomUUID()}.${mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp"}`;
          const directory = path.join(
            process.env.MDART_DATA_DIR || ".local-data",
            "images",
          );
          await mkdir(directory, { recursive: true });
          await writeFile(path.join(directory, filename), bytes);
          imageUrl = `/api/local-media/${filename}`;
        } else {
          if (!process.env.BLOB_PUBLIC_READ_WRITE_TOKEN)
            throw new HttpError(503, "Stockage images non configuré.");
          const candidate = validate.text(
            input.value?.url,
            "Image",
            2000,
            true,
          );
          let u;
          try {
            u = new URL(candidate);
          } catch {
            throw new HttpError(400, "URL invalide.");
          }
          if (
            u.protocol !== "https:" ||
            !u.hostname.endsWith(".public.blob.vercel-storage.com") ||
            u.username ||
            u.password
          )
            throw new HttpError(400, "URL image refusée.");
          imageUrl = (await checkImage(candidate)).url;
        }
        const media = {
          id: randomUUID(),
          url: imageUrl,
          alt: validate.text(input.value?.alt || "", "Texte alternatif", 300),
          name: validate.text(input.value?.name || "Image", "Nom", 300),
          seed: false,
        };
        state.media.push(media);
        result = { media };
      }
      audit(state, "Modification de la médiathèque");
    } else if (resource === "restore") {
      state = validate.restore(input.value);
      audit(state, "Restauration d’une sauvegarde");
    } else throw new HttpError(404, "Route introuvable.");
    const revision = await write("gallery", state, current.revision);
    // JSON commits first. A storage failure must not undo a successfully saved catalogue.
    let warning;
    if (deleteAfter && !deleteAfter.seed) {
      try {
        if (isLocal() && deleteAfter.url.startsWith("/api/local-media/"))
          await unlink(
            path.join(
              process.env.MDART_DATA_DIR || ".local-data",
              "images",
              deleteAfter.url.split("/").pop(),
            ),
          );
        else if (!isLocal()) {
          await checkImage(deleteAfter.url);
          await del(deleteAfter.url, {
            token: process.env.BLOB_PUBLIC_READ_WRITE_TOKEN,
          });
        }
      } catch {
        warning =
          "Image retirée du catalogue ; nettoyage du stockage non terminé.";
      }
    }
    return send(res, 200, { ...result, revision, warning });
  } catch (error) {
    const status = error.status || (error.code === "ENOENT" ? 404 : 500);
    if (status >= 500)
      console.error(
        "MDart API failure:",
        error.name,
        error.status || error.code || "internal",
      );
    send(res, status, {
      error: error.status
        ? error.message
        : status === 404
          ? "Élément introuvable."
          : "Le service est temporairement indisponible. Vérifiez la configuration serveur.",
    });
  }
}
