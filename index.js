const fs = require("fs");
const fetch = require("node-fetch");
const { GoogleSpreadsheet } = require("google-spreadsheet");

// === Чтение токенов и настроек из переменных окружения ===
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

// === Чтение списка файлов Figma из figma_files.txt ===
const filesList = fs.readFileSync("figma_files.txt", "utf8").split("\n").filter(Boolean);

async function getAllFigmaComponents(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const res = await fetch(url, {
    headers: { "X-Figma-Token": FIGMA_TOKEN }
  });
  if (!res.ok) {
    throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return Object.values(data.meta.components); // все компоненты
}

async function writeToGoogleSheets(components) {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0];
  await sheet.clear();
  await sheet.setHeaderRow(["Name", "Description", "Key", "File"]);

  const rows = components.map(c => ({
    Name: c.name || "",
    Description: c.description || "",
    Key: c.node_id || "",
    File: c.file_key || ""
  }));

  await sheet.addRows(rows);
}

(async () => {
  console.log("🚀 Старт процесса...");

  let allComponents = [];

  for (const fileUrl of filesList) {
    console.log(`🔍 Обработка файла: ${fileUrl}`);
    const match = fileUrl.match(/file\/([a-zA-Z0-9]+)\//);
    if (!match) {
      console.warn(`⚠ Не удалось извлечь ключ файла из URL: ${fileUrl}`);
      continue;
    }
    const fileKey = match[1];
    const comps = await getAllFigmaComponents(fileKey);
    console.log(`   Всего компонентов в файле: ${comps.length}`);
    allComponents.push(...comps.map(c => ({ ...c, file_key: fileKey })));
  }

  console.log(`📦 Всего компонентов во всех файлах: ${allComponents.length}`);

  await writeToGoogleSheets(allComponents);

  console.log("✅ Готово! Все компоненты записаны в Google Sheets.");
})();
