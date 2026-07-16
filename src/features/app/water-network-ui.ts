import content from '@/data/water-network-ui.json';

export interface WaterNetworkUiContent {
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
		task: PatrolTask;
		riskStats: RiskStats;
		todoItems: TodoItem[];
		quickMenus: QuickMenu[];
	};
	map: { title: string; zoom: number; legend: MapLegendItem[]; markers: MapMarker[]; route: [ number, number ][] };
	records: { title: string; items: RecordItem[] };
	profile: { title: string; avatar: string; name: string; role: string; items: ProfileItem[] };
}

export interface Checkpoint { id: string; name: string; lng: number; lat: number; checked: boolean; riskFlag?: string; note?: string; images?: string[]; }
export interface PatrolTask { id: string; title: string; section: string; patrolRange: string; patrolDistance: string; priority: string; planTime: string; team: string; teamCount: number; status: string; riskLevel: string; startTime: string; assignee?: string; checkpoints: Checkpoint[]; }
export interface TodoItem { id: string; content: string; type: string; done: boolean; }
export interface RiskStats { fixedPoints: number; pendingReview: number; monitorAlerts: number; historyRisks: number; }
export interface QuickMenu { icon: string; label: string; desc: string; path: string; }
export interface MapLegendItem { type: string; label: string; }
export interface MapMarker { id: string; lng: number; lat: number; type: 'checkpoint' | 'risk' | 'station' | 'patrol'; label: string; riskLevel?: string; }
export interface RecordItem { icon: string; label: string; count: string; path: string; }
export interface ProfileItem { icon: string; label: string; path?: string; }

export const waterNetworkUi = content as WaterNetworkUiContent;
