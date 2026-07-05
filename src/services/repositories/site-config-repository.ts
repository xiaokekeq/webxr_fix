import {
	loadDemoModelConfig,
	type DemoModelConfig
} from '@/models/config/demo-model-config.js';
import type { HttpClient } from '@/services/api/http-client.js';
import type { ModelRepository } from '@/services/repositories/model-repository.js';

export interface SiteSummary {
	siteId: string;
	siteName: string;
	configUrl: string;
}

export interface SiteConfigRepository {
	listSites(): Promise<SiteSummary[]>;
	getSiteConfig(siteId: string): Promise<DemoModelConfig>;
}

export class LocalJsonSiteConfigRepository implements SiteConfigRepository {

	constructor(private readonly modelRepository: ModelRepository) {}

	async listSites(): Promise<SiteSummary[]> {

		const models = await this.modelRepository.listModels();
		return models.map( ( item ) => ( {
			siteId: item.id,
			siteName: item.name,
			configUrl: item.configUrl
		} ) );

	}

	async getSiteConfig(siteId: string): Promise<DemoModelConfig> {

		console.info( '[SiteConfigLoadStarted]', {
			mode: 'repository',
			siteId,
			dataSource: 'local',
			repository: 'siteConfig',
			targetId: null,
			imageUrl: null,
			createdAt: Date.now()
		} );
		try {
			const model = await this.modelRepository.getModelDefinition( siteId );
			const config = await loadDemoModelConfig( model.configUrl );
			console.info( '[SiteConfigLoadSucceeded]', {
				mode: 'repository',
				siteId,
				dataSource: 'local',
				repository: 'siteConfig',
				targetId: config.controlTargets[ 0 ]?.id ?? null,
				createdAt: Date.now()
			} );
			return config;
		} catch ( error ) {
			console.error( '[SiteConfigLoadFailed]', {
				mode: 'repository',
				siteId,
				dataSource: 'local',
				repository: 'siteConfig',
				targetId: null,
				imageUrl: null,
				createdAt: Date.now(),
				error: error instanceof Error ? error.message : String( error )
			} );
			throw error;
		}

	}

}

export class ApiSiteConfigRepository implements SiteConfigRepository {

	constructor(private readonly http: HttpClient) {}

	listSites(): Promise<SiteSummary[]> {

		return this.http.get<SiteSummary[]>( '/api/sites' );

	}

	getSiteConfig(siteId: string): Promise<DemoModelConfig> {

		return this.http.get<DemoModelConfig>( `/api/sites/${siteId}` );

	}

}
