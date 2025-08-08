const fs = require('fs');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  FILES_LIST: 'figma_files.txt',
  MAX_COMPONENTS: 5000,
  SCAN_DEPTH: 4,
  REQUEST_DELAY: 500 // Задержка между запросами в ms
};

// Извлекаем ключи и названия файлов
function parseFigmaFiles() {
  try {
    const content = fs.readFileSync(CONFIG.FILES_LIST, 'utf-8');
    return content.split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .map(line => {
        const match = line.match(/figma\.com\/file\/([a-zA-Z0-9]+)\/([^\s?]+)/);
        return match ? { 
          key: match[1], 
          name: match[2].replace(/-/g, ' ').replace(/_/g, ' ') 
        } : null;
      })
      .filter(Boolean);
  } catch (error) {
    console.error('Ошибка чтения файла со ссылками:', error);
    return [];
  }
}

// Задержка между запросами
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Полная структура файла
async function getFullFileStructure(fileKey) {
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  if (!response.ok) throw new Error(`Ошибка загрузки файла: ${response.status}`);
  return await response.json();
}

// Получаем детали узлов
async function getNodesDetails(fileKey, nodeIds) {
  await delay(CONFIG.REQUEST_DELAY);
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeIds.join(',')}`,
    { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
  );
  if (!response.ok) throw new Error(`Ошибка получения узлов: ${response.status}`);
  return await response.json();
}

// Рекурсивный поиск компонентов с тегами
async function findComponentsWithTags(fileKey, node, pageName, results = []) {
  if (!node || results.length >= CONFIG.MAX_COMPONENTS) return results;

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const tags = node.description?.match(/#([\wа-яё]+)/gi);
    if (tags && tags.length > 0) {
      results.push({
        id: node.id,
        name: node.name.replace(/\n/g, ' '),
        tags: [...new Set(tags.map(t => t.substring(1)))].join('\n'),
        description: node.description,
        page: pageName
      });
    }
  }

  if (node.children && node.children.length > 0) {
    // Для глубоких структур получаем детали дочерних узлов
    if (CONFIG.SCAN_DEPTH > 1 && node.children.some(child => !child.type)) {
      const nodeIds = node.children.map(child => child.id).filter(Boolean);
      if (nodeIds.length > 0) {
        try {
          const { nodes } = await getNodesDetails(fileKey, nodeIds);
          for (const [id, childNode] of Object.entries(nodes)) {
            await findComponentsWithTags(fileKey, childNode.document, pageName, results);
          }
          return results;
        } catch (error) {
          console.error('Ошибка получения деталей узлов:', error);
        }
      }
    }

    // Обычная рекурсия для известных узлов
    for (const child of node.children) {
      if (child.type) {
        await findComponentsWithTags(fileKey, child, pageName, results);
      }
    }
  }

  return results;
}

async function processFigmaFile(file) {
  console.log(`\n🔍 Глубокое сканирование файла: ${file.name}`);
  
  try {
    const { document } = await getFullFileStructure(file.key);
    let allComponents = [];

    for (const page of document.children) {
      console.log(`   📄 Обрабатываем страницу: ${page.name}`);
      const components = await findComponentsWithTags(file.key, page, page.name);
      allComponents = [...allComponents, ...components];
      console.log(`      Найдено компонентов: ${components.length}`);
      
      if (allComponents.length >= CONFIG.MAX_COMPONENTS) break;
    }

    return allComponents.map(comp => ({
      ...comp,
      file: file.name,
      link: `https://www.figma.com/file/${file.key}/?node-id=${comp.id}`
    }));

  } catch (error) {
    console.error(`Ошибка обработки файла ${file.name}:`, error);
    return [];
  }
}

async function updateGoogleSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Подготовка данных
  const rows = [
    ['Файл', 'Страница', 'Компонент', 'Теги', 'Ссылка'],
    ...components.map(comp => [
      comp.file,
      comp.page,
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

  // Настройка форматирования
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    resource: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: 0,
              startRowIndex: 1,
              startColumnIndex: 3,
              endColumnIndex: 4
            },
            cell: {
              userEnteredFormat: {
                wrapStrategy: 'WRAP',
                verticalAlignment: 'TOP'
              }
            },
            fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'
          }
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: 0,
              gridProperties: {
                frozenRowCount: 1
              }
            },
            fields: 'gridProperties.frozenRowCount'
          }
        }
      ]
    }
  });
}

async function main() {
  try {
    console.log('🚀 Запуск процесса...');
    const startTime = Date.now();
    
    const files = parseFigmaFiles();
    if (files.length === 0) {
      throw new Error('Не найдено валидных Figma файлов для обработки');
    }

    let allComponents = [];
    for (const file of files) {
      const components = await processFigmaFile(file);
      allComponents = [...allComponents, ...components];
      
      if (allComponents.length >= CONFIG.MAX_COMPONENTS) {
        console.log(`⚠️ Достигнут лимит в ${CONFIG.MAX_COMPONENTS} компонентов`);
        break;
      }
    }

    console.log(`\n✅ Всего найдено компонентов с тегами: ${allComponents.length}`);
    
    if (allComponents.length > 0) {
      console.log('📝 Записываем данные в таблицу...');
      await updateGoogleSheets(allComponents);
      console.log(`🔄 Готово! Время выполнения: ${Math.round((Date.now() - startTime)/1000)} сек`);
      console.log(`🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
      
      // Сохраняем отчет
      fs.writeFileSync('last_run_report.json', JSON.stringify({
        date: new Date(),
        files: files.map(f => f.name),
        componentsCount: allComponents.length
      }, null, 2));
    } else {
      console.log('ℹ️ Компоненты с тегами не найдены. Проверьте:');
      console.log('1. Наличие тегов (#tag) в описании компонентов');
      console.log('2. Права доступа токена к файлу');
    }
  } catch (error) {
    console.error('💥 Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);