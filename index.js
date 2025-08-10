const fs = require("fs");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fetch = require("node-fetch");

// ==== CONFIG ====
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const FIGMA_FILES_LIST = "figma_files.txt";

// ==== HELPERS ====
async function fetchFigma(url) {
  const res = await fetch(url, {
    headers: { "X-Figma-Token": FIGMA_TOKEN },
  });
  if (!res.ok) {
    throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function getAllComponents(fileKey) {
  const fileData = await fetchFigma(`https://api.figma.com/v1/files/${fileKey}`);
  const components = [];

  function walk(node) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      components.push({
        id: node.id,
        name: node.name,
        type: node.type,
        description: null, // пока пусто
        fileKey: fileKey,
      });
    }
    if (node.children) {
      node.children.forEach(walk);
    }
  }

  walk(fileData.document);
  return components;
}

async function enrichDescriptions(fileKey, comps) {
  const result = [];
  for (let i = 0; i < comps.length; i += 50) {
    const batch = comps.slice(i, i + 50);
    const ids = batch.map((c) => c.id).join(",");
    const data = await fetchFigma(
      `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${ids}`
    );
    batch.forEach((comp) => {
      const node = data.nodes[comp.id];
      if (node && node.document && node.document.description) {
        comp.description = node.document.description;
      } else {
        comp.description = "";
      }
      result.push(comp);
    });
    await new Promise((r) => setTimeout(r, 300)); // анти-спам
  }
  return result;
}

async function writeToGoogleSheets(allComponents) {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();

  const sheet =
    doc.sheetsByIndex[0] || (await doc.addSheet({ title: "Figma Components" }));

  await sheet.clear();
  await sheet.setHeaderRow([
    "Name",
    "Type",
    "Description",
    "File Key",
    "Node ID",
  ]);

  const rows = allComponents.map((c) => [
    c.name,
    c.type,
    c.description || "",
    c.fileKey,
    c.id,
  ]);
  await sheet.addRows(rows);
}

// ==== MAIN ====
(async () => {
  try {
    console.log("🚀 Старт процесса...");

    const fileUrls = fs
      .readFileSync(FIGMA_FILES_LIST, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let allComponents = [];

    for (const url of fileUrls) {
      console.log(`🔍 Обработка файла: ${url}`);
      const fileKey = url.split("/file/")[1].split("/")[0];
      const comps = await getAllComponents(fileKey);
      console.log(`   Найдено компонентов: ${comps.length}`);
      const enriched = await enrichDescriptions(fileKey, comps);
      allComponents = allComponents.concat(enriched);
    }

    console.log(`📦 Всего компонентов: ${allComponents.length}`);

    await writeToGoogleSheets(allComponents);

    console.log("✅ Готово! Все компоненты с описаниями записаны в Google Sheets.");
  } catch (err) {
    console.error("❌ Ошибка:", err);
    process.exit(1);
  }
})();
