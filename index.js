// index.js — версия под твои secrets

const fetch = require("node-fetch");
const { GoogleSpreadsheet } = require("google-spreadsheet");

// Secrets
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY; // если нет — нужно добавить
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// ==== Получаем данные из Figma ====
async function getFigmaComponents() {
  console.log("🚀 Запуск процесса...");

  const res = await fetch(`https://api.figma.com/v1/files/${FILE_KEY}`, {
    headers: { "X-Figma-Token": FIGMA_TOKEN },
  });

  if (!res.ok) {
    throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  const components = [];

  function traverse(node, currentPage) {
    if (node.type === "CANVAS") {
      currentPage = node.name;
    }

    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      const cleanDesc = node.description
        ? node.description.replace(/\s+/g, " ").trim()
        : "";

      const tags = cleanDesc.match(/#[\p{L}\p{N}_-]+/gu) || [];

      if (tags.length > 0) {
        components.push({
          name: node.name,
          page: currentPage || "Unknown",
          tags: tags.map(t => t.replace("#", "")),
        });
      }
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child, currentPage);
      }
    }
  }

  for (const page of data.document.children) {
    traverse(page, page.name);
  }

  console.log(`   Найдено компонентов с тегами: ${components.length}`);
  return components;
}

// ==== Запись в Google Sheets ====
async function writeToSheet(components) {
  console.log("📝 Записываем данные в таблицу...");

  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0];
  await sheet.clear();
  await sheet.setHeaderRow(["Name", "Page", "Tags"]);

  const rows = components.map(c => ({
    Name: c.name,
    Page: c.page,
    Tags: c.tags.join(", "),
  }));

  await sheet.addRows(rows);

  console.log(`✅ Записано ${rows.length} компонентов`);
}

// ==== Основной запуск ====
(async () => {
  try {
    const components = await getFigmaComponents();
    await writeToSheet(components);
    console.log("🔄 Готово!");
  } catch (err) {
    console.error("❌ Ошибка:", err);
    process.exit(1);
  }
})();
