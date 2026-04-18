const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const fetch = require("node-fetch");


// -----------------------------
// CLI PARAMS
// -----------------------------

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
};

console.log("CONFIG:", CONFIG);


// -----------------------------
// FIREBASE INIT
// -----------------------------

console.log("Initializing Firebase...");

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = getFirestore();

console.log("Firebase initialized");


// -----------------------------
// FIRESTORE TEST
// -----------------------------

async function testFirestore() {

  try {

    console.log("Testing read...");

    const snapshot = await db
      .collection("places")
      .limit(1)
      .get();

    console.log("Read OK:", snapshot.size);

    console.log("Testing write...");

    await db.collection("_health").add({
      test: true,
      created_at: new Date().toISOString()
    });

    console.log("Write OK");

  } catch (err) {

    console.log("Firestore ERROR:", err);
    throw err;

  }

}


// -----------------------------
// OVERPASS
// -----------------------------

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter"
];


async function fetchOverpass(query) {

  for (const endpoint of OVERPASS_ENDPOINTS) {

    try {

      console.log("Trying endpoint:", endpoint);

      const response = await fetch(endpoint, {
        method: "POST",
        body: query
      });

      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch {
        console.log("Invalid JSON response");
      }

    } catch (err) {
      console.log("Endpoint error:", err.message);
    }

  }

  throw new Error("All Overpass endpoints failed");
}


// -----------------------------
// IMPORT FUNCTION
// -----------------------------

async function importar() {

  await testFirestore();

  console.log("Importing:", CONFIG.city);

  const query = `
  [out:json][timeout:25];
  (
    node["tourism"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    node["historic"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    node["amenity"="museum"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
  );
  out center;
  `;

  const data = await fetchOverpass(query);

  console.log("Found:", data.elements.length);

  for (const place of data.elements) {

    if (!place.tags?.name) continue;

    const lat = place.lat || place.center?.lat;
    const lng = place.lon || place.center?.lon;

    try {

      await db.collection("places").add({

        name: place.tags.name,

        location: {
          lat,
          lng
        },

        tags: place.tags,

        source: "openstreetmap",

        city: CONFIG.city,
        state: CONFIG.state,
        country: CONFIG.country,

        created_at: new Date().toISOString()

      });

      console.log("Saved:", place.tags.name);

    } catch (err) {

      console.log("Save error:", err.message);

    }

  }

  console.log("Import finished");

}


// -----------------------------
// RUN
// -----------------------------

importar();
