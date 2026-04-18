const admin = require("firebase-admin");
const fetch = require("node-fetch");

// Inicializar Firebase
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


// Overpass endpoints (fallback automático)
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter"
];


// Delay helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// Fetch robusto Overpass
async function fetchOverpass(query, retries = 3) {

  for (const endpoint of OVERPASS_ENDPOINTS) {

    try {

      console.log(`Tentando endpoint: ${endpoint}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        console.log("Erro endpoint:", text.substring(0, 200));
        continue;
      }

      const text = await response.text();

      try {
        const data = JSON.parse(text);
        return data;

      } catch (err) {

        console.log("Resposta não JSON:");
        console.log(text.substring(0, 200));

        continue;
      }

    } catch (error) {

      console.log("Erro fetch:", error.message);
      continue;

    }

  }

  if (retries > 0) {
    console.log("Retry geral Overpass...");
    await sleep(5000);
    return fetchOverpass(query, retries - 1);
  }

  throw new Error("Todos endpoints Overpass falharam");
}



// Função para determinar categorias
function getCategories(tags) {

  const categories = [];

  if (tags.tourism === "museum") categories.push("museum");
  if (tags.historic) categories.push("historic");
  if (tags.tourism === "attraction") categories.push("attraction");
  if (tags.amenity === "theatre") categories.push("culture");
  if (tags.amenity === "place_of_worship") categories.push("religious");

  if (tags.building === "church") categories.push("religious");
  if (tags.building === "cathedral") categories.push("religious");

  if (categories.length === 0) categories.push("landmark");

  return categories;
}


// Função importance level
function getImportance(tags) {

  if (tags.wikipedia && tags.heritage) return 5;

  if (tags.tourism === "museum") return 4;

  if (tags.wikipedia) return 4;

  if (tags.historic) return 3;

  if (tags.tourism === "attraction") return 3;

  return 2;
}


// Filtro qualidade
function isValidPlace(place) {

  if (!place.tags) return false;

  if (!place.tags.name) return false;

  if (place.tags.name.length < 3) return false;

  if (place.tags.access === "private") return false;

  const blacklist = [
    "Prédio",
    "Estátua",
    "Monumento",
    "Building",
    "Statue"
  ];

  if (blacklist.includes(place.tags.name)) return false;

  return true;
}



// Deduplicação por proximidade
async function checkDuplicate(lat, lng, name) {

  const snapshot = await db
    .collection("places")
    .where("location.lat", ">=", lat - 0.0005)
    .where("location.lat", "<=", lat + 0.0005)
    .get();

  for (const doc of snapshot.docs) {

    const data = doc.data();

    if (!data.location) continue;

    const lngDiff = Math.abs(data.location.lng - lng);

    if (lngDiff < 0.0005) {

      if (
        data.name.toLowerCase() === name.toLowerCase()
      ) {
        return true;
      }
    }
  }

  return false;
}



// Função principal
async function importar() {

  const cidades = [
    {
      name: "Barretos",
      lat: -20.557,
      lon: -48.567,
      state: "SP",
      country: "Brasil"
    }
  ];


  for (const cidade of cidades) {

    console.log(`Importando ${cidade.name}...`);

    const query = `
    [out:json][timeout:25];
    (
      node["tourism"](around:5000,${cidade.lat},${cidade.lon});
      node["historic"](around:5000,${cidade.lat},${cidade.lon});
      node["amenity"="theatre"](around:5000,${cidade.lat},${cidade.lon});
      node["amenity"="place_of_worship"](around:5000,${cidade.lat},${cidade.lon});
    );
    out body;
    `;

    const data = await fetchOverpass(query);

    console.log(`Encontrados: ${data.elements.length}`);

    let saved = 0;
    let skipped = 0;


    for (const place of data.elements) {

      if (!isValidPlace(place)) {
        skipped++;
        continue;
      }

      const osmId = `${place.type}_${place.id}`;

      // Evitar duplicados por OSM
      const exists = await db
        .collection("places")
        .where("source_data.osm_id", "==", osmId)
        .get();

      if (!exists.empty) {
        skipped++;
        continue;
      }


      // Deduplicação por proximidade
      const duplicate = await checkDuplicate(
        place.lat,
        place.lon,
        place.tags.name
      );

      if (duplicate) {
        skipped++;
        continue;
      }


      const categories = getCategories(place.tags);
      const importance = getImportance(place.tags);

      const now = new Date().toISOString();

      const placeData = {

        name: place.tags.name,

        short_description: "",

        full_description: "",

        type:
          place.tags.tourism ||
          place.tags.historic ||
          "landmark",

        categories: categories,

        styles: [],

        location: {
          lat: place.lat,
          lng: place.lon
        },

        address: {
          street: place.tags["addr:street"] || "",
          city: cidade.name,
          state: cidade.state,
          country: cidade.country
        },

        visit_info: {
          recommended_time: "1-2h",
          best_time: "Dia",
          ticket_required: false
        },

        importance_level: importance,

        source_data: {
          source: "openstreetmap",
          osm_id: osmId,
          osm_type: place.type,
          tags: place.tags
        },

        media: {
          images: [],
          audio: []
        },

        metadata: {
          popularity_score: 0,
          ai_enriched: false,
          verified: false
        },

        created_at: now,
        updated_at: now
      };

      await db.collection("places").add(placeData);

      console.log(`Salvo: ${place.tags.name}`);

      saved++;
    }


    console.log(`Salvos: ${saved}`);
    console.log(`Ignorados: ${skipped}`);


    // Registrar sync
    await db.collection("sync_jobs").add({
      city: cidade.name,
      source: "openstreetmap",
      created_at: new Date().toISOString()
    });

  }

  console.log("Importação finalizada");
}

importar();
