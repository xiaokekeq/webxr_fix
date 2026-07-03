<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import ArPlacementStatusSection from '@/components/ar/ArPlacementStatusSection.vue';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS,
	getDisplayModeSliderValueText
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';

const PLACEMENT_STATUS_TITLE = '放置方式';

const TEXT = {
	title: '堤防 AR 巡查',
	enterArTitle: '进入 AR 巡查',
	enterArSub: '进入后先扫描平面，再对准现场控制标志完成空间校正。',
	enterAr: '进入 AR',
	selectModel: '选择模型',
	status: '状态',
	waiting: '待进入 AR',
	scanning: '正在识别平面',
	ready: '平面已就绪',
	placing: '正在应用空间校正',
	placed: '巡查中',
	viewMode: '模型显示',
	calibrationPanel: '空间校正',
	inspectionRecord: '巡查记录',
	collapsePanel: '收起面板',
	browseMode: '显示控制',
	inspectionMode: '巡查记录',
	sectionPlane: '剖切方向',
	calibrationHint: '请先扫描平面，然后对准现场控制标志；若自动识别不可用，可切换到手动四角点校正。',
	startCalibration: '开始控制标志校正',
	captureCorner: '记录当前角点',
	applyCalibration: '应用空间校正',
	resetCalibration: '重置角点',
	cornerProgress: '角点进度',
	nextCorner: '待记录角点',
	inspectionResult: '结果',
	inspectionType: '类型',
	inspectionSeverity: '等级',
	inspectionNote: '备注',
	saveInspection: '保存巡查记录',
	exportRecords: '导出巡查记录',
	takeSnapshot: '截取画面',
	exit: '退出 AR',
	panelTool: '控制面板',
	unknownModel: '未选择模型'
} as const;

const INSPECTION_PLACEMENT_SOURCE_OPTIONS = [
	{ value: 'marker-auto', label: 'Marker 自动识别' },
	{ value: 'gps-bias', label: 'GPS / 粗配准' },
	{ value: 'plane-hit-test', label: '当前平面临放' }
] as const;

const route = useRoute();
const router = useRouter();
const store = useArShellStore();

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );

const engine = computed( () => store.engine );
const ui = computed( () => store.ui );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const sliderVisible = computed(
	() => hasArSession.value
		&& (
			engine.value.displayMode === 'transparent-xray'
			|| engine.value.displayMode === 'layer-peeling'
			|| engine.value.displayMode === 'section-cut'
		)
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
const sliderText = computed( () =>
	getDisplayModeSliderValueText( engine.value.displayMode, sliderValue.value )
);
const sessionStatusText = computed( () => {
	if ( hasArSession.value === false ) {
		return TEXT.waiting;
	}

	switch ( engine.value.arSessionPhase ) {
		case 'scanning':
			return TEXT.scanning;
		case 'ready-to-place':
			return TEXT.ready;
		case 'placing':
			return TEXT.placing;
		case 'placed':
			return TEXT.placed;
		default:
			return engine.value.runtimeStatus;
	}
} );
const calibrationProgressText = computed(
	() => `${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}`
);
const calibrationStatusCards = computed( () => [
	{ label: TEXT.cornerProgress, value: calibrationProgressText.value },
	{ label: TEXT.nextCorner, value: engine.value.markerCalibration.nextCornerLabel || '-' }
] );
const calibrationActionHint = computed( () => {
	if ( hasArSession.value === false ) {
		return '进入 AR 后先扫描平面，再开始控制标志校正。';
	}

	if ( engine.value.markerCalibration.active ) {
		return engine.value.runtimeStatus;
	}

	if ( engine.value.arSessionPhase === 'scanning' ) {
		return '请先缓慢移动手机扫描地面或控制标志所在平面。';
	}

	return engine.value.runtimeStatus;
} );
const isMarkerPlacementSelected = computed( () => engine.value.inspectionPlacementSource === 'marker-auto' );
const showManualMarkerControls = computed(
	() => isMarkerPlacementSelected.value && engine.value.markerCalibration.active
);
const inspectionPlacementHint = computed( () => {
	switch ( engine.value.inspectionPlacementSource ) {
		case 'marker-auto':
			return showManualMarkerControls.value
				? '当前已切到手动四角点校正，请按顺序记录四个角点后应用。'
				: '当前使用隐藏式 Marker 自动识别。请先扫描平面，再让控制标志进入视野，识别稳定后会自动放置模型。';
		case 'gps-bias':
			return '当前使用 GPS / 粗配准固定放置。扫描到平面后会自动尝试放置模型。';
		case 'plane-hit-test':
			return '当前使用平面临时放置。扫描到平面后会按当前识别平面自动临放模型。';
		default:
			return engine.value.runtimeStatus;
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

function activateWorkspace(mode: 'browse' | 'inspection'): void {
	store.actions.activatePanel( mode );
}

function openWorkspacePanel(): void {
	if ( ui.value.drawerOpen ) {
		store.actions.toggleDrawer();
		return;
	}

	store.actions.activatePanel( engine.value.workspaceMode === 'inspection' ? 'inspection' : 'browse' );
}

function startMarkerCalibration(): void {
	store.actions.startCurrentSessionMarkerCalibration();
}

function captureMarkerCorner(): void {
	store.actions.captureCurrentSessionMarkerCorner();
}

function applyMarkerCalibration(): void {
	store.actions.solveAndApplyCurrentSessionMarkerCalibration();
}

function resetMarkerCalibration(): void {
	store.actions.resetCurrentSessionMarkerCalibration();
}

function handleInspectionPlacementSourceChange(
	source: 'marker-auto' | 'gps-bias' | 'plane-hit-test'
): void {
	store.actions.setInspectionPlacementSource( source );
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
} );
</script>

<template>
	<div class="inspect-page" :class="{ 'ar-active': hasArSession }" @click="store.actions.handleArUiInteraction()">
		<div class="page-scroll">
			<header class="page-header" @pointerdown.stop="store.actions.handleArUiInteraction()" @click.stop>
				<div class="page-title">{{ TEXT.title }}</div>
				<div class="status-chip">{{ TEXT.status }}：{{ sessionStatusText }}</div>
			</header>

			<section class="scene-shell">
				<div ref="canvasHost" class="scene-layer"></div>
				<div ref="xrButtonHost" class="scene-hidden"></div>

				<div
					v-if="!hasArSession"
					class="launch-overlay"
					@pointerdown.stop="store.actions.handleArUiInteraction()"
					@click.stop
				>
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
				<div class="side-slider-text">{{ sliderText }}</div>
				<input
					v-model="sliderValue"
					class="side-slider-range"
					type="range"
					min="0"
					max="100"
					step="1"
					@pointerdown.stop="store.actions.handleArUiInteraction()"
					@click.stop
				/>
			</div>
		</div>

		<nav class="action-dock action-dock-compact" aria-label="AR 操作" @pointerdown.stop="store.actions.handleArUiInteraction()" @click.stop>
			<button type="button" class="dock-item dock-item-primary" @click.stop="openWorkspacePanel">
				<span class="dock-icon">板</span>
				<span class="dock-label">{{ TEXT.panelTool }}</span>
			</button>
			<button type="button" class="dock-item" @click.stop="store.actions.takeSnapshot()">
				<span class="dock-icon">拍</span>
				<span class="dock-label">{{ TEXT.takeSnapshot }}</span>
			</button>
			<button type="button" class="dock-item" @click.stop="exitPage">
				<span class="dock-icon">退</span>
				<span class="dock-label">{{ TEXT.exit }}</span>
			</button>
		</nav>

		<transition name="sheet-fade">
			<section
				v-if="ui.drawerOpen"
				class="bottom-sheet"
				@pointerdown.stop="store.actions.handleArUiInteraction()"
				@click.stop
			>
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

				<ArPlacementStatusSection :state="engine" :title="PLACEMENT_STATUS_TITLE" first />

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
				</template>

				<template v-else>
					<div class="sheet-section">
						<div class="section-label">放置来源</div>
						<div class="chip-grid">
							<button
								v-for="item in INSPECTION_PLACEMENT_SOURCE_OPTIONS"
								:key="item.value"
								type="button"
								class="chip-button"
								:class="{ active: engine.inspectionPlacementSource === item.value }"
								@click="handleInspectionPlacementSourceChange(item.value)"
							>
								{{ item.label }}
							</button>
						</div>
						<div class="runtime-banner">{{ inspectionPlacementHint }}</div>
					</div>

					<ArPanelSection :title="TEXT.calibrationPanel">
						<ArInfoGrid :items="calibrationStatusCards" class="compact-info-grid" />
						<div class="runtime-banner">{{ calibrationActionHint }}</div>
						<div v-if="showManualMarkerControls" class="action-row">
							<button type="button" class="action-button" @click="startMarkerCalibration()">
								{{ TEXT.startCalibration }}
							</button>
							<button type="button" class="action-button" @click="captureMarkerCorner()">
								{{ TEXT.captureCorner }}
							</button>
							<button type="button" class="action-button primary" @click="applyMarkerCalibration()">
								{{ TEXT.applyCalibration }}
							</button>
							<button type="button" class="action-button" @click="resetMarkerCalibration()">
								{{ TEXT.resetCalibration }}
							</button>
						</div>
						<div v-else-if="isMarkerPlacementSelected" class="action-row">
							<button type="button" class="action-button" @click="startMarkerCalibration()">
								切换为手动四角点
							</button>
							<button
								v-if="engine.markerCalibration.capturedCornerCount > 0 || engine.markerCalibration.active"
								type="button"
								class="action-button"
								@click="resetMarkerCalibration()"
							>
								重置手动角点
							</button>
						</div>
					</ArPanelSection>

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
	</div>
</template>

<style scoped>
.inspect-page {
	min-height: 100vh;
	background: linear-gradient(180deg, #07101b 0%, #0b1625 100%);
	color: #eff6ff;
}

.inspect-page.ar-active {
	background: transparent;
}

.page-scroll {
	position: relative;
	padding: max(16px, env(safe-area-inset-top)) 16px calc(110px + env(safe-area-inset-bottom));
}

.inspect-page.ar-active .page-scroll {
	padding: max(12px, env(safe-area-inset-top)) 12px calc(108px + env(safe-area-inset-bottom));
}

.page-header {
	position: relative;
	z-index: 22;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.page-title {
	font-size: 24px;
	font-weight: 700;
}

.status-chip {
	display: inline-flex;
	align-items: center;
	padding: 8px 12px;
	border-radius: 999px;
	border: 1px solid rgba(69, 208, 255, 0.24);
	background: rgba(0, 212, 255, 0.08);
	font-size: 12px;
	color: #bff3ff;
	backdrop-filter: blur(10px);
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

.inspect-page.ar-active .scene-shell {
	position: fixed;
	inset: 0;
	height: 100dvh;
	margin-top: 0;
	border: 0;
	border-radius: 0;
	background: transparent;
	z-index: 1;
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
.dock-item,
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

.side-slider {
	position: fixed;
	right: max(2px, calc(env(safe-area-inset-right) + 2px));
	top: 50%;
	transform: translateY(-50%);
	z-index: 34;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 14px;
	width: 54px;
	padding: 14px 8px 16px;
	border-radius: 24px 0 0 24px;
	background: linear-gradient(180deg, rgba(8, 15, 27, 0.76), rgba(8, 15, 27, 0.58));
	backdrop-filter: blur(18px) saturate(140%);
	-webkit-backdrop-filter: blur(18px) saturate(140%);
	border: 1px solid rgba(173, 232, 255, 0.14);
	border-right: 0;
	box-shadow:
		0 18px 36px rgba(0, 0, 0, 0.24),
		0 0 0 1px rgba(255, 255, 255, 0.04) inset,
		0 0 22px rgba(82, 208, 255, 0.14);
	pointer-events: none;
	overflow: hidden;
}

.side-slider-text {
	width: 100%;
	padding: 7px 8px;
	border-radius: 12px;
	background: rgba(0, 212, 255, 0.1);
	border: 1px solid rgba(173, 232, 255, 0.12);
	color: #d8f8ff;
	font-size: 11px;
	font-weight: 600;
	line-height: 1.2;
	text-align: center;
	word-break: break-word;
}

.side-slider-range {
	width: 188px;
	height: 22px;
	margin: 0;
	transform: rotate(-90deg);
	transform-origin: center;
	accent-color: #00d4ff;
	pointer-events: auto;
	filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.2));
}

.action-dock {
	position: fixed;
	left: 12px;
	right: 12px;
	bottom: calc(12px + env(safe-area-inset-bottom));
	z-index: 36;
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 10px;
	padding: 10px;
	border-radius: 22px;
	background: rgba(7, 12, 21, 0.88);
	backdrop-filter: blur(18px);
	border: 1px solid rgba(255, 255, 255, 0.08);
	box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
}

.action-dock-compact {
	grid-template-columns: repeat(3, minmax(0, 1fr));
}

.dock-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	min-height: 54px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.04);
	color: rgba(225, 236, 255, 0.78);
	border: 1px solid rgba(255, 255, 255, 0.06);
}

.dock-item-primary {
	background: rgba(0, 212, 255, 0.16);
	border-color: rgba(0, 212, 255, 0.32);
	color: #fff;
}

.dock-icon {
	font-size: 15px;
	font-weight: 700;
	line-height: 1;
}

.dock-label {
	font-size: 11px;
	line-height: 1;
}

.bottom-sheet {
	position: fixed;
	left: 12px;
	right: 12px;
	bottom: calc(96px + env(safe-area-inset-bottom));
	z-index: 38;
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

.info-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
}

.info-card {
	padding: 12px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.06);
}

.info-card span {
	display: block;
	font-size: 11px;
	color: rgba(210, 225, 255, 0.64);
}

.info-card strong {
	display: block;
	margin-top: 6px;
	font-size: 13px;
	font-weight: 600;
	word-break: break-word;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
	margin-top: 10px;
}

.compact-info-grid {
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

.runtime-banner {
	margin-top: 10px;
	padding: 10px 12px;
	border-radius: 14px;
	background: rgba(0, 212, 255, 0.08);
	border: 1px solid rgba(0, 212, 255, 0.18);
	font-size: 12px;
	color: #d5f7ff;
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
		width: 164px;
	}

	.side-slider {
		right: max(0px, env(safe-area-inset-right));
		width: 50px;
		padding: 12px 6px 14px;
	}

	.action-dock {
		gap: 8px;
		padding: 8px;
	}

	.bottom-sheet {
		bottom: calc(92px + env(safe-area-inset-bottom));
	}
}
</style>
