import type {
	ModelAssetTransform,
	ModelCatalogAssetItem,
	ModelCatalogItem
} from './model-types.js';

export function normalizeModelCatalogItem(item: unknown): ModelCatalogItem {

	if ( typeof item !== 'object' || item === null ) {
		throw new Error( 'Invalid model catalog entry.' );
	}

	const candidate = item as Partial<ModelCatalogItem>;
	if (
		typeof candidate.id !== 'string'
		|| typeof candidate.name !== 'string'
		|| typeof candidate.configUrl !== 'string'
		|| typeof candidate.pipesUrl !== 'string'
	) {
		throw new Error( 'Model catalog entry is missing required fields.' );
	}

	const assets = normalizeCatalogAssets( candidate );
	const primaryAsset = resolvePrimaryAsset( assets, candidate.primaryAssetId );

	return {
		id: candidate.id,
		name: candidate.name,
		modelUrl: primaryAsset.modelUrl,
		materialUrl: primaryAsset.materialUrl,
		assetTransform: primaryAsset.assetTransform,
		primaryAssetId: primaryAsset.id,
		assets,
		configUrl: candidate.configUrl,
		pipesUrl: candidate.pipesUrl
	};

}

function normalizeCatalogAssets(candidate: Partial<ModelCatalogItem>): ModelCatalogAssetItem[] {

	if ( Array.isArray( candidate.assets ) && candidate.assets.length > 0 ) {
		return candidate.assets.map( normalizeCatalogAssetItem );
	}

	if ( typeof candidate.modelUrl !== 'string' ) {
		throw new Error( 'Model catalog entry is missing required fields.' );
	}

	return [
		{
			id: 'primary',
			modelUrl: candidate.modelUrl,
			materialUrl: typeof candidate.materialUrl === 'string' ? candidate.materialUrl : undefined,
			assetTransform: normalizeAssetTransform( candidate.assetTransform )
		}
	];

}

function normalizeCatalogAssetItem(value: unknown): ModelCatalogAssetItem {

	if ( typeof value !== 'object' || value === null ) {
		throw new Error( 'Invalid model asset entry.' );
	}

	const candidate = value as Partial<ModelCatalogAssetItem>;
	if ( typeof candidate.id !== 'string' || typeof candidate.modelUrl !== 'string' ) {
		throw new Error( 'Model asset entry is missing required fields.' );
	}

	return {
		id: candidate.id,
		name: typeof candidate.name === 'string' ? candidate.name : undefined,
		modelUrl: candidate.modelUrl,
		materialUrl: typeof candidate.materialUrl === 'string' ? candidate.materialUrl : undefined,
		assetTransform: normalizeAssetTransform( candidate.assetTransform )
	};

}

function resolvePrimaryAsset(
	assets: ModelCatalogAssetItem[],
	requestedPrimaryAssetId: string | undefined
): ModelCatalogAssetItem {

	if ( typeof requestedPrimaryAssetId === 'string' ) {
		const matchedAsset = assets.find( ( asset ) => asset.id === requestedPrimaryAssetId );
		if ( matchedAsset === undefined ) {
			throw new Error( `Unknown primaryAssetId: ${requestedPrimaryAssetId}` );
		}

		return matchedAsset;
	}

	return assets[ 0 ];

}

function normalizeAssetTransform(value: unknown): ModelAssetTransform | undefined {

	if ( typeof value !== 'object' || value === null ) {
		return undefined;
	}

	const candidate = value as Partial<ModelAssetTransform>;
	const upAxis = candidate.upAxis === 'z' ? 'z' : candidate.upAxis === 'y' ? 'y' : undefined;
	const legacyScaleFactor = ( candidate as Partial<{ scaleFactor: number }> ).scaleFactor;
	const unitScale = typeof candidate.unitScale === 'number' && Number.isFinite( candidate.unitScale )
		? candidate.unitScale
		: typeof legacyScaleFactor === 'number' && Number.isFinite( legacyScaleFactor )
			? legacyScaleFactor
			: undefined;

	if ( typeof legacyScaleFactor === 'number' && Number.isFinite( legacyScaleFactor ) ) {
		console.warn( '[Model Catalog] assetTransform.scaleFactor is deprecated, please rename it to unitScale.' );
	}

	if ( upAxis === undefined && unitScale === undefined ) {
		return undefined;
	}

	return {
		upAxis,
		unitScale: unitScale !== undefined && unitScale > 0 ? unitScale : undefined
	};

}
