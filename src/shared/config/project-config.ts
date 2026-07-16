import type { App, InjectionKey } from 'vue';
import { computed, inject } from 'vue';

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
	modelCatalogUrl: string;
	defaultModelId: string;
	showModelSelector: boolean;
	labels: ArProjectLabels;
	capabilities: ArProjectCapabilities;
	ui: ProjectUiContent;
	propertySchemaUrl?: string;
	apiBaseUrl?: string;
}

const projectConfigKey: InjectionKey<ArProjectConfig> = Symbol( 'project-config' );

export function provideProjectConfig(app: App, config: ArProjectConfig): void {
	app.provide( projectConfigKey, config );
}

export function useProjectConfig(): ArProjectConfig {
	const config = inject( projectConfigKey );
	if ( config === undefined ) throw new Error( 'Project config was not provided.' );
	return config;
}

export function useProjectUi() {
	const config = useProjectConfig();
	return { ui: computed( () => config.ui ) };
}
