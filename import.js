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

// Função para determinar categorias
function getCategories(tags) {
  const categories = [];

  if (tags.tourism === "museum") categories.push("museum");
  if (tags.historic) categories.push("historic");
  if (tags.tourism === "attraction") categories.push("attraction");
  if (tags.amenity === "theatre") categories.push("culture");
  if (tags.amenity === "place_of_worship") categories.push("religious");

  if (categories.length === 0) categories.push("landmark");

  return categories;
}

// Função importance level
function getImportance(tags) {
  if (tags.tourism === "museum") return 4;
  if (tags.historic) return 3;
  if (tags.tourism === "attraction") return 3;

  return 2;
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

    const response = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: query
      }
    );

    const data = await response.json();

    console.log(`Encontrados: ${data.elements.length}`);

    for (const place of data.elements) {

      if (!place.tags || !place.tags.name) continue;

      const osmId = `${place.type}_${place.id}`;

      // Evitar duplicados
      const exists = await db
        .collection("places")
        .where("source_data.osm_id", "==", osmId)
        .get();

      if (!exists.empty) continue;

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
    }

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
