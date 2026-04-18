const admin = require("firebase-admin");
const fetch = require("node-fetch");

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


// FIREBASE

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

console.log("Project ID:", serviceAccount.project_id);
console.log("Client Email:", serviceAccount.client_email);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


async function testFirestore() {

  try {

    console.log("Testing read...");

    const test = await db.collection("places").limit(1).get();

    console.log("Read OK");

    console.log("Testing write...");

    await db.collection("_health").add({
      test: true,
      created_at: new Date().toISOString()
    });

    console.log("Write OK");

  } catch (err) {

    console.log("Firestore ERROR:", err.message);
    console.log(err);

    throw err;
  }

}


const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter"
];

async function fetchOverpass(query) {

  for (const endpoint of OVERPASS_ENDPOINTS) {

    try {

      console.log("Endpoint:", endpoint);

      const response = await fetch(endpoint, {
        method: "POST",
        body: query
      });

      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch {}

    } catch (err) {
      console.log("Erro:", err.message);
    }
  }

  throw new Error("Overpass falhou");
}


async function importar() {

  await testFirestore();

  console.log("Importando", CONFIG.city);

  const query = `
  [out:json][timeout:25];
  (
    node["tourism"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
    node["historic"](around:${CONFIG.radius},${CONFIG.lat},${CONFIG.lng});
  );
  out center;
  `;

  const data = await fetchOverpass(query);

  console.log("Encontrados:", data.elements.length);

  for (const place of data.elements) {

    if (!place.tags?.name) continue;

    const lat = place.lat || place.center?.lat;
    const lng = place.lon || place.center?.lon;

    await db.collection("places").add({
      name: place.tags.name,
      location: { lat, lng },
      created_at: new Date().toISOString()
    });

    console.log("Salvo:", place.tags.name);

  }

}

importar();
