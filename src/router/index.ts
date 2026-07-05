import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
	{
		path: '/',
		component: () => import( '@/views/Home.vue' ),
		meta: { title: '堤防 AR', tab: 0 }
	},
	{
		path: '/ar',
		component: () => import( '@/views/ARInspect.vue' ),
		meta: { title: '堤防 AR 巡查', tab: 1, workflowMode: 'ar-inspection' }
	},
	{
		path: '/model-calibration',
		component: () => import( '@/views/ModelCalibration.vue' ),
		meta: { title: '现场基准配置', workflowMode: 'site-baseline-config' }
	},
	{
		path: '/map',
		component: () => import( '@/views/MapView.vue' ),
		meta: { title: '地图', tab: 2 }
	},
	{
		path: '/map-full',
		component: () => import( '@/views/MapFull.vue' ),
		meta: { title: '全屏地图' }
	},
	{
		path: '/records',
		component: () => import( '@/views/Records.vue' ),
		meta: { title: '记录', tab: 3 }
	},
	{
		path: '/records/patrol',
		component: () => import( '@/views/PatrolRecords.vue' ),
		meta: { title: '巡查记录' }
	},
	{
		path: '/records/history',
		component: () => import( '@/views/HistoryRisks.vue' ),
		meta: { title: '历史险情' }
	},
	{
		path: '/profile',
		component: () => import( '@/views/Profile.vue' ),
		meta: { title: '我的', tab: 4 }
	},
	{
		path: '/patrol',
		component: () => import( '@/views/Patrol.vue' ),
		meta: { title: '巡查任务' }
	},
	{
		path: '/patrol/:id',
		component: () => import( '@/views/PatrolDetail.vue' ),
		meta: { title: '巡检详情' },
		props: true
	},
	{
		path: '/risks',
		component: () => import( '@/views/AllRisks.vue' ),
		meta: { title: '全部风险' }
	},
	{
		path: '/monitor/stations',
		component: () => import( '@/views/MonitorStations.vue' ),
		meta: { title: '监测点位' }
	},
	{
		path: '/shift',
		component: () => import( '@/views/ShiftHandover.vue' ),
		meta: { title: '交接班' }
	},
	{
		path: '/supplies',
		component: () => import( '@/views/Supplies.vue' ),
		meta: { title: '应急物资' }
	},
	{
		path: '/progress',
		component: () => import( '@/views/ProgressDetail.vue' ),
		meta: { title: '进度详情' }
	},
	{
		path: '/reminders',
		component: () => import( '@/views/AllReminders.vue' ),
		meta: { title: '全部提醒' }
	},
	{
		path: '/monitor',
		component: () => import( '@/views/RiskMonitor.vue' ),
		meta: { title: '风险监测' }
	},
	{
		path: '/report',
		component: () => import( '@/views/Report.vue' ),
		meta: { title: '统计分析' }
	},
	{
		path: '/risk-report',
		component: () => import( '@/views/RiskReport.vue' ),
		meta: { title: '险情上报' }
	}
];

const router = createRouter( {
	history: createWebHashHistory(),
	routes
} );

router.beforeEach( ( to ) => {
	document.title = ( to.meta.title as string ) || '堤防 AR';
} );

export default router;
