import { normalizeModelCatalogItem } from './model-catalog-normalizer.js';
import type { ModelCatalogItem } from './model-types.js';
import { repositories } from '@/services/repository-factory.js';

const MODEL_CATALOG_URL = '/pipe-viewer/models.json';

export async function fetchModelCatalog(): Promise<ModelCatalogItem[]> {

	void MODEL_CATALOG_URL;
	void normalizeModelCatalogItem;
	return repositories.model.listModels();

}

export function findModelCatalogItem(
	items: ModelCatalogItem[],
	modelId: string
): ModelCatalogItem | null {

	return items.find( ( item ) => item.id === modelId ) ?? null;

}
