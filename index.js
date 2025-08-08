import fetch from "node-fetch";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FILE_KEY: process.env.FIGMA_FILE_KEY,
  SHEET_ID: process.env.SHEET_ID,
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  REQUEST_DELAY: 200
};

// ====== Вспомогательные функции ======
const delay = ms => new Promise(res => setTimeout(res, ms));

// Получаем все компоненты с пагинацией
async function getAllComponents(fileKey) {
  let allComponents = [];
  let cursor = null;

  while (true) {
    await delay(CONFIG.REQUEST_DELAY);

    const url = new URL(`https://api.figma.com/v1/files/${fileKey}/components`);
    url.searchParams.set("page_size", 500);
    if (cursor) url.searchParams.set("cursor", cursor);

    const resp = await fetch(url, {
      headers: { "X-FIGMA-TOKEN": CONFIG.FIGMA_TOKEN }
    });
    if (!resp.ok) throw new Error(`Ошибка API Figma: ${resp.status}`);
    const data = await resp.json();

    allComponents.push(...(data.meta?.components || []));
    if (!data.meta?.cursor?.next_page) break;
    cursor = data.meta.cursor.next_page;
  }

  return allComponents;
}

// Получаем карту nodeId → pageName
async function getPageMap(fileKey) {
  const resp = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { "X-FIGMA-TOKEN": CONFIG.FIGMA_TOKEN }
  });
  if (!resp.ok) throw new Error(`Ошибка получения файла: ${resp.status}`);
  const data = await resp.json();

  const pageMap = {};
  for (const page of data.document.children) {
    if (page.type === "CANVAS") {
      pageMap[page.id] = page.name;
      if (page.children) {
        page.children.forEach(node => mapNodeToPage(node, page.name, pageMap));
      }
    }
  }
  return pageMap;
}

function mapNodeToPage(node, pageName, pageMap) {
  pageMap[node.id] = pageName;
  if (node.children) {
    node.children.forEach(child => mapNodeToPage(child, pageName, pageMap));
  }
}

// Парсим теги из description
function extractTags(description) {
  if (!description) return [];
  const clean = description.replace(/\s+/g, " ").trim();
  return clean.match(/#[\p{L}\p{N}_-]+/gu)?.map(t => t.slice(1)) || [];
}

// ====== Основной процесс ======
(async () => {
  console.log("🚀 Запуск процесса...");

  const [components, pageMap] = await Promise.all([
    getAllComponents(CONFIG.FILE_KEY),
    getPageMap(CONFIG.FILE_KEY)
  ]);

  console.log(`   Всего компонентов в файле: ${components.length}`);

  const componentsWithTags = components
    .map(c => ({
      name: c.name,
      page: pageMap[c.containing_frame?.page_id] || "Unknown",
      tags: extractTags(c.description)
    }))
    .filter(c => c.tags.length > 0);

  console.log(`   Компонентов с тегами: ${componentsWithTags.length}`);

  // ===== Запись в Google Sheets =====
  const serviceAccountAuth = new JWT({
    email: CONFIG.GOOGLE_CLIENT_EMAIL,
    key: CONFIG.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const doc = new GoogleSpreadsheet(CONFIG.SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];

  await sheet.clear();
  await sheet.setHeaderRow(["Page", "Component Name", "Tag"]);

  const rows = componentsWithTags.flatMap(c =>
    c.tags.map(tag => ({
      Page: c.page,
      "Component Name": c.name,
      Tag: tag
    }))
  );

  await sheet.addRows(rows);

  console.log("✅ Запись в Google Sheets завершена");
  console.log(`🔗 Ссылка: https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`);
})();
