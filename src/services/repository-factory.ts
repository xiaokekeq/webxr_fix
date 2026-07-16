import { FetchHttpClient } from '@/services/api/http-client.js';
import {
	ApiInspectionRepository,
	LocalStorageInspectionRepository
} from '@/services/repositories/inspection-repository.js';
import {
	ApiModelRepository,
	LocalJsonModelRepository
} from '@/services/repositories/model-repository.js';
import {
	ApiMonitoringDataRepository,
	MockMonitoringDataRepository
} from '@/services/repositories/monitoring-data-repository.js';
import {
	ApiSiteBaselineRepository,
	LocalStorageSiteBaselineRepository
} from '@/services/repositories/site-baseline-repository.js';
import {
	ApiSiteConfigRepository,
	LocalJsonSiteConfigRepository,
	type SiteConfigRepository
} from '@/services/repositories/site-config-repository.js';
import type { InspectionRepository } from '@/services/repositories/inspection-repository.js';
import type { ModelRepository } from '@/services/repositories/model-repository.js';
import type { MonitoringDataRepository } from '@/services/repositories/monitoring-data-repository.js';
import type { SiteBaselineRepository } from '@/services/repositories/site-baseline-repository.js';
import type { ArProjectConfig } from '@/shared/config/project-config.js';

export type RepositoryDataSource = 'local' | 'api';

export interface ProjectRepositories {
	dataSource: RepositoryDataSource;
	siteBaseline: SiteBaselineRepository;
	siteConfig: SiteConfigRepository;
	model: ModelRepository;
	inspection: InspectionRepository;
	monitoring: MonitoringDataRepository;
}

export function createProjectRepositories(config: ArProjectConfig): ProjectRepositories {
	if ( config.dataSource.kind === 'local-json' ) {
		if ( config.dataSource.modelCatalogUrl.trim().length === 0 ) {
			throw new Error( 'Local JSON data source requires modelCatalogUrl.' );
		}
		const model = new LocalJsonModelRepository( config.dataSource.modelCatalogUrl );
		return {
			dataSource: 'local',
			siteBaseline: new LocalStorageSiteBaselineRepository(),
			siteConfig: new LocalJsonSiteConfigRepository( model ),
			model,
			inspection: new LocalStorageInspectionRepository(),
			monitoring: new MockMonitoringDataRepository()
		};
	}

	if ( config.dataSource.apiBaseUrl.trim().length === 0 ) {
		throw new Error( 'API data source requires apiBaseUrl.' );
	}
	const httpClient = new FetchHttpClient( {
		baseUrl: config.dataSource.apiBaseUrl,
		timeoutMs: 10000
	} );
	return {
		dataSource: 'api',
		siteBaseline: new ApiSiteBaselineRepository( httpClient ),
		siteConfig: new ApiSiteConfigRepository( httpClient ),
		model: new ApiModelRepository( httpClient ),
		inspection: new ApiInspectionRepository( httpClient ),
		monitoring: new ApiMonitoringDataRepository( httpClient )
	};
}
