import ui from './data/ui.json';
import type { ArProjectConfig, ProjectUiContent } from '@/shared/config/project-config.js';

const assetBaseUrl = `${import.meta.env.BASE_URL}projects/water-network/`;
const modelCatalogUrl = `${assetBaseUrl}models.json`;

export const waterNetworkProjectConfig: ArProjectConfig = {
	schemaVersion: '1.0',
	projectId: 'water-network',
	basePath: import.meta.env.BASE_URL,
	assetBaseUrl,
	dataSource: import.meta.env.VITE_DATA_SOURCE === 'api'
		? { kind: 'api', apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '' }
		: { kind: 'local-json', modelCatalogUrl },
	defaultModelId: 'tongma-74-76-fbx',
	showModelSelector: false,
	labels: {
		appTitle: '自来水管网核查系统',
		arTitle: '自来水管网 AR 核查',
		arSubtitle: '现场管线定位与属性查看',
		enterAr: '进入 AR 核查'
	},
	capabilities: {
		markerRegistration: true,
		modelPlacement: true,
		componentPicking: true,
		propertyInspection: true,
		inspectionRecord: false,
		sectionCut: false,
		layerControl: false,
		xray: false,
		measurement: false,
		screenshot: true
	},
	ui: ui as ProjectUiContent
};
