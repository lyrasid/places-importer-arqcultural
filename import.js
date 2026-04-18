require("dotenv").config()

const admin = require("firebase-admin")
const axios = require("axios")

/*
CONFIGURAÇÃO
*/

const CONFIG = {
  city: process.env.CITY || "Barretos",
  lat: parseFloat(process.env.LAT || -20.557),
  lng: parseFloat(process.env.LNG || -48.567),
  radius: parseInt(process.env.RADIUS || 5000),
  state: process.env.STATE || "SP",
  country: process.env.COUNTRY || "Brasil"
}

console.log("CONFIG:", CONFIG)

/*
FIREBASE INIT
*/

console.log("Initializing Firebase...")

let serviceAccount

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  } else {
    serviceAccount = require("./serviceAccount.json")
  }
} catch (error) {
  console.error("Erro ao carregar service account:", error)
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

console.log("Firebase initialized")

/*
TEST FIRESTORE
*/

async function testFirestore() {
  try {
    console.log("Testing read...")

    const snapshot = await db.collection("places").limit(1).get()

    console.log("Firestore OK")
    console.log("Docs:", snapshot.size)
  } catch (error) {
    console.error("Firestore ERROR:", error)
    process.exit(1)
  }
}

/*
GOOGLE PLACES
*/

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY

async function fetchPlaces() {
  console.log("Fetching Google Places...")

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`

  const response = await axios.get(url, {
    params: {
      location: `${CONFIG.lat},${CONFIG.lng}`,
      radius: CONFIG.radius,
      keyword: "arquitetura",
      key: GOOGLE_API_KEY
    }
  })

  return response.data.results
}

/*
IMPORT
*/

async function importPlaces() {
  await testFirestore()

  const places = await fetchPlaces()

  console.log("Places found:", places.length)

  for (const place of places) {
    const ref = db.collection("places").doc(place.place_id)

    await ref.set(
      {
        name: place.name,
        address: place.vicinity || "",
        location: new admin.firestore.GeoPoint(
          place.geometry.location.lat,
          place.geometry.location.lng
        ),
        city: CONFIG.city,
        state: CONFIG.state,
        country: CONFIG.country,
        importedAt: new Date()
      },
      { merge: true }
    )

    console.log("Saved:", place.name)
  }

  console.log("Import finished")
}

importPlaces()
