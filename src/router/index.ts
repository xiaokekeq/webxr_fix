import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

type ProductId = 'dam' | 'water-network';

function productRoutes(product: ProductId): RouteRecordRaw[] {
	const basePath = product === 'dam' ? '/dam' : '/water-network';
	const title = product === 'dam' ? '堤坝现场辅助核查' : '供水管网智慧运维';
	const arTitle = product === 'dam' ? '堤坝 AR 巡查' : '供水管网 AR 巡查';
	const meta = { product };

	return [
		{ path: basePath, name: `${product}-home`, component: product === 'dam' ? () => import( '@/views/Home.vue' ) : () => import( '@/views/WaterNetworkHome.vue' ), meta: { ...meta, title, tab: 0 } },
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
	{ path: '/map-full', component: () => import( '@/views/MapFull.vue' ), meta: { title: '全屏地图' } },
	{ path: '/records/patrol', component: () => import( '@/views/PatrolRecords.vue' ), meta: { title: '巡查记录' } },
	{ path: '/records/history', component: () => import( '@/views/HistoryRisks.vue' ), meta: { title: '历史险情' } },
	{ path: '/patrol', component: () => import( '@/views/Patrol.vue' ), meta: { title: '巡查任务' } },
	{ path: '/patrol/:id', component: () => import( '@/views/PatrolDetail.vue' ), meta: { title: '巡检详情' }, props: true },
	{ path: '/risks', component: () => import( '@/views/AllRisks.vue' ), meta: { title: '全部风险' } },
	{ path: '/monitor/stations', component: () => import( '@/views/MonitorStations.vue' ), meta: { title: '监测点位' } },
	{ path: '/shift', component: () => import( '@/views/ShiftHandover.vue' ), meta: { title: '交接班记录' } },
	{ path: '/supplies', component: () => import( '@/views/Supplies.vue' ), meta: { title: '应急物资' } },
	{ path: '/progress', component: () => import( '@/views/ProgressDetail.vue' ), meta: { title: '进度详情' } },
	{ path: '/reminders', component: () => import( '@/views/AllReminders.vue' ), meta: { title: '全部提醒' } },
	{ path: '/monitor', component: () => import( '@/views/RiskMonitor.vue' ), meta: { title: '风险监测' } },
	{ path: '/report', component: () => import( '@/views/Report.vue' ), meta: { title: '统计分析' } },
	{ path: '/risk-report', component: () => import( '@/views/RiskReport.vue' ), meta: { title: '险情上报' } },
	{ path: '/model-calibration', component: () => import( '@/views/ModelCalibration.vue' ), meta: { title: '现场基准配置', workflowMode: 'site-baseline-config' } },
	...productRoutes( 'dam' ),
	...productRoutes( 'water-network' )
];

const router = createRouter( { history: createWebHashHistory(), routes } );

router.beforeEach( ( to ) => {
	document.title = ( to.meta.title as string ) || '现场辅助核查';
} );

export default router;
