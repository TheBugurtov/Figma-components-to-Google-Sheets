const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = 'oZGlxnWyOHTAgG6cyLkNJh'; // Ключ из URL вашего Figma файла
const GOOGLE_SHEETS_ID = '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI'; // ID вашей Google таблицы
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// Получаем данные компонентов из Figma
async function getFigmaComponents() {
  try {
    const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/components`, {
      headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
    });
    
    if (!response.ok) throw new Error(`Figma API error: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.error('Ошибка при получении компонентов:', error);
    throw error;
  }
}

// Получаем информацию об использовании компонентов
async function getComponentUsage(componentIds) {
  try {
    const response = await fetch(
      `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/component_usages?ids=${componentIds.join(',')}`, 
      { headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN } }
    );
    
    if (!response.ok) throw new Error(`Figma API error: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.error('Ошибка при получении данных об использовании:', error);
    throw error;
  }
}

// Получаем детальную информацию о компоненте
async function getComponentDetails(nodeId) {
  try {
    const response = await fetch(
      `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/nodes?ids=${nodeId}`,
      { headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN } }
    );
    
    if (!response.ok) throw new Error(`Figma API error: ${response.statusText}`);
    const data = await response.json();
    return data.nodes[nodeId]?.document;
  } catch (error) {
    console.error(`Ошибка при получении деталей компонента ${nodeId}:`, error);
    return null;
  }
}

// Формируем полные данные о компонентах
async function getFullComponentsData() {
  try {
    console.log('Получаем данные компонентов...');
    const componentsData = await getFigmaComponents();
    
    if (!componentsData.meta?.components) {
      throw new Error('Не удалось получить список компонентов');
    }
    
    console.log(`Найдено ${componentsData.meta.components.length} компонентов`);
    
    // Получаем данные об использовании
    const componentIds = componentsData.meta.components.map(c => c.node_id);
    const usageData = await getComponentUsage(componentIds);
    
    // Собираем полную информацию
    const result = [];
    
    for (const component of componentsData.meta.components) {
      const usage = usageData.meta[component.node_id] || {};
      const details = await getComponentDetails(component.node_id);
      
      result.push({
        name: component.name,
        usageCount: usage.instances_count || 0,
        link: `https://www.figma.com/file/${FIGMA_FILE_KEY}/?node-id=${component.node_id}`,
        description: component.description || '',
        parameters: details ? extractParameters(details) : {}
      });
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка при формировании данных:', error);
    throw error;
  }
}

// Извлекаем параметры компонента
function extractParameters(componentData) {
  const params = {};
  
  // Размеры
  if (componentData.absoluteBoundingBox) {
    params.width = componentData.absoluteBoundingBox.width;
    params.height = componentData.absoluteBoundingBox.height;
  }
  
  // Стили (пример)
  if (componentData.fills && componentData.fills.length > 0) {
    params.fill = componentData.fills[0].color;
  }
  
  // Другие параметры, которые вам нужны
  // Можно добавить обработку текстовых стилей, эффектов и т.д.
  
  return params;
}

// Обновляем Google таблицу
async function updateGoogleSheets(data) {
  try {
    console.log('Подготавливаем данные для Google Sheets...');
    
    const auth = new google.auth.GoogleAuth({
      credentials: GOOGLE_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Подготовка данных
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
    
    // Очистка листа
    console.log('Очищаем лист...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'A1:Z1000',
    });
    
    // Запись данных
    console.log('Записываем новые данные...');
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'A1',
      valueInputOption: 'RAW',
      resource: { values }
    });
    
    console.log('Данные успешно обновлены!');
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
    console.error('Ошибка в основном процессе:', error);
    process.exit(1);
  }
}

// Запуск
main();