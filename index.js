// index.js

const fs = require("fs");
const fetch = require("node-fetch");
const { google } = require("googleapis");

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const FIGMA_FILES_LIST_PATH = "figma_files.txt";

const sheets = google.sheets("v4");
const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function getFullFileStructure(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { Authorization: `Bearer ${FIGMA_TOKEN}` },
  });
  if (!res.ok) throw new Error("Ошибка загрузки Figma-файла: " + res.statusText);
  const data = await res.json();
  return data.document;
}

function extractComponentsWithTags(node, path = []) {
  let components = [];

  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    const desc = node.description || "";
    const tags = desc.match(/#\S+/g);
    console.debug(`[DEBUG] ${[...path, node.name].join(" / ")} — description: ${desc}`);
    if (tags && tags.length > 0) {
      components.push({
        name: node.name,
        description: desc,
        tags: tags.map((t) => t.replace("#", "")),
        path: [...path, node.name].join(" / "),
      });
    }
  }

  if (node.children) {
    for (const child of node.children) {
      components = components.concat(extractComponentsWithTags(child, [...path, node.name]));
    }
  }

  return components;
}

async function writeToSheet(components) {
  const client = await auth.getClient();
  const rows = components.map((c) => [c.name, c.path, c.tags.join(", "), c.description]);
  rows.unshift(["Название", "Путь", "Теги", "Описание"]);

  await sheets.spreadsheets.values.update({
    auth: client,
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: "Компоненты!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

async function processFigmaFile(fileUrl) {
  try {
    const fileKey = fileUrl.split("/file/")[1].split("/")[0];
    console.log(`🔍 Обрабатываем файл: ${fileKey}`);
    const document = await getFullFileStructure(fileKey);

    const pages = document.children || [];
    console.log(`   Найдено страниц: ${pages.length}`);

    let allComponents = [];
    for (const page of pages) {
      const components = extractComponentsWithTags(page, [page.name]);
      allComponents = allComponents.concat(components);
    }

    console.log(`   Всего компонентов с тегами: ${allComponents.length}`);
    return allComponents;
  } catch (error) {
    console.error(`Ошибка обработки файла ${fileUrl}:`, error);
    return [];
  }
}

async function main() {
  console.log("🚀 Запуск процесса...");

  const fileUrls = fs
    .readFileSync(FIGMA_FILES_LIST_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  let allComponents = [];
  for (const fileUrl of fileUrls) {
    const components = await processFigmaFile(fileUrl);
    allComponents = allComponents.concat(components);
  }

  if (allComponents.length === 0) {
    console.log(`ℹ️ Компоненты с тегами не найдены. Проверьте:\n1. Наличие тегов (#tag) в описании компонентов\n2. Права доступа токена к файлу`);
  } else {
    await writeToSheet(allComponents);
    console.log(`✅ Загружено компонентов: ${allComponents.length}`);
  }
}

main().catch((err) => console.error("Необработанная ошибка:", err));