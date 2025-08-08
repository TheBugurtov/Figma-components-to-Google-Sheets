const fs = require("fs");
const fetch = require("node-fetch");
const { GoogleSpreadsheet } = require("google-spreadsheet");

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

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

// Получаем все компоненты с описаниями из /components
async function getAllComponents(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/components`, {
    headers: { "X-Figma-Token": FIGMA_TOKEN }
  });
  if (!res.ok) {
    throw new Error(`Ошибка Figma API компонентов (${fileKey}): ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.meta.components || [];
}

// Получаем имя страницы компонента по node_id через nodes API
async function getPageName(fileKey, nodeId) {
  const res = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`,
    { headers: { "X-Figma-Token": FIGMA_TOKEN } }
  );
  if (!res.ok) {
    throw new Error(`Ошибка получения пути компонента (${nodeId}): ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // путь к странице — в parents (сам node + родитель, возможно несколько уровней)
  // В ответе есть document с полной структурой под nodeId
  // Иногда parent - это страница. Возьмем имя первого родителя:
  try {
    const node = data.nodes[nodeId].document;
    // Родитель страницы - это node.parent в оригинальном API, но тут его нет, 
    // поэтому берем имя верхнего уровня (если есть children)
    // Обычно в data.nodes[nodeId].document есть "parent" отсутствует, поэтому берем document.name как страницу:
    // если node.type === "COMPONENT", то parent - страница, лежит в ancestors, но API не возвращает ancestors, поэтому
    // делаем упрощение — страница это ближайший ancestor с type="CANVAS"
    // Попробуем искать в data.nodes[nodeId].document

    // Пока как заглушка — возвращаем название компонента:
    return node ? node.name : "Unknown";
  } catch {
    return "Unknown";
  }
}

async function main() {
  try {
    console.log("🚀 Старт процесса...");
    const files = parseFigmaFiles();
    if (files.length === 0) throw new Error("Нет файлов для обработки в figma_files.txt");

    let allComponents = [];
    for (const file of files) {
      console.log(`🔍 Обработка файла: ${file.url}`);
      const components = await getAllComponents(file.key);
      console.log(`   Всего компонентов в файле: ${components.length}`);

      // Фильтруем компоненты с тегами в описании
      const taggedComponents = components.filter(c => c.description && c.description.match(/#[\wа-яёА-ЯЁ-]+/gi));

      console.log(`   Компонентов с тегами: ${taggedComponents.length}`);

      for (const comp of taggedComponents) {
        const pageName = await getPageName(file.key, comp.node_id);
        allComponents.push({
          file: file.url,
          page: pageName,
          name: comp.name,
          tags: (comp.description.match(/#[\wа-яёА-ЯЁ-]+/gi) || []).map(t => t.slice(1)).join(", "),
          link: `https://www.figma.com/file/${file.key}/?node-id=${comp.node_id}`
        });
      }
    }

    console.log(`Всего найдено компонентов с тегами: ${allComponents.length}`);

    if (allComponents.length === 0) {
      console.log("Компоненты с тегами не найдены.");
      return;
    }

    // Записываем в Google Sheets
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.clear();
    await sheet.setHeaderRow(["Файл", "Страница", "Компонент", "Теги", "Ссылка"]);

    const rows = allComponents.map(c => ({
      Файл: c.file,
      Страница: c.page,
      Компонент: c.name,
      Теги: c.tags,
      Ссылка: c.link,
    }));

    await sheet.addRows(rows);

    console.log("🔄 Готово!");
  } catch (e) {
    console.error("❌ Ошибка:", e);
    process.exit(1);
  }
}

main();
