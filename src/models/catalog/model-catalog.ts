import { normalizeModelCatalogItem } from './model-catalog-normalizer.js';
import type { ModelCatalogItem } from './model-types.js';

const MODEL_CATALOG_URL = '/pipe-viewer/models.json';

export async function fetchModelCatalog(): Promise<ModelCatalogItem[]> {

	const response = await fetch( MODEL_CATALOG_URL );
	if ( response.ok === false ) {
		throw new Error( `Failed to load models.json: HTTP ${response.status}` );
	}

	const data = await response.json();
	if ( Array.isArray( data ) === false ) {
		throw new Error( 'models.json must be an array.' );
	}

	return data.map( normalizeModelCatalogItem );

}

export function findModelCatalogItem(
	items: ModelCatalogItem[],
	modelId: string
): ModelCatalogItem | null {

	return items.find( ( item ) => item.id === modelId ) ?? null;

}
