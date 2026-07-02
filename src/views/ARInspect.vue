<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabBar from '../components/AppTabBar.vue';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS,
	getDisplayModeLabel
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';

const TEXT = {
	title: '堤防 AR 巡查',
	subtitle: '进入 AR 后可手动校准并填写巡查记录。',
	enterArTitle: '进入 AR 巡查',
	enterArSub: '当前模型选择仅用于调试，后续可由入口默认带入。',
	enterAr: '进入 AR',
	selectModel: '选择模型',
	status: '状态',
	viewMode: '查看模式',
	manualCalibration: '手动校准',
	inspectionRecord: '巡查记录',
	expandPanel: '展开面板',
	collapsePanel: '收起面板',
	browseMode: '查看模式',
	inspectionMode: '巡查记录',
	sectionPlane: '剖切方向',
	startCalibration: '开始校准',
	captureCorner: '采集角点',
	solveApply: '完成校准',
	resetCalibration: '重置校准',
	inspectionResult: '结果',
	inspectionType: '类型',
	inspectionSeverity: '等级',
	inspectionNote: '备注',
	saveInspection: '保存记录',
	exportRecords: '导出记录',
	takeSnapshot: '截屏',
	exit: '退出',
	calibrationTool: '校准',
	unknownModel: '未选择模型'
} as const;

const route = useRoute();
const router = useRouter();
const store = useArShellStore();

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );

const engine = computed( () => store.engine );
const ui = computed( () => store.ui );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const currentModelName = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )?.name ?? TEXT.unknownModel
);
const sliderVisible = computed(
	() => engine.value.displayMode === 'transparent-xray'
		|| engine.value.displayMode === 'layer-peeling'
		|| engine.value.displayMode === 'section-cut'
);
const sliderValue = computed<number>( {
	get() {
		switch ( engine.value.displayMode ) {
			case 'transparent-xray':
				return engine.value.transparentXrayValue;
			case 'layer-peeling':
				return engine.value.layerPeelingValue;
			case 'section-cut':
				return engine.value.sectionCutValue;
			default:
				return 0;
		}
	},
	set(value: number) {
		store.actions.setStructureRevealValue( value );
	}
} );

async function mountEngineHosts(): Promise<void> {
	await store.initialize();
	store.actions.setWorkflowMode( 'ar-inspection' );
	if ( typeof route.query.siteId === 'string' && route.query.siteId.length > 0 ) {
		store.actions.selectModel( route.query.siteId );
	}
	await nextTick();
	if ( canvasHost.value === null || xrButtonHost.value === null ) {
		return;
	}

	store.mountHosts( {
		canvasHost: canvasHost.value,
		xrButtonHost: xrButtonHost.value
	} );
}

async function startArSession(): Promise<void> {
	await mountEngineHosts();
	await nextTick();
	store.actions.setWorkflowMode( 'ar-inspection' );
	store.actions.enterAr();
}

function handleModelChange(event: Event): void {
	const target = event.target as HTMLSelectElement;
	store.actions.selectModel( target.value );
}

function togglePanel(): void {
	if ( ui.value.drawerOpen ) {
		store.actions.toggleDrawer();
		return;
	}

	store.actions.activatePanel( 'browse' );
}

function activateWorkspace(mode: 'browse' | 'inspection'): void {
	store.actions.activatePanel( mode );
}

function openCalibrationPanel(): void {
	store.actions.activatePanel( 'browse' );
}

function exitPage(): void {
	if ( hasArSession.value ) {
		store.actions.exitAr();
	}
	void router.push( '/' );
}

onMounted( () => {
	void mountEngineHosts();
	store.actions.setWorkflowMode( 'ar-inspection' );
	store.actions.activatePanel( 'browse' );
} );
</script>

<template>
	<div class="inspect-page" @click="store.actions.handleArUiInteraction()">
		<div class="page-scroll">
			<header class="page-header">
				<div class="page-title">{{ TEXT.title }}</div>
				<div class="page-subtitle">{{ TEXT.subtitle }}</div>
				<div class="status-chip">{{ TEXT.status }}：{{ engine.runtimeStatus }}</div>
			</header>

			<section class="scene-shell">
				<div ref="canvasHost" class="scene-layer"></div>
				<div ref="xrButtonHost" class="scene-hidden"></div>

				<div v-if="!hasArSession" class="launch-overlay">
					<div class="launch-badge">AR</div>
					<div class="launch-title">{{ TEXT.enterArTitle }}</div>
					<p class="launch-subtitle">{{ TEXT.enterArSub }}</p>
					<label class="model-field">
						<span>{{ TEXT.selectModel }}</span>
						<select class="select-field" :value="engine.selectedModelId" @change="handleModelChange">
							<option v-for="model in engine.availableModels" :key="model.id" :value="model.id">
								{{ model.name }}
							</option>
						</select>
					</label>
					<button type="button" class="launch-button" @click.stop="startArSession">
						{{ TEXT.enterAr }}
					</button>
				</div>
			</section>

			<div v-if="sliderVisible" class="side-slider">
				<input v-model="sliderValue" class="side-slider-range" type="range" min="0" max="100" step="1" />
			</div>

			<button type="button" class="panel-toggle" @click.stop="togglePanel">
				{{ ui.drawerOpen ? TEXT.collapsePanel : TEXT.expandPanel }}
			</button>
		</div>

		<div class="floating-tools">
			<button type="button" class="tool-button" @click.stop="openCalibrationPanel">
				<span class="tool-icon">校</span>
				<span class="tool-text">{{ TEXT.calibrationTool }}</span>
			</button>
			<button type="button" class="tool-button" @click.stop="store.actions.takeSnapshot()">
				<span class="tool-icon">拍</span>
				<span class="tool-text">{{ TEXT.takeSnapshot }}</span>
			</button>
			<button type="button" class="tool-button tool-primary" @click.stop="store.actions.activatePanel('inspection')">
				<span class="tool-icon">记</span>
				<span class="tool-text">{{ TEXT.inspectionRecord }}</span>
			</button>
			<button type="button" class="tool-button" @click.stop="exitPage">
				<span class="tool-icon">退</span>
				<span class="tool-text">{{ TEXT.exit }}</span>
			</button>
		</div>

		<transition name="sheet-fade">
			<section v-if="ui.drawerOpen" class="bottom-sheet">
				<div class="sheet-header">
					<div class="sheet-tabs">
						<button
							type="button"
							class="sheet-tab"
							:class="{ active: engine.workspaceMode === 'browse' }"
							@click="activateWorkspace('browse')"
						>
							{{ TEXT.browseMode }}
						</button>
						<button
							type="button"
							class="sheet-tab"
							:class="{ active: engine.workspaceMode === 'inspection' }"
							@click="activateWorkspace('inspection')"
						>
							{{ TEXT.inspectionMode }}
						</button>
					</div>
					<button type="button" class="sheet-close" @click="store.actions.toggleDrawer()">
						{{ TEXT.collapsePanel }}
					</button>
				</div>

				<template v-if="engine.workspaceMode === 'browse'">
					<div class="sheet-section">
						<div class="section-label">{{ TEXT.viewMode }}</div>
						<div class="chip-grid">
							<button
								v-for="item in DISPLAY_MODE_OPTIONS"
								:key="item.value"
								type="button"
								class="chip-button"
								:class="{ active: engine.displayMode === item.value }"
								@click="store.actions.setDisplayMode(item.value)"
							>
								{{ item.label }}
							</button>
						</div>
					</div>

					<div v-if="engine.displayMode === 'section-cut'" class="sheet-section">
						<div class="section-label">{{ TEXT.sectionPlane }}</div>
						<div class="chip-grid">
							<button
								v-for="item in SECTION_CUT_PLANE_MODE_OPTIONS"
								:key="item.value"
								type="button"
								class="chip-button"
								:class="{ active: engine.sectionCutPlaneMode === item.value }"
								@click="store.actions.setSectionCutPlaneMode(item.value)"
							>
								{{ item.label }}
							</button>
						</div>
					</div>

					<div class="sheet-section">
						<div class="section-label">{{ TEXT.manualCalibration }}</div>
						<div class="chip-grid">
							<button type="button" class="chip-button" @click="store.actions.startCurrentSessionMarkerCalibration()">
								{{ TEXT.startCalibration }}
							</button>
							<button type="button" class="chip-button" @click="store.actions.captureCurrentSessionMarkerCorner()">
								{{ TEXT.captureCorner }}
							</button>
							<button type="button" class="chip-button active" @click="store.actions.solveAndApplyCurrentSessionMarkerCalibration()">
								{{ TEXT.solveApply }}
							</button>
							<button type="button" class="chip-button" @click="store.actions.resetCurrentSessionMarkerCalibration()">
								{{ TEXT.resetCalibration }}
							</button>
						</div>
					</div>
				</template>

				<template v-else>
					<div class="sheet-section">
						<div class="section-label">{{ TEXT.inspectionRecord }}</div>
						<div class="form-grid">
							<label class="field">
								<span>{{ TEXT.inspectionResult }}</span>
								<input
									:value="ui.inspectionDraft.result"
									type="text"
									@input="store.actions.updateInspectionDraft({ result: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field">
								<span>{{ TEXT.inspectionType }}</span>
								<input
									:value="ui.inspectionDraft.type"
									type="text"
									@input="store.actions.updateInspectionDraft({ type: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field">
								<span>{{ TEXT.inspectionSeverity }}</span>
								<input
									:value="ui.inspectionDraft.severity"
									type="text"
									@input="store.actions.updateInspectionDraft({ severity: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field full">
								<span>{{ TEXT.inspectionNote }}</span>
								<textarea
									rows="4"
									:value="ui.inspectionDraft.note"
									@input="store.actions.updateInspectionDraft({ note: ($event.target as HTMLTextAreaElement).value })"
								></textarea>
							</label>
						</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="store.actions.saveInspectionRecord()">
								{{ TEXT.saveInspection }}
							</button>
							<button type="button" class="action-button" @click="store.actions.exportInspectionRecords()">
								{{ TEXT.exportRecords }}
							</button>
						</div>
					</div>
				</template>
			</section>
		</transition>

		<AppTabBar />
	</div>
</template>

<style scoped>
.inspect-page {
	min-height: 100vh;
	background: linear-gradient(180deg, #07101b 0%, #0b1625 100%);
	color: #eff6ff;
}

.page-scroll {
	padding: max(16px, env(safe-area-inset-top)) 16px calc(120px + env(safe-area-inset-bottom));
}

.page-header {
	display: grid;
	gap: 8px;
}

.page-title {
	font-size: 24px;
	font-weight: 700;
}

.page-subtitle {
	font-size: 13px;
	line-height: 1.6;
	color: rgba(210, 225, 255, 0.72);
}

.status-chip {
	display: inline-flex;
	align-items: center;
	max-width: 100%;
	padding: 8px 12px;
	border-radius: 999px;
	border: 1px solid rgba(69, 208, 255, 0.24);
	background: rgba(0, 212, 255, 0.08);
	font-size: 12px;
	color: #bff3ff;
}

.scene-shell {
	position: relative;
	height: min(52vh, 500px);
	margin-top: 18px;
	border-radius: 24px;
	overflow: hidden;
	border: 1px solid rgba(69, 208, 255, 0.18);
	background: rgba(8, 14, 24, 0.86);
}

.scene-layer,
.scene-ar {
	position: absolute;
	inset: 0;
}

.scene-hidden {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
	pointer-events: none;
}

.launch-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 24px;
	background: linear-gradient(180deg, rgba(8, 13, 24, 0.78), rgba(8, 13, 24, 0.56));
	backdrop-filter: blur(10px);
	text-align: center;
	z-index: 5;
}

.launch-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 72px;
	height: 72px;
	border-radius: 22px;
	background: linear-gradient(180deg, #17c8ff, #1594ff);
	font-size: 32px;
	font-weight: 800;
}

.launch-title {
	margin-top: 16px;
	font-size: 28px;
	font-weight: 700;
}

.launch-subtitle {
	margin: 10px 0 0;
	max-width: 360px;
	font-size: 13px;
	line-height: 1.6;
	color: rgba(220, 234, 255, 0.76);
}

.model-field {
	display: grid;
	gap: 8px;
	width: min(320px, 100%);
	margin-top: 18px;
	text-align: left;
}

.model-field span {
	font-size: 12px;
	color: rgba(210, 225, 255, 0.72);
}

.select-field {
	width: 100%;
	padding: 12px 14px;
	border-radius: 14px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	background: rgba(255, 255, 255, 0.06);
	color: #eff6ff;
}

.launch-button,
.panel-toggle,
.tool-button,
.sheet-tab,
.sheet-close,
.chip-button,
.action-button {
	border: 0;
}

.launch-button {
	margin-top: 18px;
	padding: 12px 22px;
	border-radius: 999px;
	background: #11c9ff;
	color: #031019;
	font-size: 14px;
	font-weight: 700;
}

.panel-toggle {
	display: block;
	margin: 16px auto 0;
	padding: 12px 22px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.94);
	color: #2257d1;
	font-size: 14px;
	font-weight: 700;
}

.side-slider {
	position: fixed;
	right: 6px;
	top: 50%;
	transform: translateY(-50%);
	z-index: 28;
	pointer-events: none;
}

.side-slider-range {
	width: 176px;
	height: 22px;
	margin: 0;
	transform: rotate(-90deg);
	transform-origin: center;
	accent-color: #00d4ff;
	pointer-events: auto;
}

.floating-tools {
	position: fixed;
	right: 12px;
	bottom: calc(112px + env(safe-area-inset-bottom));
	z-index: 26;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.tool-button {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 54px;
	padding: 8px 6px;
	border-radius: 16px;
	background: rgba(12, 18, 30, 0.82);
	color: #fff;
	backdrop-filter: blur(14px);
	border: 1px solid rgba(255, 255, 255, 0.08);
}

.tool-button.tool-primary {
	background: linear-gradient(180deg, #1b7dff, #0fc3ff);
}

.tool-icon {
	font-size: 16px;
	font-weight: 700;
	line-height: 1;
}

.tool-text {
	margin-top: 4px;
	font-size: 10px;
}

.bottom-sheet {
	position: fixed;
	left: 12px;
	right: 12px;
	bottom: calc(82px + env(safe-area-inset-bottom));
	z-index: 32;
	max-height: 52vh;
	padding: 14px;
	overflow-y: auto;
	border-radius: 24px;
	background: rgba(10, 16, 28, 0.94);
	backdrop-filter: blur(22px);
	border: 1px solid rgba(255, 255, 255, 0.08);
	box-shadow: 0 20px 40px rgba(0, 0, 0, 0.28);
}

.sheet-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 10px;
}

.sheet-tabs {
	display: flex;
	gap: 8px;
}

.sheet-tab,
.sheet-close,
.chip-button,
.action-button {
	padding: 10px 14px;
	border-radius: 14px;
	background: rgba(255, 255, 255, 0.04);
	color: rgba(225, 236, 255, 0.74);
	font-size: 12px;
	border: 1px solid rgba(255, 255, 255, 0.08);
}

.sheet-tab.active,
.chip-button.active,
.action-button.primary {
	background: rgba(0, 212, 255, 0.16);
	border-color: rgba(0, 212, 255, 0.34);
	color: #fff;
}

.sheet-section + .sheet-section {
	margin-top: 14px;
	padding-top: 14px;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.section-label {
	font-size: 12px;
	font-weight: 600;
	color: rgba(226, 236, 255, 0.88);
}

.chip-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 10px;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
	margin-top: 10px;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.field.full {
	grid-column: 1 / -1;
}

.field span {
	font-size: 11px;
	color: rgba(210, 225, 255, 0.66);
}

.field input,
.field textarea {
	width: 100%;
	padding: 11px 12px;
	border-radius: 14px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	background: rgba(255, 255, 255, 0.04);
	color: #eff6ff;
}

.action-row {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 14px;
}

.sheet-fade-enter-active,
.sheet-fade-leave-active {
	transition: opacity 0.22s ease, transform 0.22s ease;
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
	opacity: 0;
	transform: translateY(10px);
}

@media (max-width: 420px) {
	.page-title {
		font-size: 21px;
	}

	.launch-title {
		font-size: 22px;
	}

	.form-grid {
		grid-template-columns: 1fr;
	}

	.side-slider-range {
		width: 152px;
	}
}
</style>
