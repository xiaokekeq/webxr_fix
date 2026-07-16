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
	LocalJsonSiteConfigRepository
} from '@/services/repositories/site-config-repository.js';
import type { ArProjectConfig } from '@/shared/config/project-config.js';

export type RepositoryDataSource = 'local' | 'api';

const dataSource: RepositoryDataSource = import.meta.env.VITE_DATA_SOURCE === 'api'
	? 'api'
	: 'local';
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
const httpClient = new FetchHttpClient( {
	baseUrl: apiBaseUrl,
	timeoutMs: 10000
} );


const modelRepository = dataSource === 'api'
	? new ApiModelRepository( httpClient )
	: new LocalJsonModelRepository( 'models.json' );

const siteConfigRepository = dataSource === 'api'
	? new ApiSiteConfigRepository( httpClient )
	: new LocalJsonSiteConfigRepository( modelRepository );

export const repositories = {
	dataSource,
	siteBaseline: dataSource === 'api'
		? new ApiSiteBaselineRepository( httpClient )
		: new LocalStorageSiteBaselineRepository(),
	siteConfig: siteConfigRepository,
	model: modelRepository,
	inspection: dataSource === 'api'
		? new ApiInspectionRepository( httpClient )
		: new LocalStorageInspectionRepository(),
	monitoring: dataSource === 'api'
		? new ApiMonitoringDataRepository( httpClient )
		: new MockMonitoringDataRepository()
};

export function configureRepositories(config: Pick<ArProjectConfig, 'modelCatalogUrl'>): void {
	if ( dataSource === 'api' ) return;
	const model = new LocalJsonModelRepository( config.modelCatalogUrl );
	repositories.model = model;
	repositories.siteConfig = new LocalJsonSiteConfigRepository( model );
}
