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

// Получаем дерево документа Figma
async function getFileDocument(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}`;
  const data = await fetchJson(url);
  return data.document;
}

// Получаем все компоненты с description из API /components
async function getAllComponents(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const data = await fetchJson(url);
  // возвращаем объект { node_id: {name, description, ...} }
  return data.meta.components || {};
}

// Рекурсивно собираем все COMPONENT и COMPONENT_SET из дерева
function collectComponentsFromNode(node, acc) {
  if (!node) return;
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    acc.push({
      id: node.id,
      name: node.name,
      type: node.type,
      // description достанем позже из API
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectComponentsFromNode(child, acc);
    }
  }
}

// Объединяем описание из API с компонентами из дерева
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

// Запись в Google Sheets через google-spreadsheet
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

  // Пакетная вставка строк
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

      const documentTree = await getFileDocument(fileKey);
      const componentsFromAPI = await getAllComponents(fileKey);

      const componentsFromTree = [];
      collectComponentsFromNode(documentTree, componentsFromTree);

      const merged = mergeDescriptions(componentsFromTree, componentsFromAPI);

      // Если description или file_key отсутствуют, подставим из файла
      merged.forEach(c => {
        if (!c.file_key) c.file_key = fileKey;
      });

      allComponents.push(...merged);
    }

    console.log(`📦 Всего компонентов во всех файлах: ${allComponents.length}`);

    await writeToGoogleSheets(allComponents);

    console.log("✅ Готово! Все компоненты записаны в Google Sheets.");
  } catch (e) {
    console.error("❌ Ошибка:", e);
    process.exit(1);
  }
})();
