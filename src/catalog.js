import { inject, track } from "@vercel/analytics";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (amount, currency = "EUR") =>
  amount === null
    ? "Prix sur demande"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        maximumFractionDigits: currency === "XOF" ? 0 : 2,
      }).format(amount);
const labels = { available: "Disponible", reserved: "Réservé", sold: "Vendu" };
let eventsEnabled = false;
export function event(name, artworkId) {
  if (eventsEnabled)
    try {
      track(name, { artworkId });
    } catch {
      /* Analytics must never block the gallery. */
    }
}
export async function loadCatalog() {
  const response = await fetch("/api/catalog", {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("Le catalogue est momentanément indisponible.");
  const data = await response.json();
  eventsEnabled = data.customEventsEnabled;
  if (import.meta.env?.PROD) inject();
  const { settings: s } = data;
  const artworks = data.artworks.map((a) => {
    const media = a.imageIds
      .map((id) => data.media.find((m) => m.id === id))
      .filter(Boolean);
    return {
      ...a,
      img: media[0]?.url,
      alt: media[0]?.alt || a.title,
      images: media,
      price:
        money(a.priceEUR) +
        (a.priceXOF !== null ? ` · ${money(a.priceXOF, "XOF")}` : ""),
      collection:
        data.collections.find((c) => c.id === a.collectionId)?.name || "",
    };
  });
  const featured = artworks.find((a) => a.id === s.featuredId) || artworks[0];
  document.querySelector(".collection-grid").innerHTML =
    artworks
      .map(
        (a) =>
          `<article class="gallery-card"><div class="gallery-img-wrapper"><img loading="lazy" src="${esc(a.img)}" alt="${esc(a.alt)}"><div class="gallery-status ${a.status === "available" ? "available" : "reserved"}">${labels[a.status]}</div><div class="gallery-overlay"><button class="gallery-quick-view btn-open-room" data-painting-id="${esc(a.id)}" data-painting="${esc(a.img)}"><i data-lucide="eye"></i><span>Voir en salon</span></button></div></div><div class="gallery-info"><div class="gallery-meta"><span class="gallery-cat">${esc(a.collection)}</span><span class="gallery-size">${esc(a.dimensions)}</span></div><h3 class="gallery-title">${esc(a.title)}</h3><p class="gallery-sub">${esc(a.description)}</p><div class="gallery-bottom"><div class="gallery-price">${esc(a.price)}</div><div class="gallery-card-actions"><button class="btn-dark-sm btn-open-loupe" data-painting-id="${esc(a.id)}">Détails</button><button class="btn-gold-sm btn-open-purchase" data-painting-id="${esc(a.id)}" ${a.status !== "available" ? "disabled" : ""}>${a.status === "available" ? "Acquérir" : labels[a.status]}</button></div></div></div></article>`,
      )
      .join("") ||
    '<p class="section-desc">La prochaine collection sera présentée ici.</p>';
  document
    .querySelectorAll(".artist-title,.artist-badge h4")
    .forEach((el) => (el.textContent = s.artistName));
  document.querySelector(".brand-name").textContent =
    s.artistName.toUpperCase();
  document.querySelector(".artist-lead").textContent =
    `Artiste peintre contemporain basé en ${s.location}.`;
  document.querySelector(".artist-bio-text").textContent = s.biography;
  document.querySelector(".footer-tagline").textContent = s.tagline;
  document.querySelector(".footer-bottom p").textContent =
    `© ${new Date().getFullYear()} ${s.artistName}. Tous droits réservés.`;
  document.querySelector(".footer-meta").textContent =
    `${s.location} · Collection internationale`;
  const contact = document.querySelector(".footer-contact");
  contact.querySelector(".footer-email")?.remove();
  if (s.email) {
    const a = document.createElement("a");
    a.className = "footer-email";
    a.href = `mailto:${s.email}`;
    a.textContent = s.email;
    contact.append(a);
  }
  for (const key of ["instagram", "facebook"])
    if (s[key]) {
      const a = document.createElement("a");
      a.href = s[key];
      a.textContent = key === "instagram" ? "Instagram" : "Facebook";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      contact.append(document.createElement("br"), a);
    }
  document.querySelector(".purchase-notes").textContent =
    `${s.deliveryText} ${s.purchaseText}`;
  document.querySelector(".guarantee-list").innerHTML =
    `<div class="guarantee-item"><i data-lucide="package-check"></i><span>${esc(s.deliveryText)}</span></div><div class="guarantee-item"><i data-lucide="message-circle"></i><span>${esc(s.purchaseText)}</span></div>`;
  document.querySelector(".purchase-success p").textContent =
    "Votre demande a été enregistrée. L’artiste prendra contact avec vous pour convenir de l’acquisition et du règlement.";
  const whatsapp = document.querySelector(".btn-whatsapp");
  whatsapp.hidden = !s.whatsapp || !featured;
  if (s.whatsapp && featured) {
    whatsapp.href = `https://wa.me/${s.whatsapp.replace("+", "")}?text=${encodeURIComponent(`Bonjour ${s.artistName}, je souhaite des renseignements sur l’œuvre ${featured.title}.`)}`;
    whatsapp.addEventListener("click", () =>
      event("whatsapp_click", featured.id),
    );
  }
  if (featured) {
    document.querySelector("#detail-artwork-img").src = featured.img;
    document.querySelector("#detail-artwork-img").alt = featured.alt;
    document.querySelector(".artwork-name").textContent = featured.title;
    document.querySelector(".artwork-quote").textContent = featured.description;
    document.querySelector(".specs-table").innerHTML = [
      ["Technique", featured.medium],
      ["Dimensions", featured.dimensions],
      ["Année", featured.year || "Non précisée"],
      ["Collection", featured.collection || "—"],
    ]
      .map(
        ([k, v]) =>
          `<div class="spec-row"><span class="spec-label">${k}</span><span class="spec-value">${esc(v)}</span></div>`,
      )
      .join("");
    document.querySelector(".price-tag").textContent = featured.price;
    const status = document.querySelector(".status-badge");
    status.textContent = labels[featured.status];
    status.className = `status-badge ${featured.status === "available" ? "available" : "reserved"}`;
    document.querySelector("#piece-maitresse .section-eyebrow").textContent =
      "ŒUVRE À LA UNE";
    document
      .querySelectorAll("#piece-maitresse .btn-open-purchase,#btn-hero-order")
      .forEach((b) => {
        b.dataset.paintingId = featured.id;
        b.disabled = featured.status !== "available";
      });
    document.querySelector("#piece-maitresse .btn-open-room").dataset.painting =
      featured.img;
    document.querySelector("#loupe-source-img").src = featured.img;
  } else {
    document.querySelector("#piece-maitresse").hidden = true;
    document.querySelector("#btn-hero-order").hidden = true;
  }
  // The scroll sequence is a fixed artwork film, independent of the editable spotlight.
  document.querySelectorAll("#experience .btn-open-purchase").forEach((b) => {
    b.dataset.paintingId = "1";
    b.disabled = !artworks.some(
      (a) => a.id === "1" && a.status === "available",
    );
  });
  document
    .querySelectorAll(
      '#experience .story-step[data-step="4"] .story-specs strong',
    )
    .item(3).textContent =
    labels[artworks.find((a) => a.id === "1")?.status] || "Hors catalogue";
  document.querySelector(".room-switches").innerHTML = artworks
    .map(
      (a) =>
        `<button class="room-thumb-btn" data-id="${esc(a.id)}" data-img="${esc(a.img)}">${esc(a.title)}</button>`,
    )
    .join("");
  return { artworks, featuredId: featured?.id };
}
export function unavailableCatalog() {
  document.querySelector(".collection-grid").innerHTML =
    '<p class="section-desc" role="alert">Le catalogue est momentanément indisponible. Veuillez réessayer plus tard.</p>';
  document.querySelector("#piece-maitresse").hidden = true;
  document
    .querySelectorAll(".btn-open-purchase,#btn-hero-order,.btn-whatsapp")
    .forEach((b) => {
      b.hidden = true;
    });
  document.querySelector(".room-switches").innerHTML = "";
}
