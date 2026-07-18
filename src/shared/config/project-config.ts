import type { App, InjectionKey } from 'vue';
import { computed, inject } from 'vue';
import type { ProjectRepositories } from '@/services/repository-factory.js';

export type ProjectDataSourceConfig =
	| { kind: 'local-json'; modelCatalogUrl: string }
	| { kind: 'api'; apiBaseUrl: string };

export interface ArProjectCapabilities {
	markerRegistration: boolean;
	modelPlacement: boolean;
	componentPicking: boolean;
	propertyInspection: boolean;
	inspectionRecord: boolean;
	sectionCut: boolean;
	layerControl: boolean;
	xray: boolean;
	measurement: boolean;
	screenshot: boolean;
}

export interface ComponentPropertyHudField {
	key: string;
	label: string;
	unit?: string;
}

/** Project fields rendered by the shared DOM property HUD. */
export interface ComponentPropertyHudConfig {
	fields: ComponentPropertyHudField[];
}

export interface ArProjectLabels {
	appTitle: string;
	arTitle: string;
	arSubtitle?: string;
	enterAr: string;
}

export interface ProjectUiContent {
	application: { name: string; shortName: string; arEntryLabel: string };
	sites: Array<{ id: string; name: string; lng: number; lat: number }>;
	weather: { icon: string; desc: string; temp: number };
	dashboard: {
		pressure: { label: string; value: string; unit: string; status: string };
		taskTitle: string;
		riskTitle: string;
		routeTitle: string;
		progressTitle: string;
		todoTitle: string;
		route: { distance: string; duration: string; checkpointCount: number };
		task: ProjectPatrolTask;
		riskStats: { fixedPoints: number; pendingReview: number; monitorAlerts: number; historyRisks: number };
		todoItems: Array<{ id: string; content: string; type: string; done: boolean }>;
		quickMenus: Array<{ icon: string; label: string; desc: string; path: string }>;
	};
	map: {
		title: string;
		zoom: number;
		legend: Array<{ type: string; label: string }>;
		markers: Array<{ id: string; lng: number; lat: number; type: 'checkpoint' | 'risk' | 'station' | 'patrol'; label: string; riskLevel?: string }>;
		route: [ number, number ][];
	};
	records: {
		title: string;
		subtitle: string;
		items: Array<{ icon: string; label: string; count: string; path: string }>;
	};
	profile: {
		title: string;
		avatar: string;
		name: string;
		role: string;
		items: Array<{ icon: string; label: string; path?: string }>;
	};
}

export interface ProjectPatrolTask {
	id: string;
	title: string;
	section: string;
	patrolRange: string;
	patrolDistance: string;
	priority: string;
	planTime: string;
	team: string;
	teamCount: number;
	status: string;
	riskLevel: string;
	startTime: string;
	assignee?: string;
	checkpoints: Array<{ id: string; name: string; lng: number; lat: number; checked: boolean; riskFlag?: string; note?: string; images?: string[] }>;
}

export interface ArProjectConfig {
	schemaVersion: '1.0';
	projectId: 'dam' | 'water-network';
	basePath: string;
	assetBaseUrl: string;
	dataSource: ProjectDataSourceConfig;
	defaultModelId: string;
	showModelSelector: boolean;
	labels: ArProjectLabels;
	capabilities: ArProjectCapabilities;
	ui: ProjectUiContent;
	propertySchemaUrl?: string;
	componentPropertyHud: ComponentPropertyHudConfig;
}

export interface ArApplicationContext {
	projectConfig: ArProjectConfig;
	repositories: ProjectRepositories;
}

const applicationContextKey: InjectionKey<ArApplicationContext> = Symbol( 'ar-application-context' );

export function provideArApplicationContext(app: App, context: ArApplicationContext): void {
	app.provide( applicationContextKey, context );
}

export function useArApplicationContext(): ArApplicationContext {
	const context = inject( applicationContextKey );
	if ( context === undefined ) throw new Error( 'AR application context was not provided.' );
	return context;
}

export function useProjectConfig(): ArProjectConfig {
	return useArApplicationContext().projectConfig;
}

export function useProjectUi() {
	const config = useProjectConfig();
	return { ui: computed( () => config.ui ) };
}
