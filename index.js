const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = 'oZGlxnWyOHTAgG6cyLkNJh';
const GOOGLE_SHEETS_ID = '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const MAX_COMPONENTS = 500; // Лимит для тестирования

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

// Получаем детальную информацию о компоненте
async function getComponentDetails(nodeId) {
  try {
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
  } catch (error) {
    console.error(`Error fetching details for ${nodeId}:`, error);
    return null;
  }
}

// Формируем полные данные о компонентах
async function getFullComponentsData() {
  console.log('Получаем данные компонентов...');
  const componentsData = await getFigmaComponents();
  
  if (!componentsData.meta?.components) {
    throw new Error('Не удалось получить список компонентов');
  }
  
  console.log(`Найдено ${componentsData.meta.components.length} компонентов`);
  
  // Ограничиваем количество для теста
  const componentsToProcess = componentsData.meta.components.slice(0, MAX_COMPONENTS);
  console.log(`Обрабатываем ${componentsToProcess.length} компонентов...`);
  
  const result = [];
  
  for (const component of componentsToProcess) {
    try {
      const details = await getComponentDetails(component.node_id);
      
      result.push({
        name: component.name,
        usageCount: component.instances_count || 0, // Используем данные из основного запроса
        link: `https://www.figma.com/file/${FIGMA_FILE_KEY}/?node-id=${component.node_id}`,
        description: component.description || '',
        parameters: details ? {
          width: details.absoluteBoundingBox?.width,
          height: details.absoluteBoundingBox?.height,
          type: details.type
        } : {}
      });
      
      // Логируем прогресс
      if (result.length % 50 === 0) {
        console.log(`Обработано ${result.length} из ${componentsToProcess.length} компонентов`);
      }
    } catch (error) {
      console.error(`Ошибка при обработке компонента ${component.name}:`, error);
    }
  }
  
  return result;
}

// Обновляем Google таблицу
async function updateGoogleSheets(data) {
  try {
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
    console.log('Обновляем Google таблицу...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'A1:Z10000',
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'A1',
      valueInputOption: 'RAW',
      resource: { values }
    });
    
    console.log('Таблица успешно обновлена!');
  } catch (error) {
    console.error('Ошибка при обновлении таблицы:', error);
    throw error;
  }
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