const fs = require("fs");

// ========== CONFIG (DINÂMICO VIA GITHUB ACTIONS) ==========
const CONFIG = {
  city: process.env.CITY || "Barretos",
  lat: Number(process.env.LAT ?? -20.557),
  lng: Number(process.env.LNG ?? -48.567),
  radius: Number(process.env.RADIUS ?? 1000),
  state: "SP",
  country: "Brasil",
};

console.log("CONFIG:", CONFIG);

// ========== OUTPUT FILE ==========
const citySlug = CONFIG.city.toLowerCase().replace(/\s+/g, "-");
const fileName = `places-${citySlug}.json`;

// ========== OVERPASS ENDPOINTS ==========
const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

// ========== QUERY (FASE 1.5 CULTURAL) ==========
function buildQuery(lat, lng, radius) {
  return `
  [out:json][timeout:25];
  (
    node(around:${radius},${lat},${lng})["historic"];
    way(around:${radius},${lat},${lng})["historic"];

    node(around:${radius},${lat},${lng})["tourism"="museum"];
    way(around:${radius},${lat},${lng})["tourism"="museum"];

    node(around:${radius},${lat},${lng})["amenity"="arts_centre"];
    way(around:${radius},${lat},${lng})["amenity"="arts_centre"];

    node(around:${radius},${lat},${lng})["amenity"="theatre"];
    way(around:${radius},${lat},${lng})["amenity"="theatre"];

    node(around:${radius},${lat},${lng})["amenity"="library"];
    way(around:${radius},${lat},${lng})["amenity"="library"];

    node(around:${radius},${lat},${lng})["amenity"="place_of_worship"];
    way(around:${radius},${lat},${lng})["amenity"="place_of_worship"];

    node(around:${radius},${lat},${lng})["leisure"="park"];
    way(around:${radius},${lat},${lng})["leisure"="park"];

    node(around:${radius},${lat},${lng})["building"];
    way(around:${radius},${lat},${lng})["building"];
  );
  out center tags;
  `;
}

// ========== FETCH OVERPASS ==========
async function fetchOverpass(query) {
  for (const url of ENDPOINTS) {
    try {
      console.log("Tentando:", url);

      const res = await fetch(url, {
        method: "POST",
        body: query,
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": "places-importer/1.0",
        },
      });

      const text = await res.text();

      if (!text || text.includes("<html")) continue;

      const data = JSON.parse(text);

      if (data?.elements?.length) {
        console.log("Encontrados:", data.elements.length);
        return data.elements;
      }
    } catch (err) {
      console.log("Erro endpoint:", err.message);
    }
  }

  throw new Error("Todos endpoints falharam");
}

// ========== CLEAN DATA ==========
function cleanPlaces(elements) {
  return elements
    .filter((p) => p && p.id)
    .map((p) => ({
      id: p.id.toString(),
      lat: p.lat || p.center?.lat || null,
      lng: p.lon || p.center?.lon || null,
      tags: p.tags || {},
    }))
    .filter((p) => p.lat && p.lng);
}

// ========== SAVE JSON ==========
function saveJSON(data) {
  fs.writeFileSync(
    fileName,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  console.log(`✔ ${fileName} gerado com ${data.length} registros`);
}

// ========== SAVE STATS ==========
function saveStats(data) {
  const stats = {
    total: data.length,
    withName: data.filter((p) => p.tags?.name).length,
    withAmenity: data.filter((p) => p.tags?.amenity).length,
    withTourism: data.filter((p) => p.tags?.tourism).length,
    generatedAt: new Date().toISOString(),
    city: CONFIG.city,
  };

  fs.writeFileSync(
    "stats.json",
    JSON.stringify(stats, null, 2),
    "utf-8"
  );

  console.log("✔ stats.json gerado");
}

// ========== MAIN ==========
async function run() {
  console.log("Importando:", CONFIG.city);

  const query = buildQuery(CONFIG.lat, CONFIG.lng, CONFIG.radius);
  const raw = await fetchOverpass(query);

  const places = cleanPlaces(raw);

  console.log("Após limpeza:", places.length);

  saveJSON(places);
  saveStats(places);

  console.log("Finalizado com sucesso 🚀");
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
