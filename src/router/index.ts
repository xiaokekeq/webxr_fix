import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

type ProductId = 'dam' | 'water-network';

function productRoutes(product: ProductId): RouteRecordRaw[] {
	const basePath = product === 'dam' ? '/dam' : '/water-network';
	const title = product === 'dam' ? '堤坝现场辅助核查' : '供水管网智慧运维';
	const arTitle = product === 'dam' ? '堤坝 AR 巡查' : '供水管网 AR 巡查';
	const meta = { product };

	return [
		{ path: basePath, name: `${product}-home`, component: () => import( '@/views/Home.vue' ), meta: { ...meta, title, tab: 0 } },
		{ path: `${basePath}/ar`, name: `${product}-ar`, component: () => import( '@/views/ARInspect.vue' ), meta: { ...meta, title: arTitle, tab: 1, workflowMode: 'ar-inspection', arSceneType: product } },
		{ path: `${basePath}/map`, name: `${product}-map`, component: () => import( '@/views/MapView.vue' ), meta: { ...meta, title: `${title}地图`, tab: 2 } },
		{ path: `${basePath}/records`, name: `${product}-records`, component: () => import( '@/views/Records.vue' ), meta: { ...meta, title: `${title}记录`, tab: 3 } },
		{ path: `${basePath}/profile`, name: `${product}-profile`, component: () => import( '@/views/Profile.vue' ), meta: { ...meta, title: '我的', tab: 4 } }
	];
}

const routes: RouteRecordRaw[] = [
	{ path: '/', redirect: '/dam' },
	{ path: '/ar', redirect: '/dam/ar?autoStart=1' },
	{ path: '/map', redirect: '/dam/map' },
	{ path: '/records', redirect: '/dam/records' },
	{ path: '/profile', redirect: '/dam/profile' },
	{ path: '/map-full', redirect: '/dam/map' },
	{ path: '/records/patrol', redirect: '/dam/records' },
	{ path: '/records/history', redirect: '/dam/records' },
	{ path: '/model-calibration', component: () => import( '@/views/ModelCalibration.vue' ), meta: { title: '现场基准配置', workflowMode: 'site-baseline-config' } },
	...productRoutes( 'dam' ),
	...productRoutes( 'water-network' )
];

const router = createRouter( { history: createWebHashHistory(), routes } );

router.beforeEach( ( to ) => {
	document.title = ( to.meta.title as string ) || '现场辅助核查';
} );

export default router;
