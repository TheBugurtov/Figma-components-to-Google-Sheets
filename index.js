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

// 1) Получаем полную структуру файла
async function getFileDocument(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}`;
  const data = await fetchJson(url);
  return data.document;
}

// 2) Получаем список всех компонентов с description из API /components (включая опубликованные description)
async function getAllComponents(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const data = await fetchJson(url);
  // components в формате { node_id: {name, description, ...} }
  return data.meta.components || {};
}

// 3) Рекурсивно обходим весь документ, собираем все COMPONENT и COMPONENT_SET
function collectComponentsFromNode(node, acc) {
  if (!node) return;
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    acc.push({
      id: node.id,
      name: node.name,
      type: node.type,
      // description из дерева не достоверен — подставим позже из API
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectComponentsFromNode(child, acc);
    }
  }
}

// 4) Объединяем описание из /components API с найденными в дереве компонентами
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

// 5) Запись в Google Sheets
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

      // Получаем дерево
      const documentTree = await getFileDocument(fileKey);

      // Получаем компоненты из API (с description)
      const componentsFromAPI = await getAllComponents(fileKey);

      // Получаем все COMPONENT и COMPONENT_SET из дерева
      const componentsFromTree = [];
      collectComponentsFromNode(documentTree, componentsFromTree);

      // Объединяем описания
      const merged = mergeDescriptions(componentsFromTree, componentsFromAPI);

      // Для удобства добавим file_key каждому компоненту (если отсутствует)
      merged.forEach(c => { if (!c.file_key) c.file_key = fileKey; });

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
