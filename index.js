const fetch = require('node-fetch');

// Конфигурация
const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: process.env.FIGMA_FILE_KEY,
  MAX_COMPONENTS: 1000
};

// Получение полной структуры файла
async function getFullFileStructure() {
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });

  if (!response.ok) {
    throw new Error(`Ошибка при получении структуры файла: ${response.statusText}`);
  }

  const json = await response.json();
  return json;
}

// Рекурсивный поиск компонентов
function findComponentsRecursive(node, pageName) {
  let components = [];

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const name = node.name || '';
    const description = node.description || '';

    const trimmedDesc = description.trim();

    const reasons = [];
    if (!description || trimmedDesc === '') reasons.push('⛔ Нет description');
    if (name.includes('=')) reasons.push('⛔ В имени есть "="');

    if (reasons.length > 0) {
      console.log(`  [❌] ${name} (${node.type})\n     ${reasons.join(', ')}`);
    } else {
      console.log(`  [✅] ${name} (${node.type})`);
      components.push({
        id: node.id,
        name: name,
        description: trimmedDesc,
        page: pageName
      });
    }
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      components = components.concat(findComponentsRecursive(child, pageName));
    }
  }

  return components;
}

// Получение количества инстансов компонентов
async function getComponentsUsage(componentIds) {
  if (componentIds.length === 0) return {};

  const idsParam = componentIds.slice(0, 450).join(','); // Figma ограничивает длину строки
  const response = await fetch(
    `https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/component-sets?ids=${idsParam}`,
    { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
  );

  if (!response.ok) {
    console.warn('⚠️ Не удалось получить usage данных.');
    return {};
  }

  const data = await response.json();
  const result = {};

  if (data.meta && data.meta.components) {
    for (const comp of data.meta.components) {
      result[comp.node_id] = {
        instances_count: comp.containing_instance_count || 0
      };
    }
  }

  return result;
}

// Сканирование всех компонентов
async function getAllComponents() {
  console.log('🚀 Запуск процесса...');
  console.log('🔍 Начинаем сканирование...');

  const { document } = await getFullFileStructure();
  let allComponents = [];

  for (const page of document.children) {
    console.log(`📄 Обрабатываем страницу: ${page.name}`);
    const pageComponents = findComponentsRecursive(page, page.name);
    console.log(`   Найдено: ${pageComponents.length} компонентов`);
    allComponents.push(...pageComponents);

    if (allComponents.length >= CONFIG.MAX_COMPONENTS) {
      console.log(`⚠️ Достигнут лимит в ${CONFIG.MAX_COMPONENTS} компонентов`);
      break;
    }
  }

  const usageData = await getComponentsUsage(allComponents.map(c => c.id));
  return allComponents.map(comp => ({
    ...comp,
    instances_count: usageData[comp.id]?.instances_count || 0
  }));
}

// Запуск
(async () => {
  try {
    const components = await getAllComponents();
    console.log(`✅ Найдено компонентов: ${components.length}`);
  } catch (err) {
    console.error('🚨 Ошибка:', err.message);
  }
})();
