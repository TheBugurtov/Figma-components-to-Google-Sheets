const fs = require('fs');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  FILES_LIST: 'figma_files.txt',
  MAX_COMPONENTS: 5000 // Увеличили лимит
};

// Извлекаем ключи и названия файлов
function parseFigmaFiles() {
  try {
    const content = fs.readFileSync(CONFIG.FILES_LIST, 'utf-8');
    return content.split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .map(line => {
        const match = line.match(/figma\.com\/file\/([a-zA-Z0-9]+)\/([^\s?]+)/);
        return match ? { key: match[1], name: match[2].replace(/-/g, ' ') } : null;
      })
      .filter(Boolean);
  } catch (error) {
    console.error('Ошибка чтения файла со ссылками:', error);
    return [];
  }
}

async function processFigmaFile(file) {
  console.log(`\n🔍 Обрабатываем файл: ${file.name} (${file.key})`);
  
  try {
    const response = await fetch(`https://api.figma.com/v1/files/${file.key}/components`, {
      headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
    });

    if (!response.ok) {
      console.error(`🚨 Ошибка ${response.status} для файла ${file.key}`);
      return [];
    }

    const data = await response.json();
    const components = data.meta?.components || [];

    return components
      .filter(comp => comp.description?.match(/#\w+/))
      .map(comp => ({
        name: comp.name,
        tags: (comp.description.match(/#(\w+)/g) || [])
          .map(t => t.substring(1))
          .join('\n'), // Перенос строки между тегами
        link: `https://www.figma.com/file/${file.key}/?node-id=${comp.node_id}`,
        file: file.name // Используем человекочитаемое название
      }));

  } catch (error) {
    console.error(`Ошибка обработки файла ${file.key}:`, error);
    return [];
  }
}

async function updateGoogleSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Форматирование данных
  const rows = [
    ['Файл', 'Компонент', 'Теги', 'Ссылка'],
    ...components.map(comp => [
      comp.file,
      comp.name,
      comp.tags,
      comp.link
    ])
  ];

  // Очистка и запись
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1:Z10000'
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });

  // Настройка переноса текста
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    resource: {
      requests: [{
        repeatCell: {
          range: {
            sheetId: 0,
            startRowIndex: 1,
            startColumnIndex: 2,
            endColumnIndex: 3
          },
          cell: {
            userEnteredFormat: {
              wrapStrategy: 'WRAP'
            }
          },
          fields: 'userEnteredFormat.wrapStrategy'
        }
      }]
    }
  });
}

async function main() {
  try {
    console.log('🚀 Запуск процесса...');
    
    const files = parseFigmaFiles();
    if (files.length === 0) {
      throw new Error('Не найдено валидных Figma файлов для обработки');
    }

    let allComponents = [];
    for (const file of files) {
      const components = await processFigmaFile(file);
      console.log(`   Найдено компонентов: ${components.length}`);
      allComponents = [...allComponents, ...components];
      
      if (allComponents.length >= CONFIG.MAX_COMPONENTS) {
        console.log(`⚠️ Достигнут лимит в ${CONFIG.MAX_COMPONENTS} компонентов`);
        break;
      }
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