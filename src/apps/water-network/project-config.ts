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
	defaultModelId: 'waternetwork',
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
	componentPropertyHud: {
		fields: [
			{ key: 'type', label: '管线类型' },
			{ key: 'diameter', label: '管径' },
			{ key: 'material', label: '材质' },
			{ key: 'depth', label: '埋深' },
			{ key: 'startPoint', label: '起点' },
			{ key: 'endPoint', label: '终点' },
			{ key: 'area', label: '所属区域' },
			{ key: 'status', label: '运行状态' },
			{ key: 'remark', label: '备注' }
		]
	},
	ui: ui as ProjectUiContent
};
