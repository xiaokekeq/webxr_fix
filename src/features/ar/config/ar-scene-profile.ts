import type { RouteLocationNormalizedLoaded } from 'vue-router';

export type ArSceneType = 'dam' | 'water-network';

export interface ArSceneCapabilities {
	markerRegistration: boolean;
	modelPlacement: boolean;
	componentPicking: boolean;
	propertyInspection: boolean;
	inspectionRecord: boolean;
	sectionCut: boolean;
	layerControl: boolean;
	xray: boolean;
	measurement: boolean;
}

export interface ArSceneProfile {
	id: ArSceneType;
	pageTitle: string;
	pageSubtitle?: string;
	enterArLabel: string;
	defaultModelId: string;
	showModelSelector: boolean;
	capabilities: ArSceneCapabilities;
}

export const AR_SCENE_PROFILES: Record<ArSceneType, ArSceneProfile> = {
	dam: {
		id: 'dam',
		pageTitle: '堤防 AR 巡查',
		enterArLabel: '进入 AR',
		defaultModelId: 'dz1207',
		showModelSelector: true,
		capabilities: {
			markerRegistration: true,
			modelPlacement: true,
			componentPicking: true,
			propertyInspection: true,
			inspectionRecord: true,
			sectionCut: true,
			layerControl: true,
			xray: true,
			measurement: true
		}
	},
	'water-network': {
		id: 'water-network',
		pageTitle: '自来水管网 AR 核查',
		pageSubtitle: '现场管线定位与属性查看',
		enterArLabel: '进入 AR 核查',
		defaultModelId: 'tongma-74-76-fbx',
		showModelSelector: false,
		capabilities: {
			markerRegistration: true,
			modelPlacement: true,
			componentPicking: true,
			propertyInspection: true,
			inspectionRecord: false,
			sectionCut: false,
			layerControl: false,
			xray: false,
			measurement: false
		}
	}
};

export function resolveArSceneProfile(route: Pick<RouteLocationNormalizedLoaded, 'meta'>): ArSceneProfile {

	return route.meta.arSceneType === 'water-network'
		? AR_SCENE_PROFILES[ 'water-network' ]
		: AR_SCENE_PROFILES.dam;

}
