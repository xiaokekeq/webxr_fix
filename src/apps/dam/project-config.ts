import ui from './data/ui.json';
import type { ArProjectConfig, ProjectUiContent } from '@/shared/config/project-config.js';

const assetBaseUrl = `${import.meta.env.BASE_URL}projects/dam/`;

export const damProjectConfig: ArProjectConfig = {
	schemaVersion: '1.0',
	projectId: 'dam',
	basePath: import.meta.env.BASE_URL,
	assetBaseUrl,
	modelCatalogUrl: `${assetBaseUrl}models.json`,
	defaultModelId: 'dz1207',
	showModelSelector: true,
	labels: {
		appTitle: '堤防巡查系统',
		arTitle: '堤防 AR 巡查',
		enterAr: '进入 AR 巡查'
	},
	capabilities: {
		markerRegistration: true,
		modelPlacement: true,
		componentPicking: true,
		propertyInspection: true,
		inspectionRecord: true,
		sectionCut: true,
		layerControl: true,
		xray: true,
		measurement: true,
		screenshot: true
	},
	ui: ui as ProjectUiContent
};
