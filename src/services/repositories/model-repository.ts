import type { PipeRecord } from '@/models/types/pipe-record.js';
import { loadPipeRecords as loadPipeRecordsFromJson } from '@/models/catalog/pipe-record-repository.js';
import type { ModelCatalogItem } from '@/models/catalog/model-types.js';
import { normalizeModelCatalogItem } from '@/models/catalog/model-catalog-normalizer.js';
import type { HttpClient } from '@/services/api/http-client.js';

const MODEL_CATALOG_URL = '/pipe-viewer/models.json';

export interface ModelSummary {
	id: string;
	name: string;
	configUrl: string;
}

export interface ModelRepository {
	listModels(): Promise<ModelCatalogItem[]>;
	getModelDefinition(modelId: string): Promise<ModelCatalogItem>;
	loadPipeRecords(modelId: string): Promise<Map<string, PipeRecord>>;
}

export class LocalJsonModelRepository implements ModelRepository {

	async listModels(): Promise<ModelCatalogItem[]> {

		const response = await fetch( MODEL_CATALOG_URL, { cache: 'no-store' } );
		if ( response.ok === false ) {
			throw new Error( `Failed to load models.json: HTTP ${response.status}` );
		}

		const data = await response.json();
		if ( Array.isArray( data ) === false ) {
			throw new Error( 'models.json must be an array.' );
		}

		return data.map( normalizeModelCatalogItem );

	}

	async getModelDefinition(modelId: string): Promise<ModelCatalogItem> {

		const models = await this.listModels();
		const model = models.find( ( item ) => item.id === modelId ) ?? null;
		if ( model === null ) {
			throw new Error( `Unknown modelId: ${modelId}` );
		}

		return model;

	}

	async loadPipeRecords(modelId: string): Promise<Map<string, PipeRecord>> {

		const model = await this.getModelDefinition( modelId );
		return loadPipeRecordsFromJson( model.pipesUrl );

	}

}

export class ApiModelRepository implements ModelRepository {

	constructor(private readonly http: HttpClient) {}

	listModels(): Promise<ModelCatalogItem[]> {

		return this.http.get<ModelCatalogItem[]>( '/api/models' );

	}

	getModelDefinition(modelId: string): Promise<ModelCatalogItem> {

		return this.http.get<ModelCatalogItem>( `/api/models/${modelId}` );

	}

	async loadPipeRecords(modelId: string): Promise<Map<string, PipeRecord>> {

		const records = await this.http.get<PipeRecord[]>( `/api/models/${modelId}/pipes` );
		return new Map( records.map( ( item ) => [ item.name, item ] ) );

	}

}
