const admin = require("firebase-admin");

// ========== INIT FIREBASE ==========
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  throw new Error("FIREBASE_SERVICE_ACCOUNT não configurado");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

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

// ========== OVERPASS ==========
const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

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

// ========== FETCH ==========
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

// ========== SAVE (BATCH FIX) ==========
async function savePlacesBatch(places) {
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;
  let total = 0;

  for (const place of places) {
    const id = place.id?.toString();
    if (!id) continue;

    const ref = db.collection("places").doc(id);

    batch.set(ref, {
      id,
      lat: place.lat || place.center?.lat || null,
      lng: place.lon || place.center?.lon || null,
      tags: place.tags || {},
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    count++;
    total++;

    if (count >= BATCH_SIZE) {
      await batch.commit();
      console.log(`Batch salvo: ${total}`);
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
    console.log(`Batch final salvo: ${total}`);
  }

  return total;
}

// ========== MAIN ==========
async function run() {
  console.log("Importando", CONFIG.city);

  const query = buildQuery(CONFIG.lat, CONFIG.lng, CONFIG.radius);
  const places = await fetchOverpass(query);

  const total = await savePlacesBatch(places);

  console.log("Finalizado");
  console.log("Total salvo:", total);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
