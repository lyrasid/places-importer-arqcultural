const admin = require("firebase-admin");
const fetch = require("node-fetch");


// ==============================
// CLI PARAMS
// ==============================

const args = process.argv.slice(2);

function getArg(name, defaultValue) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultValue;
}

const CONFIG = {
  city: getArg("city", "Barretos"),
  lat: parseFloat(getArg("lat", "-20.557")),
  lng: parseFloat(getArg("lng", "-48.567")),
  radius: parseInt(getArg("radius", "5000")),
  state: getArg("state", "SP"),
  country: getArg("country", "Brasil"),
  dryRun: getArg("dry-run", "false") === "true",
  limit: parseInt(getArg("limit", "9999"))
};

console.log("CONFIG:", CONFIG);


// ==============================
// FIREBASE
// ==============================

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


// ==============================
// OVERPASS
// ==============================

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter"
];


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function fetchOverpass(query, retries = 3) {

  for (const endpoint of OVERPASS_ENDPOINTS) {

    try {

      console.log("Endpoint:", endpoint);

      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        timeout: 30000
      });

      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch {

        console.log("Resposta inválida");
        console.log(text.substring(0, 200));

      }

    } catch (error) {

      console.log("Erro:", error.message);

    }
  }

  if (retries > 0) {
    console.log("Retry...");
    await sleep(5000);
    return fetchOverpass(query, retries - 1);
  }

  throw new Error("Todos endpoints falharam");
}



// ==============================
// CATEGORIAS
// ==============================

function getCategories(tags) {

  const categories = [];

  if (tags.tourism === "museum") categories.push("museum");
  if (tags.tourism === "gallery") categories.push("museum");
  if (tags.tourism === "attraction") categories.push("attraction");

  if (tags.historic) categories.push("historic");

  if (tags.amenity === "theatre") categories.push("culture");
  if (tags.amenity === "arts_centre") categories.push("culture");
  if (tags.amenity === "place_of_worship") categories.push("religious");

  if (tags.leisure === "park") categories.push("park");

  if (categories.length === 0) categories.push("landmark");

  return categories;
}


// ==============================
// IMPORTANCE
// ==============================

function getImportance(tags) {

  if (tags.wikipedia && tags.heritage) return 5;

  if (tags.tourism === "museum") return 4;

  if (tags.wikipedia) return 4;

  if (tags.historic) return 3;

  if (tags.tourism === "attraction") return 3;

  return 2;
}


// ==============================
// VALIDAR PLACE
// ==============================

function isValidPlace(place) {

  if (!place.tags) return false;

  if (!place.tags.name) return false;

  if (place.tags.access === "private") return false;

  return true;
}


// ==============================
// DUPLICATE CHECK
// ==============================

async function existsOsm(osmId) {

  const snapshot = await db
    .collection("places")
    .where("source_data.osm_id", "==", osmId)
    .get();

  return !snapshot.empty;
}



// ==============================
// IMPORT
// ==============================

async function importar() {

  console.log(`Importando ${CONFIG.city}`);

  const query = `
  [out:json][timeout:25];
  (
    node["tourism"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["tourism"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});

    node["historic"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["historic"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});

    node["amenity"="theatre"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["amenity"="theatre"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});

    node["amenity"="arts_centre"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["amenity"="arts_centre"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});

    node["amenity"="place_of_worship"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["amenity"="place_of_worship"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});

    node["leisure"="park"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["leisure"="park"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});

    node["historic"="monument"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["historic"="monument"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});

    node["tourism"="attraction"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    way["tourism"="attraction"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
  );
  out center;
  `;


  const data = await fetchOverpass(query);

  if (!data.elements) {
    console.log("Nenhum resultado");
    return;
  }

  console.log("Encontrados:", data.elements.length);


  let saved = 0;
  let skipped = 0;


  for (const place of data.elements) {

    if (saved >= CONFIG.limit) break;

    if (!isValidPlace(place)) {
      skipped++;
      continue;
    }

    const lat = place.lat || place.center?.lat;
    const lng = place.lon || place.center?.lon;

    if (!lat || !lng) continue;

    const osmId = `${place.type}_${place.id}`;

    const exists = await existsOsm(osmId);

    if (exists) {
      skipped++;
      continue;
    }


    const now = new Date().toISOString();

    const placeData = {

      name: place.tags.name,

      location: {
        lat,
        lng
      },

      address: {
        city: CONFIG.city,
        state: CONFIG.state,
        country: CONFIG.country
      },

      categories: getCategories(place.tags),

      importance_level: getImportance(place.tags),

      source_data: {
        source: "openstreetmap",
        osm_id: osmId,
        tags: place.tags
      },

      metadata: {
        ai_enriched: false,
        verified: false
      },

      created_at: now,
      updated_at: now
    };


    if (CONFIG.dryRun) {

      console.log("DRY RUN:", placeData.name);

    } else {

      await db.collection("places").add(placeData);

      console.log("Salvo:", placeData.name);

    }

    saved++;
  }


  console.log("Salvos:", saved);
  console.log("Ignorados:", skipped);

  console.log("Finalizado");
}


importar();
