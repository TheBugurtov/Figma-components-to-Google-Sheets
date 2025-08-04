const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: 'oZGlxnWyOHTAgG6cyLkNJh',
  GOOGLE_SHEETS_ID: '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI',
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  COMPONENTS_LIMIT: 10,
  FRAME_NAME: "Component" // Имя фрейма для фильтрации
};

async function getFigmaFileStructure() {
  console.log('📂 Получаем структуру файла...');
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  
  if (!response.ok) throw new Error(`Ошибка API: ${response.statusText}`);
  return await response.json();
}

function findComponentsInFrames(document, frameName) {
  console.log(`🔍 Ищем фреймы с именем "${frameName}"...`);
  const components = [];
  
  function traverse(node) {
    if (node.name === frameName && node.type === "FRAME") {
      console.log(`Найден фрейм "${frameName}" (ID: ${node.id})`);
      if (node.children) {
        node.children.forEach(child => {
          if (child.type === "COMPONENT") {
            components.push(child);
          }
        });
      }
    }
    
    if (node.children) {
      node.children.forEach(traverse);
    }
  }
  
  document.document.children.forEach(traverse);
  return components;
}

async function updateGoogleSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Подготовка данных
  const rows = [
    ['Компонент', 'Использований', 'Ссылка', 'Фрейм-источник'],
    ...components.slice(0, CONFIG.COMPONENTS_LIMIT).map(comp => [
      comp.name,
      comp.instances_count || 0,
      `https://www.figma.com/file/${CONFIG.FIGMA_FILE_KEY}/?node-id=${comp.id}`,
      CONFIG.FRAME_NAME
    ])
  ];

  console.log('📝 Пример данных:', rows.slice(1, 3));

  // Очистка и запись
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1:D1000'
  });

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
    
    // Получаем полную структуру файла
    const fileData = await getFigmaFileStructure();
    
    // Ищем компоненты только в указанных фреймах
    const components = findComponentsInFrames(fileData, CONFIG.FRAME_NAME);
    
    if (components.length === 0) {
      throw new Error(`Не найдено компонентов во фреймах с именем "${CONFIG.FRAME_NAME}"`);
    }
    
    console.log(`🔧 Найдено ${components.length} компонентов в фреймах "${CONFIG.FRAME_NAME}":`);
    console.log(components.map(c => `- ${c.name}`).join('\n'));
    
    // Записываем в таблицу
    await updateGoogleSheets(components);
    
    console.log(`✅ Готово! Таблица обновлена: 
    https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
  } catch (error) {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
  }
}

main();