name: Import Places

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:
    inputs:
      city:
        description: "Cidade para importação"
        required: true
        default: "Barretos"
      lat:
        description: "Latitude"
        required: true
        default: "-20.557"
      lng:
        description: "Longitude"
        required: true
        default: "-48.567"
      radius:
        description: "Raio de busca"
        required: true
        default: "1000"

jobs:
  import:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install dependencies
        run: npm install

      - name: Run Import
        env:
          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          CITY: ${{ github.event.inputs.city }}
          LAT: ${{ github.event.inputs.lat }}
          LNG: ${{ github.event.inputs.lng }}
          RADIUS: ${{ github.event.inputs.radius }}
        run: node import.js

      - name: Upload JSON artifact
        uses: actions/upload-artifact@v4
        with:
          name: places-output
          path: places-*.json
