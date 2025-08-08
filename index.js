const fs = require("fs");
const fetch = require("node-fetch");
const { GoogleSpreadsheet } = require("google-spreadsheet");

// Секреты из env
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// Читаем список файлов из figma_files.txt
function parseFigmaFiles() {
  try {
    const content = fs.readFileSync("figma_files.txt", "utf-8");
    return content
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"))
      .map(url => {
        const match = url.match(/figma\.com\/file\/([a-zA-Z0-9]+)\//);
        if (match) return { key: match[1], url };
        return null;
      })
      .filter(Boolean);
  } catch (e) {
    console.error("Ошибка чтения figma_files.txt:", e);
    return [];
  }
}

// Получаем компоненты из одного файла
async function getComponentsFromFile(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { "X-Figma-Token": FIGMA_TOKEN }
  });
  if (!res.ok) {
    throw new Error(`Ошибка Figma API (${fileKey}): ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  const components = [];
  let count = 0;

  function traverse(node, currentPage) {
    if (node.type === "CANVAS") currentPage = node.name;

    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      count++;
      if (count <= 10) {
        console.log(`- ${node.name}: description='${node.description}'`);
      }
      const cleanDesc = node.description ? node.description.replace(/\s+/g, " ").trim() : "";
      // Новая регулярка для тегов с русскими и латинскими буквами
      const tags = cleanDesc.match(/#[\wа-яёА-ЯЁ-]+/gi) || [];
      if (tags.length > 0) {
        components.push({
          fileKey,
          name: node.name,
          page: currentPage || "Unknown",
          tags: tags.map(t => t.slice(1)),
        });
      }
    }

    if (node.children) node.children.forEach(child => traverse(child, currentPage));
  }

  data.document.children.forEach(page => traverse(page, page.name));

  return components;
}

// Запись в Google Sheets
async function writeToSheet(components) {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  await sheet.clear();
  await sheet.setHeaderRow(["File Key", "Page", "Component Name", "Tags"]);

  const rows = components.map(c => ({
    "File Key": c.fileKey,
    Page: c.page,
    "Component Name": c.name,
    Tags: c.tags.join(", "),
  }));

  await sheet.addRows(rows);
  console.log(`✅ Записано ${rows.length} компонентов`);
}

// Основной процесс
(async () => {
  try {
    console.log("🚀 Старт процесса...");
    const files = parseFigmaFiles();
    if (files.length === 0) throw new Error("Нет файлов для обработки в figma_files.txt");

    let allComponents = [];
    for (const file of files) {
      console.log(`🔍 Обработка файла: ${file.url}`);
      const comps = await getComponentsFromFile(file.key);
      allComponents = allComponents.concat(comps);
    }

    console.log(`Всего найдено компонентов с тегами: ${allComponents.length}`);

    if (allComponents.length === 0) {
      console.log("Компоненты с тегами не найдены.");
      return;
    }

    await writeToSheet(allComponents);
    console.log("🔄 Готово!");
  } catch (e) {
    console.error("❌ Ошибка:", e);
    process.exit(1);
  }
})();
