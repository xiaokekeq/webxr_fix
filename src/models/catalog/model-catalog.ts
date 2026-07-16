import { normalizeModelCatalogItem } from './model-catalog-normalizer.js';
import type { ModelCatalogItem } from './model-types.js';
import { repositories } from '@/services/repository-factory.js';

export async function fetchModelCatalog(): Promise<ModelCatalogItem[]> {

	void normalizeModelCatalogItem;
	return repositories.model.listModels();

}

export function findModelCatalogItem(
	items: ModelCatalogItem[],
	modelId: string
): ModelCatalogItem | null {

	return items.find( ( item ) => item.id === modelId ) ?? null;

}
