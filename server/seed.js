export function seed() {
  const titles = [
    "Le Guerrier au Crépuscule",
    "Reine d’Or et d’Indigo",
    "La Danseuse du Feu Céleste",
  ];
  const images = [
    "/assets/peinture.jpeg",
    "/assets/peinture2.jpg",
    "/assets/peinture3.jpg",
  ];
  const descriptions = [
    "Acrylique, huile & pigments chauds sur lin",
    "Huile sur lin, parures feuille d’or & cobalt",
    "Empâtement au couteau, flammes d’ambre",
  ];
  return {
    schemaVersion: 1,
    artworks: titles.map((title, i) => ({
      id: String(i + 1),
      title,
      description: descriptions[i],
      medium: descriptions[i],
      dimensions: ["80 × 120 cm", "75 × 100 cm", "90 × 130 cm"][i],
      year: "",
      collectionId: String(i + 1),
      imageIds: [`seed-${i + 1}`],
      priceEUR: [2400, 2850, 3100][i],
      priceXOF: null,
      status: i === 2 ? "reserved" : "available",
      visibility: "published",
      order: i,
      createdAt: new Date().toISOString(),
    })),
    collections: ["Racines Solaires", "Majesté", "Énergie & Transe"].map(
      (name, i) => ({ id: String(i + 1), name }),
    ),
    media: images.map((url, i) => ({
      id: `seed-${i + 1}`,
      url,
      alt: titles[i],
      name: url.split("/").pop(),
      seed: true,
    })),
    inquiries: [],
    sales: [],
    audit: [],
    settings: {
      artistName: "Mandiaye Diaw",
      location: "Italie",
      email: "",
      whatsapp: "",
      instagram: "",
      facebook: "",
      biography:
        "Mandiaye Diaw, artiste peintre contemporain basé en Italie, façonne des toiles inspirées par la puissance des mythes et des civilisations solaires.",
      tagline: "Maison d’art contemporain basée en Italie.",
      deliveryText:
        "Livraison depuis l’Italie : modalités et tarifs convenus avec l’artiste.",
      purchaseText:
        "Paiement convenu directement avec l’artiste, hors de ce site.",
      featuredId: "1",
    },
  };
}
