import { HttpError } from "./store.js";
export async function analytics(days) {
  if (![7, 30, 90].includes(days))
    throw new HttpError(400, "Période invalide.");
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  const projectId = process.env.VERCEL_ANALYTICS_PROJECT_ID;
  const eventsEnabled = process.env.ANALYTICS_CUSTOM_EVENTS === "1";
  if (!token || !projectId)
    return {
      available: false,
      message: "Vercel Analytics n’est pas encore configuré.",
      eventsEnabled: false,
    };
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);
  async function query(by, dataset = "visits") {
    const params = new URLSearchParams({
      projectId,
      since: since.toISOString(),
      until: until.toISOString(),
      by,
      limit: "20",
      filter: "not startswith(requestPath, '/admin')",
    });
    if (process.env.VERCEL_ANALYTICS_TEAM_ID)
      params.set("teamId", process.env.VERCEL_ANALYTICS_TEAM_ID);
    const response = await fetch(
      `https://api.vercel.com/v1/query/web-analytics/${dataset}/aggregate?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok)
      throw new HttpError(
        502,
        "Statistiques indisponibles : vérifiez les droits API, la période et l’offre Vercel.",
      );
    return (await response.json()).data;
  }
  const dimensions = [
    "day",
    "country",
    "referrerHostname",
    "deviceType",
    "requestPath",
  ];
  const results = await Promise.all(dimensions.map((by) => query(by)));
  let events = null;
  let eventsMessage =
    "Les interactions personnalisées nécessitent une offre compatible et leur activation.";
  if (eventsEnabled) {
    try {
      events = await query("eventData/artworkId", "events");
      eventsMessage = "";
    } catch {
      eventsMessage =
        "Les interactions personnalisées ne sont pas accessibles avec la configuration actuelle.";
    }
  }
  return {
    available: true,
    days,
    reports: Object.fromEntries(dimensions.map((by, i) => [by, results[i]])),
    events,
    eventsEnabled,
    eventsMessage,
  };
}
