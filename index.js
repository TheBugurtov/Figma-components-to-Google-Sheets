const fs = require("fs");
const fetch = require("node-fetch");
const { GoogleSpreadsheet } = require("google-spreadsheet");

// env
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

// files list
const filesList = fs.readFileSync("figma_files.txt", "utf8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean);

// fetch helper
async function fetchJson(url) {
  const res = await fetch(url, { headers: { "X-Figma-Token": FIGMA_TOKEN } });
  if (!res.ok) throw new Error(`Ошибка запроса к ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

// получить все компоненты из /components (возвращает объект { node_id: {...} })
async function getAllFigmaComponents(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const data = await fetchJson(url);
  // возвращаем массив значений, но сохраним ключ как node_id
  const compsObj = data.meta.components || {};
  return Object.values(compsObj).map(c => ({ ...c }));
}

// построить мапу nodeId -> node.type рекурсивно из документа файла
function buildNodeTypeMap(doc) {
  const map = {};
  function walk(node) {
    if (!node) return;
    if (node.id) map[node.id] = node.type || map[node.id] || null;
    if (Array.isArray(node.children)) {
      for (const ch of node.children) walk(ch);
    }
  }
  walk(doc);
  return map;
}

// запись в Google Sheets (google-spreadsheet)
async function writeToGoogleSheets(rows) {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  await sheet.clear();
  await sheet.setHeaderRow(["Component", "Link", "Tags", "Type", "File"]);
  // rows — массив объектов с ключами соответствующими заголовкам
  await sheet.addRows(rows);
}

// главная функция
(async () => {
  try {
    console.log("🚀 Старт процесса...");
    let allRows = [];

    for (const fileUrl of filesList) {
      console.log(`🔍 Обработка файла: ${fileUrl}`);
      const m = fileUrl.match(/file\/([a-zA-Z0-9]+)\//);
      if (!m) {
        console.warn(`⚠ Не удалось вытащить fileKey из URL: ${fileUrl}`);
        continue;
      }
      const fileKey = m[1];

      // 1) получаем файл (дерево) и строим мапу id->type
      const fileData = await fetchJson(`https://api.figma.com/v1/files/${fileKey}`);
      const documentTree = fileData.document;
      const nodeTypeMap = buildNodeTypeMap(documentTree);

      // 2) получаем компоненты из /components
      const components = await getAllFigmaComponents(fileKey);
      console.log(`   Всего компонентов в /components: ${components.length}`);

      // 3) формируем строки для таблицы
      for (const comp of components) {
        // node id в ответе /components — обычно node_id
        const nodeId = comp.node_id || comp.nodeId || comp.id || comp.key || "";
        const name = comp.name || "";
        const description = comp.description || "";
        const link = `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;

        // определяем тип через мапу; если не найдено — по умолчанию "Component"
        const rawType = nodeTypeMap[nodeId] || nodeTypeMap[comp.node_id] || null;
        const typeLabel = rawType === "COMPONENT_SET" ? "Component Set" : "Component";

        allRows.push({
          Component: name,
          Link: link,
          Tags: description,
          Type: typeLabel,
          File: fileKey
        });
      }
    }

    console.log(`📦 Всего строк для записи: ${allRows.length}`);
    await writeToGoogleSheets(allRows);
    console.log("✅ Готово! Таблица обновлена.");
  } catch (err) {
    console.error("❌ Ошибка:", err);
    process.exit(1);
  }
})();
