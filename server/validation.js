import { HttpError, isLocal } from "./store.js";
export function text(value, label, max = 300, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new HttpError(400, `${label} invalide.`);
  return value.trim();
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Objet de données invalide.");
}
function choice(value, list, label) {
  if (!list.includes(value)) throw new HttpError(400, `${label} invalide.`);
  return value;
}
function price(value) {
  if (value === null || value === "" || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e12
  )
    throw new HttpError(400, "Prix invalide.");
  return value;
}
export function artwork(input, state) {
  object(input);
  const collectionId = text(input.collectionId || "", "Collection");
  if (collectionId && !state.collections.some((c) => c.id === collectionId))
    throw new HttpError(400, "Collection inconnue.");
  if (
    !Array.isArray(input.imageIds) ||
    input.imageIds.length > 12 ||
    !input.imageIds.length ||
    new Set(input.imageIds).size !== input.imageIds.length ||
    input.imageIds.some((id) => !state.media.some((m) => m.id === id))
  )
    throw new HttpError(
      400,
      "Choisissez de 1 à 12 images enregistrées, sans doublon.",
    );
  const year = text(String(input.year || ""), "Année", 4);
  if (year && !/^\d{4}$/.test(year))
    throw new HttpError(400, "Année invalide.");
  const order = Number(input.order);
  if (!Number.isSafeInteger(order) || order < 0 || order > 100000)
    throw new HttpError(400, "Ordre invalide.");
  if (
    input.priceXOF !== null &&
    input.priceXOF !== "" &&
    input.priceXOF !== undefined &&
    !Number.isInteger(input.priceXOF)
  )
    throw new HttpError(400, "Le prix FCFA doit être entier.");
  return {
    title: text(input.title, "Titre", 200, true),
    description: text(input.description || "", "Description", 5000),
    medium: text(input.medium || "", "Technique", 500),
    dimensions: text(input.dimensions || "", "Dimensions", 100),
    year,
    collectionId,
    imageIds: input.imageIds,
    priceEUR: price(input.priceEUR),
    priceXOF: price(input.priceXOF),
    status: choice(
      input.status,
      ["available", "reserved", "sold"],
      "Disponibilité",
    ),
    visibility: choice(
      input.visibility,
      ["draft", "published", "archived"],
      "Publication",
    ),
    order,
  };
}
export function settings(input, state) {
  object(input);
  const out = {};
  for (const key of [
    "artistName",
    "location",
    "email",
    "whatsapp",
    "instagram",
    "facebook",
    "biography",
    "tagline",
    "deliveryText",
    "purchaseText",
    "featuredId",
  ])
    out[key] = text(
      input[key] || "",
      key,
      key === "biography" ? 10000 : 2000,
      key === "artistName" || key === "location",
    );
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
    throw new HttpError(400, "Email invalide.");
  if (out.whatsapp && !/^\+?[0-9]{7,15}$/.test(out.whatsapp))
    throw new HttpError(
      400,
      "WhatsApp : utilisez le numéro international sans espaces.",
    );
  for (const key of ["instagram", "facebook"]) {
    if (out[key]) {
      let url;
      try {
        url = new URL(out[key]);
      } catch {
        throw new HttpError(400, "Lien social invalide.");
      }
      if (url.protocol !== "https:")
        throw new HttpError(400, "Lien social HTTPS requis.");
    }
  }
  if (
    out.featuredId &&
    !state.artworks.some(
      (a) => a.id === out.featuredId && a.visibility === "published",
    )
  )
    throw new HttpError(400, "L’œuvre mise en avant doit être publiée.");
  return out;
}
export function inquiry(input) {
  object(input);
  const email = text(input.email, "Email", 254, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Email invalide.");
  const phone = text(input.phone, "Téléphone", 40, true);
  if (!/^\+?[0-9 ()-]{6,40}$/.test(phone))
    throw new HttpError(400, "Téléphone invalide.");
  return {
    artworkId: text(input.artworkId, "Œuvre", 100, true),
    name: text(input.name, "Nom", 200, true),
    email,
    phone,
    city: text(input.city, "Ville et pays", 300, true),
    message: text(input.message || "", "Message", 5000),
    currency: choice(input.currency || "EUR", ["EUR", "XOF"], "Devise"),
  };
}
export function inquiryUpdate(input) {
  object(input);
  return {
    status: choice(
      input.status,
      ["new", "discussion", "accepted", "closed"],
      "État de la demande",
    ),
    notes: text(input.notes || "", "Notes", 10000),
  };
}
export function saleUpdate(input) {
  object(input);
  const amount = price(input.amount);
  if (input.currency === "XOF" && amount !== null && !Number.isInteger(amount))
    throw new HttpError(400, "Le montant FCFA doit être entier.");
  if (amount === null) throw new HttpError(400, "Montant convenu requis.");
  return {
    amount,
    currency: choice(input.currency, ["EUR", "XOF"], "Devise"),
    payment: choice(input.payment, ["pending", "partial", "paid"], "Paiement"),
    delivery: choice(
      input.delivery,
      ["preparing", "shipped", "delivered", "cancelled"],
      "Livraison",
    ),
    tracking: text(input.tracking || "", "Suivi", 500),
    notes: text(input.notes || "", "Notes", 10000),
  };
}
export function restore(input) {
  object(input);
  if (!input || input.schemaVersion !== 1)
    throw new HttpError(400, "Format de sauvegarde incompatible.");
  for (const key of [
    "artworks",
    "collections",
    "media",
    "inquiries",
    "sales",
    "audit",
  ]) {
    if (!Array.isArray(input[key]) || input[key].length > 10000)
      throw new HttpError(400, `Liste ${key} invalide.`);
    if (key !== "audit") {
      const ids = input[key].map((v) => text(v.id, "Identifiant", 100, true));
      if (new Set(ids).size !== ids.length)
        throw new HttpError(400, "Identifiants dupliqués.");
    }
  }
  input.collections = input.collections.map((c) => ({
    id: c.id,
    name: text(c.name, "Collection", 200, true),
  }));
  input.media = input.media.map((m) => {
    const url = text(m.url, "Image", 2000, true);
    const validSeed = [
      "/assets/peinture.jpeg",
      "/assets/peinture2.jpg",
      "/assets/peinture3.jpg",
    ].includes(url);
    let validBlob = false;
    try {
      const u = new URL(url);
      validBlob =
        u.protocol === "https:" &&
        u.hostname.endsWith(".public.blob.vercel-storage.com") &&
        !u.username &&
        !u.password;
    } catch {
      /* local asset */
    }
    const validLocal =
      isLocal() && /^\/api\/local-media\/[a-f0-9-]+\.(jpg|png|webp)$/.test(url);
    if (!validSeed && !validBlob && !validLocal)
      throw new HttpError(
        400,
        "Une sauvegarde ne peut référencer que des images Blob publiques ou les images initiales.",
      );
    return {
      id: m.id,
      url,
      alt: text(m.alt || "", "Texte alternatif", 300),
      name: text(m.name || "", "Nom image", 300),
      seed: validSeed,
    };
  });
  input.artworks = input.artworks.map((a) => ({
    ...artwork(a, input),
    id: a.id,
    createdAt: text(a.createdAt || "", "Date", 100),
  }));
  input.settings = settings(input.settings, input);
  input.inquiries = input.inquiries.map((i) => ({
    ...inquiry(i),
    ...inquiryUpdate(i),
    id: i.id,
    createdAt: text(i.createdAt || "", "Date", 100),
    artworkTitle: text(i.artworkTitle || "", "Titre", 200),
    submissionId: text(i.submissionId || "", "Soumission", 100),
  }));
  input.sales = input.sales.map((s) => {
    if (!input.inquiries.some((i) => i.id === s.inquiryId) || !s.snapshot)
      throw new HttpError(400, "Vente sans demande ou instantané.");
    return {
      ...saleUpdate(s),
      id: s.id,
      inquiryId: s.inquiryId,
      createdAt: text(s.createdAt || "", "Date", 100),
      snapshot: {
        artworkId: text(s.snapshot.artworkId, "Œuvre", 100, true),
        title: text(s.snapshot.title, "Titre", 200, true),
        dimensions: text(s.snapshot.dimensions || "", "Dimensions", 100),
        medium: text(s.snapshot.medium || "", "Technique", 500),
        priceEUR: price(s.snapshot.priceEUR),
        priceXOF: price(s.snapshot.priceXOF),
      },
    };
  });
  input.audit = [];
  return Object.fromEntries(
    [
      "schemaVersion",
      "artworks",
      "collections",
      "media",
      "inquiries",
      "sales",
      "settings",
      "audit",
    ].map((key) => [key, input[key]]),
  );
}
