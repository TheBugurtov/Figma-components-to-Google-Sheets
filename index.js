const fetch = require("node-fetch");
const { GoogleSpreadsheet } = require("google-spreadsheet");

// ==== Настройки из secrets ====
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

// ==== Чтение списка файлов из figma_files.txt ====
const fs = require("fs");
const figmaFiles = fs
  .readFileSync("figma_files.txt", "utf-8")
  .split("\n")
  .map(line => line.trim())
  .filter(Boolean);

// ==== Получение компонетов через /components ====
async function getFigmaComponents(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const res = await fetch(url, {
    headers: { "X-Figma-Token": FIGMA_TOKEN }
  });

  if (!res.ok) {
    throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Object.values(data.meta.components); // Берём ВСЕ
}

// ==== Запись в Google Sheets ====
async function writeToGoogleSheets(rows) {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();

  const sheet = doc.sheets
