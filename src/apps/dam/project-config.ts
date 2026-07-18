import ui from './data/ui.json';
import type { ArProjectConfig, ProjectUiContent } from '@/shared/config/project-config.js';

const assetBaseUrl = `${import.meta.env.BASE_URL}projects/dam/`;
const modelCatalogUrl = `${assetBaseUrl}models.json`;

export const damProjectConfig: ArProjectConfig = {
	schemaVersion: '1.0',
	projectId: 'dam',
	basePath: import.meta.env.BASE_URL,
	assetBaseUrl,
	dataSource: import.meta.env.VITE_DATA_SOURCE === 'api'
		? { kind: 'api', apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '' }
		: { kind: 'local-json', modelCatalogUrl },
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
	componentPropertyHud: {
		fields: [
			{ key: 'type', label: '构件类型' },
			{ key: 'diameter', label: '规格' },
			{ key: 'material', label: '材质' },
			{ key: 'depth', label: '埋深' },
			{ key: 'status', label: '状态' },
			{ key: 'remark', label: '备注' }
		]
	},
	ui: ui as ProjectUiContent
};
