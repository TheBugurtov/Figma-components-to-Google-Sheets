const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = 'oZGlxnWyOHTAgG6cyLkNJh';
const GOOGLE_SHEETS_ID = '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const BATCH_SIZE = 100; // Размер пачки для запросов к API

// Функция для разбиения массива на части
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// Получаем данные компонентов из Figma API
async function getFigmaComponents() {
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/components`;
  const response = await fetch(url, {
    headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
  });
  
  if (!response.ok) {
    throw new Error(`Figma API error: ${response.statusText}`);
  }
  
  return await response.json();
}

// Получаем информацию об использовании компонентов (пачками)
async function getComponentUsage(componentIds) {
  const chunks = chunkArray(componentIds, BATCH_SIZE);
  const results = {};
  
  for (const chunk of chunks) {
    const ids = chunk.join(',');
    const url = `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/component_usages?ids=${ids}`;
    const response = await fetch(url, {
      headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
    });
    
    if (!response.ok) {
      throw new Error(`Figma API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    Object.assign(results, data.meta);
  }
  
  return { meta: results };
}

// Получаем детальную информацию о компоненте
async function getComponentDetails(nodeId) {
  const response = await fetch(
    `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/nodes?ids=${nodeId}`,
    { headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN } }
  );
  
  if (!response.ok) {
    console.error(`Error getting details for ${nodeId}: ${response.statusText}`);
    return null;
  }
  
  const data = await response.json();
  return data.nodes[nodeId]?.document;
}

// Формируем полные данные о компонентах
async function getFullComponentsData() {
  console.log('Получаем данные компонентов...');
  const componentsData = await getFigmaComponents();
  
  if (!componentsData.meta?.components) {
    throw new Error('Не удалось получить список компонентов');
  }
  
  console.log(`Найдено ${componentsData.meta.components.length} компонентов`);
  
  // Получаем данные об использовании (пачками)
  const componentIds = componentsData.meta.components.map(c => c.node_id);
  console.log('Получаем данные об использовании...');
  const usageData = await getComponentUsage(componentIds);
  
  // Собираем информацию о компонентах (выборочно, для примера)
  console.log('Собираем информацию о компонентах...');
  const sampleComponents = componentsData.meta.components.slice(0, 50); // Ограничиваем для демонстрации
  const result = [];
  
  for (const component of sampleComponents) {
    const usage = usageData.meta[component.node_id] || {};
    const details = await getComponentDetails(component.node_id);
    
    result.push({
      name: component.name,
      usageCount: usage.instances_count || 0,
      link: `https://www.figma.com/file/${FIGMA_FILE_KEY}/?node-id=${component.node_id}`,
      description: component.description || '',
      parameters: details ? {
        width: details.absoluteBoundingBox?.width,
        height: details.absoluteBoundingBox?.height
      } : {}
    });
  }
  
  return result;
}

// Обновляем Google таблицу
async function updateGoogleSheets(data) {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  const sheets = google.sheets({ version: 'v4', auth });
  
  // Подготавливаем данные
  const values = [
    ['Название компонента', 'Количество использований', 'Ссылка', 'Описание', 'Параметры']
  ];
  
  data.forEach(component => {
    values.push([
      component.name,
      component.usageCount,
      component.link,
      component.description,
      JSON.stringify(component.parameters)
    ]);
  });
  
  // Очищаем лист и записываем новые данные
  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1:Z1000',
  });
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    resource: { values }
  });
}

// Основная функция
async function main() {
  try {
    console.log('Запуск процесса обновления...');
    const components = await getFullComponentsData();
    await updateGoogleSheets(components);
    console.log('Процесс завершен успешно!');
  } catch (error) {
    console.error('Ошибка:', error);
    process.exit(1);
  }
}

main();