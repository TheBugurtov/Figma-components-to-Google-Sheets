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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getFullFileStructure(fileKey) {
  await delay(CONFIG.REQUEST_DELAY);
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  if (!response.ok) throw new Error(`Ошибка загрузки файла: ${response.status}`);
  return await response.json();
}

function extractComponentsFromTree(node, path = [], components = []) {
  const currentPath = [...path, node.name || ''];

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const tags = (node.description?.match(/#(\w+)/g) || []).map(t => t.slice(1));
    if (tags.length > 0) {
      components.push({
        id: node.id,
        name: node.name || 'Без имени',
        tags,
        description: node.description,
        page: path[0] || 'Unknown',
        fullPath: currentPath.join(' / ')
      });
    }
  }

  if (node.children) {
    for (const child of node.children) {
      extractComponentsFromTree(child, currentPath, components);
    }
  }

  return components;
}

async function processFigmaFile(file) {
  console.log(`\n🔍 Обрабатываем файл: ${file.name}`);

  try {
    const fileStructure = await getFullFileStructure(file.key);
    const documentRoot = fileStructure.document;

    const components = extractComponentsFromTree(documentRoot);

    console.log(`   Всего компонентов с тегами: ${components.length}`);

    return components.slice(0, CONFIG.MAX_COMPONENTS).map(comp => ({
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

  const rows = [
    ['Файл', 'Страница', 'Компонент', 'Теги', 'Путь', 'Ссылка'],
    ...components.map(comp => [
      comp.file,
      comp.page,
      comp.name,
      comp.tags.join('\n'),
      comp.fullPath,
      comp.link
    ])
  ];

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
              endColumnIndex: 5
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
