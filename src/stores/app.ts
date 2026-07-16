import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
	waterNetworkUi,
	type Checkpoint,
	type PatrolTask,
	type TodoItem,
	type WaterNetworkUiContent
} from '@/features/app/water-network-ui.js';

export type { Checkpoint, PatrolTask, TodoItem };
export type DamSection = WaterNetworkUiContent['sites'][ number ];

export interface RiskAlert {
	id: string;
	type: string;
	level: string;
	location: string;
	lng: number;
	lat: number;
	desc: string;
	time: string;
}

export const useAppStore = defineStore( 'app', () => {
	const uiContent = waterNetworkUi;
	const currentDam = ref<DamSection>( uiContent.sites[ 0 ] );
	const damSections = ref<DamSection[]>( uiContent.sites );
	const weather = ref( uiContent.weather );
	const waterLevel = ref( Number( uiContent.dashboard.pressure.value ) );
	const patrolTasks = ref<PatrolTask[]>( [ uiContent.dashboard.task ] );
	const riskAlerts = ref<RiskAlert[]>( [] );
	const todoItems = ref<TodoItem[]>( uiContent.dashboard.todoItems );
	const riskStats = ref( uiContent.dashboard.riskStats );

	const totalCheckpoints = computed( () => patrolTasks.value.reduce( ( total, task ) => total + task.checkpoints.length, 0 ) );
	const checkedCount = computed( () => patrolTasks.value.reduce( ( total, task ) => total + task.checkpoints.filter( ( checkpoint ) => checkpoint.checked ).length, 0 ) );
	const patrolProgress = computed( () => totalCheckpoints.value === 0 ? 0 : Math.round( checkedCount.value / totalCheckpoints.value * 100 ) );
	const undoneCount = computed( () => todoItems.value.filter( ( item ) => item.done === false ).length );
	const todayTask = computed( () => patrolTasks.value.find( ( task ) => task.status !== 'completed' ) ?? null );
	const estimatedCompleteTime = computed( () => todayTask.value?.planTime ?? '--' );
	const isWaterOverWarning = computed( () => false );

	function switchDam(site: DamSection): void {
		currentDam.value = site;
	}

	function setPatrolTasks(tasks: PatrolTask[]): void {
		patrolTasks.value = tasks;
	}

	function addRiskAlert(alert: RiskAlert): void {
		riskAlerts.value.push( alert );
	}

	function toggleTodo(id: string): void {
		const item = todoItems.value.find( ( candidate ) => candidate.id === id );
		if ( item !== undefined ) item.done = item.done === false;
	}

	function updateCheckpoint(taskId: string, checkpointId: string, data: Partial<Checkpoint>): void {
		const checkpoint = patrolTasks.value.find( ( task ) => task.id === taskId )?.checkpoints.find( ( item ) => item.id === checkpointId );
		if ( checkpoint !== undefined ) Object.assign( checkpoint, data );
	}

	return {
		uiContent,
		currentDam,
		damSections,
		weather,
		waterLevel,
		isWaterOverWarning,
		patrolTasks,
		riskAlerts,
		todoItems,
		riskStats,
		totalCheckpoints,
		checkedCount,
		patrolProgress,
		undoneCount,
		todayTask,
		estimatedCompleteTime,
		switchDam,
		setPatrolTasks,
		addRiskAlert,
		toggleTodo,
		updateCheckpoint
	};
} );
