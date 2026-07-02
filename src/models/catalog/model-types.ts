export interface ModelAssetTransform {
	upAxis?: 'y' | 'z';
	unitScale?: number;
}

export interface ModelCatalogAssetItem {
	id: string;
	name?: string;
	modelUrl: string;
	materialUrl?: string;
	assetTransform?: ModelAssetTransform;
}

export interface ModelCatalogItem {
	id: string;
	name: string;
	modelUrl: string;
	materialUrl?: string;
	assetTransform?: ModelAssetTransform;
	primaryAssetId: string;
	assets: ModelCatalogAssetItem[];
	configUrl: string;
	pipesUrl: string;
}
