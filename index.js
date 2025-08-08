const fs = require('fs');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  FILES_LIST: 'figma_files.txt',
  MAX_COMPONENTS: 5000,
  REQUEST_DELAY: 500
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
          name: match[2].replace(/[-_]/g, ' ') 
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

// Получаем все компоненты файла
async function getFileComponents(fileKey) {
  await delay(CONFIG.REQUEST_DELAY);
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/components`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  if (!response.ok) throw new Error(`Ошибка получения компонентов: ${response.status}`);
  return await response.json();
}

// Получаем данные об использовании
async function getComponentsUsage(fileKey, componentIds) {
  await delay(CONFIG.REQUEST_DELAY);
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/component_usages?ids=${componentIds.join(',')}`,
    { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
  );
  if (!response.ok) throw new Error(`Ошибка получения использования: ${response.status}`);
  return await response.json();
}

// Получаем детали компонентов
async function getComponentsDetails(fileKey, componentIds) {
  await delay(CONFIG.REQUEST_DELAY);
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${componentIds.join(',')}`,
    { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
  );
  if (!response.ok) throw new Error(`Ошибка получения деталей: ${response.status}`);
  return await response.json();
}

async function processFigmaFile(file) {
  console.log(`\n🔍 Обрабатываем файл: ${file.name}`);
  
  try {
    // 1. Получаем все компоненты файла
    const { meta } = await getFileComponents(file.key);
    if (!meta || !meta.components) return [];
    
    console.log(`   Всего компонентов в файле: ${meta.components.length}`);
    
    // 2. Фильтруем компоненты с тегами
    const componentIds = meta.components
      .filter(comp => comp.description?.match(/#\w+/))
      .map(comp => comp.node_id);
    
    console.log(`   Компонентов с тегами: ${componentIds.length}`);
    
    if (componentIds.length === 0) return [];
    
    // 3. Получаем данные об использовании
    const usageData = await getComponentsUsage(file.key, componentIds);
    
    // 4. Получаем детали компонентов
    const { nodes } = await getComponentsDetails(file.key, componentIds);
    
    // 5. Формируем результат
    return componentIds.map(id => {
      const comp = meta.components.find(c => c.node_id === id);
      const node = nodes[id]?.document;
      
      return {
        id: id,
        name: node?.name || comp.name,
        tags: (comp.description.match(/#(\w+)/g) || [])
               .map(t => t.substring(1))
               .join('\n'),
        description: comp.description,
        instances_count: usageData.meta[id]?.instances_count || 0,
        file: file.name,
        page: node?.parent?.name || 'Unknown'
      };
    });

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
    ['Файл', 'Страница', 'Компонент', 'Теги', 'Использований', 'Ссылка'],
    ...components.map(comp => [
      comp.file,
      comp.page,
      comp.name,
      comp.tags,
      comp.instances_count,
      `https://www.figma.com/file/${comp.file.key}/?node-id=${comp.id}`
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