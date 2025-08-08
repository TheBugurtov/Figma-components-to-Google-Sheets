const fs = require('fs');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  FILES_LIST: 'figma_files.txt'
};

// Извлекаем ключи файлов из ссылок
function parseFigmaFiles() {
  try {
    const content = fs.readFileSync(CONFIG.FILES_LIST, 'utf-8');
    const urls = content.split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .map(line => {
        const match = line.match(/figma\.com\/file\/([a-zA-Z0-9]+)\//);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    
    console.log(`📁 Найдено файлов Figma: ${urls.length}`);
    return urls;
  } catch (error) {
    console.error('Ошибка чтения файла с ссылками:', error);
    return [];
  }
}

async function processFigmaFile(fileKey) {
  console.log(`\n🔍 Обрабатываем файл: ${fileKey}`);
  
  try {
    const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/components`, {
      headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
    });

    if (!response.ok) {
      console.error(`🚨 Ошибка ${response.status} для файла ${fileKey}`);
      return [];
    }

    const data = await response.json();
    const components = data.meta?.components || [];

    return components
      .filter(comp => comp.description?.match(/#\w+/))
      .map(comp => ({
        name: comp.name,
        tags: (comp.description.match(/#(\w+)/g) || []).map(t => t.substring(1)).join(', '),
        link: `https://www.figma.com/file/${fileKey}/?node-id=${comp.node_id}`,
        file: fileKey
      }));

  } catch (error) {
    console.error(`Ошибка обработки файла ${fileKey}:`, error);
    return [];
  }
}

async function updateGoogleSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const rows = [
    ['Файл', 'Компонент', 'Теги', 'Ссылка'],
    ...components.map(comp => [
      comp.file,
      comp.name,
      comp.tags,
      comp.link
    ])
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });
}

async function main() {
  try {
    console.log('🚀 Запуск процесса...');
    
    const fileKeys = parseFigmaFiles();
    if (fileKeys.length === 0) {
      throw new Error('Не найдено валидных Figma файлов для обработки');
    }

    let allComponents = [];
    for (const fileKey of fileKeys) {
      const components = await processFigmaFile(fileKey);
      console.log(`   Найдено компонентов: ${components.length}`);
      allComponents = [...allComponents, ...components];
    }

    if (allComponents.length > 0) {
      await updateGoogleSheets(allComponents);
      console.log(`✅ Всего записано компонентов: ${allComponents.length}`);
    } else {
      console.log('ℹ️ Компоненты с тегами не найдены ни в одном файле');
    }
  } catch (error) {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
  }
}

main();