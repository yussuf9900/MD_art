import {
  createIcons,
  LayoutDashboard,
  Image,
  Images,
  Folder,
  Inbox,
  ShoppingBag,
  BarChart3,
  Settings,
  Download,
} from "lucide";
import { upload } from "@vercel/blob/client";
const app = document.querySelector("#app");
const dialog = document.querySelector("#editor");
const nav = [
  ["dashboard", "Vue d’ensemble", "layout-dashboard"],
  ["artworks", "Tableaux", "image"],
  ["media", "Médiathèque", "images"],
  ["collections", "Collections", "folder"],
  ["inquiries", "Demandes", "inbox"],
  ["sales", "Ventes & livraison", "shopping-bag"],
  ["analytics", "Statistiques", "bar-chart-3"],
  ["settings", "Paramètres", "settings"],
  ["backup", "Sauvegardes", "download"],
];
const labels = {
  available: "Disponible",
  reserved: "Réservé",
  sold: "Vendu",
  draft: "Brouillon",
  published: "Publié",
  archived: "Archivé",
  new: "Nouvelle",
  discussion: "En discussion",
  accepted: "Acceptée",
  closed: "Clôturée",
  pending: "En attente",
  partial: "Partiel",
  paid: "Payé",
  preparing: "Préparation",
  shipped: "Expédiée",
  delivered: "Livrée",
  cancelled: "Annulée",
};
let state;
let revision;
let local;
let imagePrefix;
let view = "dashboard";
let busy = false;
let filter = { search: "", status: "", visibility: "" };
let analyticsData;
let days = 7;
let noticeTimer;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (value) => {
  const d = new Date(value);
  return isNaN(d)
    ? "—"
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Rome",
      }).format(d);
};
const money = (amount, currency = "EUR") =>
  amount === null || amount === undefined
    ? "Prix sur demande"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        maximumFractionDigits: currency === "XOF" ? 0 : 2,
      }).format(amount);
const badge = (value) =>
  `<span class="badge ${esc(value)}">${esc(labels[value] || value)}</span>`;
const empty = (message) => `<div class="empty">${esc(message)}</div>`;
const button = (action, text, id = "", cls = "") =>
  `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${text}</button>`;
const image = (art) => state.media.find((m) => m.id === art.imageIds[0]);
function notify(message, error = false) {
  const el = document.querySelector("#notice");
  el.textContent = message;
  el.className = `show${error ? " error" : ""}`;
  clearTimeout(noticeTimer);
  if (!error) noticeTimer = setTimeout(() => (el.className = ""), 5500);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Une erreur est survenue.");
    error.status = response.status;
    throw error;
  }
  return data;
}
async function reload() {
  const data = await api("/api/admin/state");
  state = data.data;
  revision = data.revision;
  local = data.local;
  imagePrefix = data.imagePrefix;
}
async function save(resource, value, id = "", method = "POST") {
  const result = await api(
    `/api/admin/${resource}${id ? `/${encodeURIComponent(id)}` : ""}`,
    { method, body: JSON.stringify({ revision, value }) },
  );
  await reload();
  if (result.warning) notify(result.warning, true);
  return result;
}
function icons() {
  createIcons({
    icons: {
      LayoutDashboard,
      Image,
      Images,
      Folder,
      Inbox,
      ShoppingBag,
      BarChart3,
      Settings,
      Download,
    },
  });
}
const heading = (title, desc, action = "") =>
  `<div class="page-heading"><div><h1>${title}</h1><p class="lead">${desc}</p></div>${action}</div>`;
function stat(label, count, foot) {
  return `<div class="stat"><small>${label}</small><strong>${count}</strong><span>${foot}</span></div>`;
}
function artworkCard(a) {
  const m = image(a);
  return `<article class="art-card"><img class="art-img" src="${esc(m?.url)}" alt="${esc(m?.alt || a.title)}"><div class="art-body"><div class="badges">${badge(a.status)}${badge(a.visibility)}</div><h3>${esc(a.title)}</h3><p>${esc(state.collections.find((c) => c.id === a.collectionId)?.name || "Sans collection")} · ${esc(a.dimensions)}</p><div class="art-footer"><div class="price">${esc(money(a.priceEUR))}${a.priceXOF !== null ? `<small class="muted"><br>${esc(money(a.priceXOF, "XOF"))}</small>` : ""}</div>${button("edit-art", "Modifier", a.id)}</div></div></article>`;
}
let audienceSummary;
function audienceCard() {
  if (!audienceSummary || audienceSummary.loading)
    return '<h2>Audience · 7 derniers jours</h2><p class="muted">Chargement des visites…</p>';
  if (!audienceSummary.available)
    return `<h2>Audience · 7 derniers jours</h2><p class="muted">${esc(audienceSummary.message)}</p>${button("navigate", "Consulter les statistiques", "analytics", "quiet")}`;
  const trend = audienceSummary.reports.day || [];
  const pages = trend.reduce(
    (sum, row) => sum + (Number(row.pageviews) || 0),
    0,
  );
  const maximum = Math.max(
    1,
    ...trend.map((row) => Number(row.pageviews) || 0),
  );
  return `<div class="panel-header"><h2>Audience · 7 derniers jours</h2>${button("navigate", "Détails", "analytics", "quiet")}</div><strong class="price">${pages} pages consultées</strong><div class="chart" aria-label="Pages consultées par jour">${trend.map((row) => `<div class="chart-bar" style="height:${Math.max(1, ((Number(row.pageviews) || 0) / maximum) * 100)}%" title="${esc(row.timestamp)} : ${esc(row.pageviews)} pages"></div>`).join("")}</div>`;
}
async function refreshAudience() {
  try {
    audienceSummary = await api("/api/admin/analytics?days=7");
  } catch (error) {
    audienceSummary = { available: false, message: error.message };
  }
  const container = document.querySelector("#audience-summary");
  if (container) container.innerHTML = audienceCard();
}

function dashboard() {
  return (
    heading(
      "Votre atelier, en un regard",
      "La galerie et ses demandes, réunies au même endroit.",
    ) +
    `<div class="stats">${stat("Œuvres disponibles", state.artworks.filter((a) => a.status === "available").length, "Catalogue de l’atelier")}${stat("Œuvres réservées", state.artworks.filter((a) => a.status === "reserved").length, "Suivi des acquisitions")}${stat("Œuvres vendues", state.artworks.filter((a) => a.status === "sold").length, `${state.sales.length} ventes enregistrées`)}${stat("Nouvelles demandes", state.inquiries.filter((i) => i.status === "new").length, "À examiner")}</div><section class="panel" id="audience-summary" style="margin-bottom:24px">${audienceCard()}</section><div class="columns"><section class="panel"><div class="panel-header"><h2>Dernières demandes</h2>${button("navigate", "Tout voir", "inquiries", "quiet")}</div>${
      state.inquiries
        .slice(0, 5)
        .map(
          (i) =>
            `<div class="row"><div class="row-title"><strong>${esc(i.name)}</strong><small>${esc(i.artworkTitle)}</small></div>${badge(i.status)}${button("edit-inquiry", "Ouvrir", i.id)}</div>`,
        )
        .join("") || empty("Les demandes des collectionneurs apparaîtront ici.")
    }</section><section class="panel"><div class="panel-header"><h2>Activité de l’atelier</h2></div>${
      state.audit
        .slice(0, 5)
        .map(
          (a) =>
            `<div class="row"><div class="row-title"><strong>${esc(a.action)}</strong><small>${date(a.createdAt)}</small></div></div>`,
        )
        .join("") || empty("Votre activité sera affichée ici.")
    }<p class="muted">Galerie basée en ${esc(state.settings.location)}. Horaires : Italie.</p>${button("navigate", "Consulter l’audience", "analytics", "quiet")}</section></div><section class="panel" style="margin-top:24px"><div class="panel-header"><h2>Vos tableaux</h2>${button("new-art", "Ajouter un tableau", "", "primary")}</div><div class="cards">${state.artworks.slice(0, 3).map(artworkCard).join("") || empty("Ajoutez votre première œuvre.")}</div></section>`
  );
}
function artworks() {
  return (
    heading(
      "Les tableaux",
      "Composez votre collection, à votre rythme.",
      button("new-art", "+ Ajouter", "", "primary"),
    ) +
    `<div class="toolbar"><input type="search" id="search" aria-label="Rechercher un tableau" placeholder="Rechercher un titre…" value="${esc(filter.search)}"><select id="filter-status" aria-label="Disponibilité"><option value="">Toutes les disponibilités</option>${options(["available", "reserved", "sold"], filter.status)}</select><select id="filter-visibility" aria-label="Publication"><option value="">Toutes les publications</option>${options(["draft", "published", "archived"], filter.visibility)}</select></div><div class="cards" id="art-list">${artList()}</div>`
  );
}
function artList() {
  return (
    state.artworks
      .filter(
        (a) =>
          (!filter.search ||
            a.title
              .toLocaleLowerCase()
              .includes(filter.search.toLocaleLowerCase())) &&
          (!filter.status || a.status === filter.status) &&
          (!filter.visibility || a.visibility === filter.visibility),
      )
      .sort((a, b) => a.order - b.order)
      .map(artworkCard)
      .join("") || empty("Aucun tableau ne correspond à cette recherche.")
  );
}
function mediaView() {
  return (
    heading(
      "Médiathèque",
      "Les images de vos œuvres, réunies dans l’atelier.",
    ) +
    `<div class="media-upload"><input id="upload-files" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Images à ajouter"><span class="muted">JPEG, PNG ou WebP · 10 Mo par image</span><progress id="upload-progress" max="100" value="0" hidden></progress></div><div class="cards">${state.media.map((m) => `<article class="art-card"><img class="art-img" src="${esc(m.url)}" alt="${esc(m.alt)}"><div class="art-body"><h3>${esc(m.name)}</h3><p>${esc(m.alt || "Texte alternatif à renseigner")}</p><div class="actions">${button("edit-media", "Texte alternatif", m.id)}${button("delete-media", "Supprimer", m.id, "danger")}</div></div></article>`).join("") || empty("Ajoutez les images de vos tableaux.")}</div>`
  );
}
function collections() {
  return (
    heading(
      "Collections",
      "Organisez les œuvres par séries.",
      button("new-collection", "+ Ajouter", "", "primary"),
    ) +
    `<div class="panel">${state.collections.map((c) => `<div class="row collection-row"><strong>${esc(c.name)}</strong><span class="muted">${state.artworks.filter((a) => a.collectionId === c.id).length} œuvres</span>${button("edit-collection", "Modifier", c.id)}${button("delete-collection", "Supprimer", c.id, "danger")}</div>`).join("") || empty("Aucune collection.")}</div>`
  );
}
function inquiries() {
  return (
    heading(
      "Demandes d’acquisition",
      "Chaque prise de contact ouvre une conversation.",
    ) +
    `<div class="panel table-wrap"><table><thead><tr><th>Collectionneur</th><th>Œuvre</th><th>État</th><th>Reçue le</th><th></th></tr></thead><tbody>${state.inquiries.map((i) => `<tr><td>${esc(i.name)}<small>${esc(i.email)}</small></td><td>${esc(i.artworkTitle)}</td><td>${badge(i.status)}</td><td>${date(i.createdAt)}</td><td>${button("edit-inquiry", "Consulter", i.id)}</td></tr>`).join("")}</tbody></table>${!state.inquiries.length ? empty("Aucune demande reçue pour le moment.") : ""}</div>`
  );
}
function sales() {
  return (
    heading(
      "Ventes & livraison",
      "Suivi manuel des règlements effectués hors du site.",
    ) +
    `<div class="notice-inline">Créez une vente depuis une demande acceptée. Le paiement et la disponibilité de l’œuvre sont mis à jour manuellement.</div><div class="panel table-wrap"><table><thead><tr><th>Œuvre / client</th><th>Montant convenu</th><th>Paiement</th><th>Livraison</th><th></th></tr></thead><tbody>${state.sales.map((s) => `<tr><td>${esc(s.snapshot.title)}<small>${esc(state.inquiries.find((i) => i.id === s.inquiryId)?.name)}</small></td><td>${esc(money(s.amount, s.currency))}</td><td>${badge(s.payment)}</td><td>${badge(s.delivery)}</td><td>${button("edit-sale", "Suivre", s.id)}</td></tr>`).join("")}</tbody></table>${!state.sales.length ? empty("Aucune vente enregistrée.") : ""}</div>`
  );
}
function options(values, selected) {
  return values
    .map(
      (v) =>
        `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(labels[v] || v)}</option>`,
    )
    .join("");
}
function field(label, name, value = "", type = "text", extra = "") {
  return `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
}
function area(label, name, value = "", full = false) {
  return `<label class="field ${full ? "full" : ""}"><span>${label}</span><textarea name="${name}">${esc(value)}</textarea></label>`;
}
function select(label, name, values, selected) {
  return `<label class="field"><span>${label}</span><select name="${name}">${options(values, selected)}</select></label>`;
}
const formEnd =
  '<p class="error form-message" role="alert"></p><div class="form-actions"><button type="button" data-action="close-editor">Annuler</button><button class="primary" type="submit">Enregistrer</button></div>';
function settings() {
  const s = state.settings;
  return (
    heading(
      "L’identité de la galerie",
      "Coordonnées, présentation et informations de livraison.",
    ) +
    `<section class="panel"><form id="settings-form"><div class="form-grid">${field("Nom de l’artiste", "artistName", s.artistName, "text", 'required maxlength="200"')}${field("Implantation", "location", s.location, "text", "required")}${field("Email de contact", "email", s.email, "email")}${field("WhatsApp international", "whatsapp", s.whatsapp, "tel", 'placeholder="+39…"')}${field("Instagram (URL HTTPS)", "instagram", s.instagram, "url")}${field("Facebook (URL HTTPS)", "facebook", s.facebook, "url")}${field("Signature de la galerie", "tagline", s.tagline)}<label class="field"><span>Œuvre mise en avant</span><select name="featuredId"><option value="">Première œuvre publiée</option>${state.artworks
      .filter((a) => a.visibility === "published")
      .map(
        (a) =>
          `<option value="${esc(a.id)}" ${s.featuredId === a.id ? "selected" : ""}>${esc(a.title)}</option>`,
      )
      .join(
        "",
      )}</select></label>${area("Biographie", "biography", s.biography, true)}${area("Livraison depuis l’Italie", "deliveryText", s.deliveryText)}${area("Informations de paiement externe", "purchaseText", s.purchaseText)}</div><p class="error form-message" role="alert"></p><div class="form-actions"><button type="submit" class="primary">Enregistrer les paramètres</button></div></form></section><section class="panel security-panel"><h2>Accès à l’atelier</h2><p class="muted">Le changement de mot de passe déconnecte toutes les autres sessions.</p>${button("password", "Changer le mot de passe")}</section>`
  );
}
function backup() {
  return (
    heading(
      "Sauvegardes",
      "Conservez une copie des données de votre galerie.",
    ) +
    `<section class="panel"><h2>Exporter</h2><p class="muted">Le JSON contient les tableaux, paramètres, demandes et ventes. Les images sont référencées par leur adresse ; leurs fichiers ne sont pas inclus.</p><div class="backup-buttons">${button("export-json", "Télécharger le JSON", "", "primary")}${button("export-inquiries", "Demandes · CSV")}${button("export-sales", "Ventes · CSV")}</div><hr style="border:0;border-top:1px solid var(--line);margin:30px 0"><h2>Restaurer</h2><p class="muted">La restauration remplace les données de la galerie. Les identifiants administrateur restent inchangés. Exportez une copie avant de restaurer.</p><label class="field"><span>Sauvegarde JSON (2 Mo maximum)</span><input type="file" id="restore-file" accept="application/json,.json"></label></section>`
  );
}
function report(title, rows, key) {
  return `<section class="panel"><h2>${title}</h2>${rows?.map((row) => `<div class="report-row"><span>${esc(row[key] || "Direct / inconnu")}</span><strong>${esc(row.pageviews ?? row.count ?? 0)} pages · ${esc(row.visitors ?? 0)} visiteurs</strong></div>`).join("") || empty("Aucune donnée sur cette période.")}</section>`;
}
function analyticsView() {
  let content;
  if (!analyticsData) content = empty("Chargement des statistiques…");
  else if (!analyticsData.available)
    content = `<div class="notice-inline">${esc(analyticsData.message)}</div>`;
  else {
    const reports = analyticsData.reports;
    const trend = reports.day || [];
    const max = Math.max(1, ...trend.map((r) => r.pageviews));
    content = `<section class="panel"><h2>Pages consultées par jour</h2><div class="chart">${trend.map((r) => `<div class="chart-bar" style="height:${Math.max(1, (Number(r.pageviews) / max) * 100)}%" title="${esc(r.timestamp)} : ${esc(r.pageviews)} pages, ${esc(r.visitors)} visiteurs"></div>`).join("")}</div><p class="muted">${trend.reduce((s, r) => s + (Number(r.pageviews) || 0), 0)} pages consultées. Les visiteurs sont comptés par ligne ; les totaux de visiteurs uniques ne s’additionnent pas entre les jours.</p><div class="report-row"><span>Date</span><strong>Pages / visiteurs</strong></div>${trend.map((r) => `<div class="report-row"><span>${esc(r.timestamp?.slice(0, 10))}</span><strong>${esc(r.pageviews)} / ${esc(r.visitors)}</strong></div>`).join("")}</section><div class="analytics-grid">${report("Pays", reports.country, "country")}${report("Sources de trafic", reports.referrerHostname, "referrerHostname")}${report("Appareils", reports.deviceType, "deviceType")}${report("Pages", reports.requestPath, "requestPath")}</div><section class="panel" style="margin-top:20px"><h2>Interactions par œuvre</h2>${analyticsData.events ? analyticsData.events.map((r) => `<div class="report-row"><span>${esc(state.artworks.find((a) => a.id === r.eventData)?.title || r.eventData || "Œuvre supprimée")}</span><strong>${esc(r.count)}</strong></div>`).join("") || empty("Aucune interaction enregistrée.") : `<p class="muted">${esc(analyticsData.eventsMessage)}</p>`}</section>`;
  }
  return (
    heading(
      "L’audience de la galerie",
      "Données Vercel Analytics · trafic public en production.",
    ) +
    `<div class="toolbar"><select id="analytics-days" aria-label="Période">${[7, 30, 90].map((n) => `<option value="${n}" ${n === days ? "selected" : ""}>${n} derniers jours</option>`).join("")}</select>${button("refresh-analytics", "Actualiser")}</div>` +
    content
  );
}
function render() {
  if (view === "dashboard" && !audienceSummary) {
    audienceSummary = { loading: true };
    void refreshAudience();
  }
  const pages = {
    dashboard,
    artworks,
    media: mediaView,
    collections,
    inquiries,
    sales,
    settings,
    backup,
    analytics: analyticsView,
  };
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand"><img src="/assets/logo_square.jpeg" alt=""><div><strong>MD’art</strong><span class="eyebrow">L’atelier · Italie</span></div></div><nav class="nav" aria-label="Administration">${nav.map(([id, label, icon]) => `<button data-action="navigate" data-id="${id}" class="${view === id ? "active" : ""}" ${view === id ? 'aria-current="page"' : ""}><i data-lucide="${icon}"></i>${label}</button>`).join("")}</nav><div class="sidebar-bottom"><a href="/" target="_blank" rel="noopener">↗ Voir la galerie</a><span class="muted">Paiements hors du site</span>${button("logout", "Déconnexion", "", "quiet")}</div></aside><main class="main"><header class="topbar"><div class="eyebrow">Espace de gestion <small> / ${nav.find((n) => n[0] === view)?.[1]}</small></div><div class="actions">${button("reload", "Recharger", "", "quiet")}<div class="avatar"><span>MD</span><span>Administrateur</span></div></div></header>${local ? '<div class="notice-inline">Mode local : données enregistrées sur cet ordinateur. La production utilisera Vercel Blob.</div>' : ""}${pages[view]()}</main></div>`;
  icons();
}
function editor(title, content) {
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="editor-title">${title}</h2>${button("close-editor", "✕", "", "quiet")}</div>${content}`;
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector("input,select,textarea,button")?.focus();
}
function artworkEditor(id) {
  const a = state.artworks.find((a) => a.id === id) || {
    title: "",
    description: "",
    medium: "",
    dimensions: "",
    year: "",
    collectionId: "",
    imageIds: [],
    priceEUR: null,
    priceXOF: null,
    status: "available",
    visibility: "draft",
    order: state.artworks.length,
  };
  editor(
    id ? "Modifier le tableau" : "Ajouter un tableau",
    `<form id="art-form" data-id="${esc(id || "")}"><div class="form-grid">${field("Titre", "title", a.title, "text", 'required maxlength="200"')}${field("Année", "year", a.year, "text", 'pattern="[0-9]{4}" maxlength="4"')}${field("Technique", "medium", a.medium)}${field("Dimensions", "dimensions", a.dimensions)}${field("Prix en euros", "priceEUR", a.priceEUR ?? "", "number", 'min="0" step="0.01"')}${field("Prix en FCFA (facultatif)", "priceXOF", a.priceXOF ?? "", "number", 'min="0" step="1"')}${select("Disponibilité", "status", ["available", "reserved", "sold"], a.status)}${select("Publication", "visibility", ["draft", "published", "archived"], a.visibility)}<label class="field"><span>Collection</span><select name="collectionId"><option value="">Sans collection</option>${state.collections.map((c) => `<option value="${esc(c.id)}" ${a.collectionId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>${field("Ordre d’affichage", "order", a.order, "number", 'min="0" max="100000" step="1" required')}${area("Description", "description", a.description, true)}<label class="field full"><span>Image principale</span><select name="primaryImage" required><option value="">Choisir une image</option>${state.media.map((m) => `<option value="${esc(m.id)}" ${a.imageIds[0] === m.id ? "selected" : ""}>${esc(m.alt || m.name)}</option>`).join("")}</select></label><div class="field full"><span>Images complémentaires (jusqu’à 11)</span><div class="checkboxes">${state.media.map((m) => `<label class="image-choice"><img src="${esc(m.url)}" alt="${esc(m.alt)}"><span><input type="checkbox" name="imageIds" value="${esc(m.id)}" ${a.imageIds.includes(m.id) ? "checked" : ""}> ${esc(m.alt || m.name)}</span></label>`).join("")}</div><small>Ajoutez vos nouvelles images dans la médiathèque avant de créer le tableau.</small></div></div>${formEnd}${id ? `<div class="form-actions">${button("archive-art", "Archiver", id)}${button("delete-art", "Supprimer définitivement", id, "danger")}</div>` : ""}</form>`,
  );
}
function inquiryEditor(id) {
  const i = state.inquiries.find((i) => i.id === id);
  const existing = state.sales.find((s) => s.inquiryId === id);
  editor(
    "Demande d’acquisition",
    `<div class="detail"><strong>${esc(i.name)} · ${esc(i.artworkTitle)}</strong><br>${esc(i.email)}<br>${esc(i.phone)}<br>${esc(i.city)}<br>Devise souhaitée : ${esc(i.currency)}<br>${date(i.createdAt)}<p>${esc(i.message || "Aucun message.")}</p></div><form id="inquiry-form" data-id="${esc(id)}">${select("État de la demande", "status", ["new", "discussion", "accepted", "closed"], i.status)}${area("Notes internes", "notes", i.notes)}${formEnd}</form>${existing ? button("edit-sale", "Consulter la vente", existing.id) : i.status === "accepted" ? button("new-sale", "Créer une vente", id, "primary") : ""}`,
  );
}
function saleEditor(id, inquiryId) {
  const s = state.sales.find((s) => s.id === id);
  const i = state.inquiries.find((i) => i.id === (s?.inquiryId || inquiryId));
  const art = state.artworks.find((a) => a.id === i?.artworkId);
  const data = s || {
    amount: art?.priceEUR ?? "",
    currency: "EUR",
    payment: "pending",
    delivery: "preparing",
    tracking: "",
    notes: "",
  };
  editor(
    s ? "Suivi de la vente" : "Enregistrer une vente",
    `<p class="detail">${esc(i?.name)} · ${esc(s?.snapshot.title || art?.title)}<br>${esc(i?.city)}</p><form id="sale-form" data-id="${esc(id || "")}" data-inquiry="${esc(inquiryId || s?.inquiryId)}"><div class="form-grid">${field("Montant convenu", "amount", data.amount, "number", 'required min="0" step="0.01"')}${select("Devise", "currency", ["EUR", "XOF"], data.currency)}${select("Paiement externe", "payment", ["pending", "partial", "paid"], data.payment)}${select("Livraison", "delivery", ["preparing", "shipped", "delivered", "cancelled"], data.delivery)}${field("Référence de suivi", "tracking", data.tracking)}${area("Notes", "notes", data.notes, true)}</div><p class="muted">Le statut du tableau se modifie séparément dans le catalogue.</p>${formEnd}</form>`,
  );
}
function passwordForm(initial = false) {
  const content = `<form id="password-form">${field("Mot de passe actuel", "currentPassword", "", "password", 'required autocomplete="current-password"')}${field("Nouveau mot de passe", "newPassword", "", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"')}${field("Confirmer le nouveau mot de passe", "confirmation", "", "password", 'required minlength="12" autocomplete="new-password"')}<p class="muted">Au moins 12 caractères. Toutes les autres sessions seront fermées.</p><p class="error form-message" role="alert"></p><div class="form-actions">${initial ? "" : button("close-editor", "Annuler")}<button type="submit" class="primary">Changer le mot de passe</button></div></form>`;
  if (initial) {
    app.innerHTML = `<main class="login-page"><section class="login-panel"><h1>Bienvenue à l’atelier</h1><p class="lead">Personnalisez votre mot de passe pour accéder à la gestion.</p>${content}</section></main>`;
  } else editor("Changer le mot de passe", content);
}
function login() {
  app.innerHTML = `<main class="login-page"><section class="login-panel"><div class="brand"><img src="/assets/logo_square.jpeg" alt=""><div><strong>MD’art</strong><span class="eyebrow">L’atelier · Italie</span></div></div><h1>Entrer dans l’atelier</h1><p class="lead">Votre espace pour faire vivre la galerie.</p><form id="login-form">${field("Identifiant", "username", "admin", "text", 'required autocomplete="username"')}${field("Mot de passe", "password", "", "password", 'required maxlength="128" autocomplete="current-password"')}<p class="error form-message" role="alert"></p><button class="primary" type="submit">Se connecter</button></form><p class="muted" style="font-size:12px;margin-top:24px"><a href="/">← Retour à la galerie</a></p></section></main>`;
}
let analyticsRequest = 0;
async function loadAnalytics() {
  const requestId = ++analyticsRequest;
  const requestedDays = days;
  analyticsData = null;
  render();
  try {
    const result = await api(`/api/admin/analytics?days=${requestedDays}`);
    if (requestId !== analyticsRequest) return;
    analyticsData = result;
  } catch (e) {
    if (requestId !== analyticsRequest) return;
    analyticsData = { available: false, message: e.message };
  }
  if (view === "analytics") render();
}
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let v = String(value ?? "");
          if (/^[=+@\-\t\r\n]/.test(v)) v = `'${v}`;
          return `"${v.replaceAll('"', '""')}"`;
        })
        .join(";"),
    )
    .join("\r\n");
}
async function action(name, id) {
  if (name === "close-editor") {
    dialog.close();
    return;
  }
  if (name === "navigate") {
    view = id;
    render();
    if (view === "analytics") void loadAnalytics();
    return;
  }
  if (name === "reload") {
    if (
      dialog.open &&
      !confirm("Recharger et abandonner les modifications du formulaire ?")
    )
      return;
    dialog.close();
    await reload();
    audienceSummary = null;
    render();
    notify("Données rechargées.");
    return;
  }
  if (name === "logout") {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    dialog.close();
    state = null;
    audienceSummary = null;
    login();
    return;
  }
  if (name === "new-art" || name === "edit-art") {
    artworkEditor(id);
    return;
  }
  if (name === "edit-inquiry") {
    inquiryEditor(id);
    return;
  }
  if (name === "new-sale") {
    saleEditor("", id);
    return;
  }
  if (name === "edit-sale") {
    saleEditor(id);
    return;
  }
  if (name === "password") {
    passwordForm();
    return;
  }
  if (name === "archive-art") {
    const a = state.artworks.find((a) => a.id === id);
    await save("artworks", { ...a, visibility: "archived" }, id, "PUT");
    dialog.close();
    render();
    notify("Tableau archivé.");
    return;
  }
  if (name.startsWith("delete-")) {
    const resource = {
      "delete-art": "artworks",
      "delete-media": "media",
      "delete-collection": "collections",
    }[name];
    if (!resource) return;
    if (!confirm("Supprimer définitivement cet élément ?")) return;
    await save(resource, null, id, "DELETE");
    dialog.close();
    render();
    notify("Élément supprimé.");
    return;
  }
  if (name === "new-collection" || name === "edit-collection") {
    const c = state.collections.find((c) => c.id === id);
    editor(
      c ? "Modifier la collection" : "Nouvelle collection",
      `<form id="collection-form" data-id="${esc(id || "")}">${field("Nom de la collection", "name", c?.name || "", "text", 'required maxlength="200"')}${formEnd}</form>`,
    );
    return;
  }
  if (name === "edit-media") {
    const m = state.media.find((m) => m.id === id);
    editor(
      "Texte alternatif",
      `<form id="media-form" data-id="${esc(id)}">${field("Description accessible de l’image", "alt", m.alt, "text", 'maxlength="300"')}${formEnd}</form>`,
    );
    return;
  }
  if (name === "refresh-analytics") {
    await loadAnalytics();
    return;
  }
  if (name === "export-json") {
    download(
      JSON.stringify(state, null, 2),
      `mdart-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
    );
    return;
  }
  if (name === "export-inquiries") {
    download(
      "\ufeff" +
        csv([
          [
            "Nom",
            "Email",
            "Téléphone",
            "Ville",
            "Œuvre",
            "État",
            "Message",
            "Notes",
            "Date",
          ],
          ...state.inquiries.map((i) => [
            i.name,
            i.email,
            i.phone,
            i.city,
            i.artworkTitle,
            labels[i.status],
            i.message,
            i.notes,
            date(i.createdAt),
          ]),
        ]),
      "mdart-demandes.csv",
      "text/csv;charset=utf-8",
    );
    return;
  }
  if (name === "export-sales") {
    download(
      "\ufeff" +
        csv([
          [
            "Œuvre",
            "Client",
            "Montant",
            "Devise",
            "Paiement",
            "Livraison",
            "Suivi",
            "Notes",
            "Date",
          ],
          ...state.sales.map((s) => [
            s.snapshot.title,
            state.inquiries.find((i) => i.id === s.inquiryId)?.name,
            s.amount,
            s.currency,
            labels[s.payment],
            labels[s.delivery],
            s.tracking,
            s.notes,
            date(s.createdAt),
          ]),
        ]),
      "mdart-ventes.csv",
      "text/csv;charset=utf-8",
    );
  }
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || busy) return;
  try {
    busy = true;
    await action(target.dataset.action, target.dataset.id);
  } catch (e) {
    notify(e.message, true);
    if (e.status === 401) {
      dialog.close();
      login();
    }
  } finally {
    busy = false;
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    filter.search = event.target.value;
    document.querySelector("#art-list").innerHTML = artList();
  }
});
document.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.id.startsWith("filter-")) {
    filter[el.id.replace("filter-", "")] = el.value;
    document.querySelector("#art-list").innerHTML = artList();
  }
  if (el.id === "analytics-days") {
    days = Number(el.value);
    await loadAnalytics();
  }
  if (el.id === "upload-files") {
    const files = [...el.files];
    if (!files.length) return;
    try {
      busy = true;
      for (const file of files) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 10 * 1024 * 1024
        )
          throw new Error("Image refusée : JPEG, PNG, WebP et 10 Mo maximum.");
        let value = { name: file.name, alt: "" };
        if (local) {
          const buffer = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let n = 0; n < buffer.length; n += 8192)
            binary += String.fromCharCode(...buffer.subarray(n, n + 8192));
          value.base64 = btoa(binary);
        } else {
          const ext =
            file.type === "image/jpeg"
              ? "jpg"
              : file.type === "image/png"
                ? "png"
                : "webp";
          const blob = await upload(
            `${imagePrefix}${crypto.randomUUID()}.${ext}`,
            file,
            {
              access: "public",
              handleUploadUrl: "/api/admin/upload",
              onUploadProgress: ({ percentage }) => {
                const progress = document.querySelector("#upload-progress");
                if (progress) {
                  progress.hidden = false;
                  progress.value = percentage;
                }
              },
            },
          );
          value.url = blob.url;
        }
        await save("media", value);
      }
      render();
      notify("Images ajoutées.");
    } catch (e) {
      notify(e.message, true);
      render();
    } finally {
      busy = false;
    }
  }
  if (el.id === "restore-file" && el.files[0]) {
    try {
      if (el.files[0].size > 2 * 1024 * 1024)
        throw new Error("Sauvegarde trop volumineuse (2 Mo maximum).");
      const value = JSON.parse(await el.files[0].text());
      if (
        !confirm(
          "Remplacer les tableaux, paramètres, demandes et ventes avec cette sauvegarde ?",
        )
      )
        return;
      await save("restore", value);
      render();
      notify("Sauvegarde restaurée.");
    } catch (e) {
      notify(e.message, true);
    } finally {
      el.value = "";
    }
  }
});
document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (busy) return;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  const message = form.querySelector(".form-message");
  try {
    busy = true;
    submit.disabled = true;
    if (message) message.textContent = "";
    if (form.id === "login-form") {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      if (result.mustChangePassword) passwordForm(true);
      else {
        await reload();
        render();
      }
      return;
    }
    if (form.id === "password-form") {
      if (values.newPassword !== values.confirmation)
        throw new Error("Les nouveaux mots de passe ne correspondent pas.");
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify(values),
      });
      dialog.close();
      await reload();
      render();
      notify("Mot de passe changé.");
      return;
    }
    let resource;
    let value = values;
    const id = form.dataset.id || "";
    if (form.id === "art-form") {
      resource = "artworks";
      const selected = new FormData(form).getAll("imageIds");
      value = {
        ...values,
        imageIds: [
          values.primaryImage,
          ...selected.filter((v) => v !== values.primaryImage),
        ],
        priceEUR: values.priceEUR === "" ? null : Number(values.priceEUR),
        priceXOF: values.priceXOF === "" ? null : Number(values.priceXOF),
        order: Number(values.order),
      };
      delete value.primaryImage;
    }
    if (form.id === "collection-form") resource = "collections";
    if (form.id === "media-form") resource = "media";
    if (form.id === "settings-form") resource = "settings";
    if (form.id === "inquiry-form") resource = "inquiries";
    if (form.id === "sale-form") {
      resource = "sales";
      value = {
        ...values,
        amount: Number(values.amount),
        inquiryId: form.dataset.inquiry,
      };
    }
    if (!resource) throw new Error("Formulaire inconnu.");
    await save(resource, value, id, id ? "PUT" : "POST");
    dialog.close();
    render();
    notify("Modifications enregistrées.");
  } catch (e) {
    if (message) message.textContent = e.message;
    else notify(e.message, true);
    if (e.status === 401) {
      dialog.close();
      login();
    }
  } finally {
    busy = false;
    if (submit) submit.disabled = false;
  }
});
async function init() {
  try {
    const session = await api("/api/auth/session");
    if (session.mustChangePassword) {
      passwordForm(true);
      return;
    }
    await reload();
    render();
  } catch (e) {
    login();
    if (e.status !== 401) notify(e.message, true);
  }
}
init();
