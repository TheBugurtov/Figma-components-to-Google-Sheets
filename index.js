const fs = require("fs");
const fetch = require("node-fetch");
const { GoogleSpreadsheet } = require("google-spreadsheet");

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

const filesList = fs.readFileSync("figma_files.txt", "utf8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean);

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "X-Figma-Token": FIGMA_TOKEN } });
  if (!res.ok) {
    throw new Error(`Ошибка запроса к ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

// Получаем все компоненты с description из /components
async function getAllComponents(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const data = await fetchJson(url);
  return data.meta.components || {};
}

// Обходим дерево, чтобы вытащить ID и типы (но description позже добавляем из API)
function collectComponentsFromNode(node, acc) {
  if (!node) return;
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    acc.push({
      id: node.id,
      name: node.name,
      type: node.type
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectComponentsFromNode(child, acc);
    }
  }
}

// Объединяем данные: description берём только из API
function mergeDescriptions(componentsFromTree, componentsFromAPI) {
  return componentsFromTree.map(c => {
    const descObj = componentsFromAPI[c.id];
    return {
      ...c,
      description: descObj ? descObj.description || "" : "",
      file_key: descObj ? descObj.file_key || "" : ""
    };
  });
}

async function writeToGoogleSheets(components) {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0];
  await sheet.clear();
  await sheet.setHeaderRow(["Name", "Type", "Description", "Key", "File"]);

  const rows = components.map(c => ({
    Name: c.name || "",
    Type: c.type || "",
    Description: c.description || "",
    Key: c.id || "",
    File: c.file_key || ""
  }));

  await sheet.addRows(rows);
}

(async () => {
  try {
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

      // Получаем дерево документа
      const fileData = await fetchJson(`https://api.figma.com/v1/files/${fileKey}`);
      const documentTree = fileData.document;

      // Получаем компоненты из API (с description)
      const componentsFromAPI = await getAllComponents(fileKey);

      // Получаем все COMPONENT и COMPONENT_SET из дерева
      const componentsFromTree = [];
      collectComponentsFromNode(documentTree, componentsFromTree);

      // Объединяем данные
      const merged = mergeDescriptions(componentsFromTree, componentsFromAPI);

      // Если в API не вернулся file_key — добавим его вручную
      merged.forEach(c => { if (!c.file_key) c.file_key = fileKey; });

      allComponents.push(...merged);
    }

    console.log(`📦 Всего компонентов во всех файлах: ${allComponents.length}`);

    await writeToGoogleSheets(allComponents);

    console.log("✅ Готово! Данные записаны в Google Sheets.");
  } catch (e) {
    console.error("❌ Ошибка:", e);
    process.exit(1);
  }
})();
