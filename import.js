const admin = require("firebase-admin");

// ========== INIT FIREBASE ==========
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  throw new Error("FIREBASE_SERVICE_ACCOUNT não configurado");
}

// 🔥 FIX CRÍTICO: força região do Firestore
process.env.FIRESTORE_EMULATOR_HOST = undefined;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();

// força consistência regional (IMPORTANTE)
db.settings({
  host: "firestore.googleapis.com",
  ssl: true,
});

console.log("Firebase initialized OK");

// ========== CONFIG ==========
const CONFIG = {
  city: "Barretos",
  lat: -20.557,
  lng: -48.567,
  radius: 5000,
  state: "SP",
  country: "Brasil",
};

console.log("CONFIG:", CONFIG);

// ========== OVERPASS ENDPOINTS ==========
const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

// ========== QUERY ==========
function buildQuery(lat, lng, radius) {
  return `
  [out:json];
  (
    node(around:${radius},${lat},${lng});
    way(around:${radius},${lat},${lng});
    relation(around:${radius},${lat},${lng});
  );
  out center;
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

      if (data?.elements) {
        console.log("Encontrados:", data.elements.length);
        return data.elements;
      }
    } catch (err) {
      console.log("Erro endpoint:", err.message);
    }
  }

  throw new Error("Todos endpoints falharam");
}

// ========== FIRESTORE SAFE WRITE ==========
async function savePlace(place) {
  try {
    const id = place.id?.toString();
    if (!id) return false;

    await db.collection("places").doc(id).set({
      id,
      lat: place.lat || place.center?.lat,
      lng: place.lon || place.center?.lon,
      tags: place.tags || {},
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return true;
  } catch (err) {
    console.log("Erro salvar:", err.message);
    return false;
  }
}

// ========== MAIN ==========
async function run() {
  console.log("Importando", CONFIG.city);

  const query = buildQuery(CONFIG.lat, CONFIG.lng, CONFIG.radius);

  const places = await fetchOverpass(query);

  let saved = 0;
  let skipped = 0;

  for (const place of places) {
    const ok = await savePlace(place);
    if (ok) saved++;
    else skipped++;
  }

  console.log("Finalizado");
  console.log("Salvos:", saved);
  console.log("Ignorados:", skipped);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
