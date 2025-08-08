const fs = require('fs');
const fetch = require('node-fetch');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

function parseFigmaFiles() {
  try {
    const content = fs.readFileSync('figma_files.txt', 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(url => {
        const match = url.match(/figma\.com\/file\/([a-zA-Z0-9]+)/);
        if (match) return { key: match[1], url };
        return null;
      })
      .filter(Boolean);
  } catch (e) {
    console.error('Ошибка чтения figma_files.txt:', e);
    return [];
  }
}

async function getFullFileStructure(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });
  if (!res.ok) throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
  return await res.json();
}

function extractNodesWithTags(node, currentPage = null, components = []) {
  if (node.type === 'CANVAS') currentPage = node.name;

  const desc = node.description || '';
  const tags = desc.match(/#[\wа-яёА-ЯЁ-]+/gi) || [];

  if (tags.length > 0) {
    components.push({
      id: node.id,
      name: node.name,
      description: desc,
      tags: tags.map(t => t.slice(1)).join(', '),
      page: currentPage || 'Unknown',
      type: node.type
    });
  }

  if (node.children) {
    node.children.forEach(child => extractNodesWithTags(child, currentPage, components));
  }
  return components;
}

async function writeToSheet(components, fileUrl) {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  await sheet.clear();
  await sheet.setHeaderRow(['Файл', 'Страница', 'Компонент', 'Теги', 'Ссылка']);

  const fileKey = fileUrl.match(/file\/([a-zA-Z0-9]+)/)[1];
  const rows = components.map(c => ({
    Файл: fileUrl,
    Страница: c.page,
    Компонент: c.name,
    Теги: c.tags,
    Ссылка: `https://www.figma.com/file/${fileKey}/?node-id=${c.id}`
  }));

  await sheet.addRows(rows);
  console.log(`✅ Записано ${rows.length} компонентов`);
}

(async () => {
  try {
    console.log('🚀 Старт процесса...');
    const files = parseFigmaFiles();
    if (files.length === 0) throw new Error('Нет файлов для обработки в figma_files.txt');

    for (const file of files) {
      console.log(`🔍 Обработка файла: ${file.url}`);
      const data = await getFullFileStructure(file.key);
      const components = extractNodesWithTags(data.document);
      console.log(`   Найдено компонентов с тегами: ${components.length}`);

      if (components.length > 0) {
        await writeToSheet(components, file.url);
      } else {
        console.log('   Компоненты с тегами не найдены.');
      }
    }

    console.log('🔄 Готово!');
  } catch (e) {
    console.error('❌ Ошибка:', e);
    process.exit(1);
  }
})();
