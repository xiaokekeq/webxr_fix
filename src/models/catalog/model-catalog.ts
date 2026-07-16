import type { ModelCatalogItem } from './model-types.js';
import type { ModelRepository } from '@/services/repositories/model-repository.js';

export async function fetchModelCatalog(modelRepository: ModelRepository): Promise<ModelCatalogItem[]> {

	return modelRepository.listModels();

}

export function findModelCatalogItem(
	items: ModelCatalogItem[],
	modelId: string
): ModelCatalogItem | null {

	return items.find( ( item ) => item.id === modelId ) ?? null;

}
