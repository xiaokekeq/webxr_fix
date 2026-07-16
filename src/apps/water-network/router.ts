import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

export const waterNetworkRoutes: RouteRecordRaw[] = [
	{ path: '/', name: 'water-home', component: () => import( './views/Home.vue' ), meta: { title: '自来水管网核查系统', tab: 0 } },
	{ path: '/ar', name: 'water-ar', component: () => import( '@/shared/ar/views/ArWorkspace.vue' ), meta: { title: '自来水管网 AR 核查', tab: 1, workflowMode: 'ar-inspection' } },
	{ path: '/map', name: 'water-map', component: () => import( '@/shared/views/MapView.vue' ), meta: { title: '供水管网地图', tab: 2 } },
	{ path: '/records', name: 'water-records', component: () => import( '@/shared/views/Records.vue' ), meta: { title: '供水管网运维记录', tab: 3 } },
	{ path: '/profile', name: 'water-profile', component: () => import( '@/shared/views/Profile.vue' ), meta: { title: '我的', tab: 4 } },
	{ path: '/model-calibration', component: () => import( '@/shared/ar/views/ModelCalibration.vue' ), meta: { title: '现场基准配置', workflowMode: 'site-baseline-config' } }
];

export function createWaterNetworkRouter() {
	const router = createRouter( { history: createWebHashHistory( import.meta.env.BASE_URL ), routes: waterNetworkRoutes } );
	router.beforeEach( ( to ) => { document.title = ( to.meta.title as string ) || '自来水管网核查系统'; } );
	return router;
}
