import * as THREE from 'three';
import {
	STATIC_LAYER_NAMES
} from '@/models/catalog/model-api.js';
import type {
	ArDisplayMode,
	RegistrationStore,
	RegistrationStoreState
} from '@/localization/core/registration-store.js';
import { preserveRootTransform, type DisplayModeController } from '@/engine/core/display-mode.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { LayerVisibilityController } from '@/engine/visualization/layer-visibility.js';
import type { ArXrayVisualizationController } from '@/engine/visualization/ar-xray-visualization.js';
import type { ArLayerPeelingController } from '@/engine/visualization/ar-layer-peeling.js';
import type { ArSectionCutController } from '@/engine/visualization/ar-section-cut.js';

interface VisualizationStateRuntimeOptions {
	store: RegistrationStore;
	placementSession: PlacementSession;
	layerVisibility: LayerVisibilityController;
	displayModeController: DisplayModeController;
	structureRevealController: ArXrayVisualizationController;
	layerPeelingController: ArLayerPeelingController;
	sectionCutController: ArSectionCutController;
	getUndergroundModelRoot(): THREE.Object3D | null;
	syncAttachmentInfoBoardVisibility(): void;
}

export class VisualizationStateRuntime {

	private lastSyncedDisplayMode: ArDisplayMode | null = null;
	private lastSyncedDisplayModeRoot: THREE.Group | null = null;
	private lastVisualizationSignature = '';

	constructor(private readonly options: VisualizationStateRuntimeOptions) {}

	reset(): void {

		this.restoreVisualizationControllers();
		this.lastSyncedDisplayMode = null;
		this.lastSyncedDisplayModeRoot = null;
		this.lastVisualizationSignature = '';

	}

	syncDisplayModeState(): void {

		const currentMode = this.options.store.getState().displayMode;
		const placedModel = this.options.placementSession.getPlacedModel();
		if ( this.lastSyncedDisplayMode === currentMode && this.lastSyncedDisplayModeRoot === placedModel ) {
			return;
		}

		this.lastSyncedDisplayMode = currentMode;
		this.lastSyncedDisplayModeRoot = placedModel;
		if ( placedModel === null ) {
			this.options.displayModeController.sync( currentMode );
			return;
		}

		preserveRootTransform( placedModel, () => {
			this.options.displayModeController.sync( currentMode );
		} );

	}

	syncVisualizationState(): void {

		const state = this.options.store.getState();
		const modelRoot = state.appMode === 'ar-session'
			? this.options.placementSession.getArPlacedModel()
			: null;
		const undergroundRoot = state.appMode === 'ar-session'
			? this.options.getUndergroundModelRoot()
			: null;
		const currentValue = getDisplayModeSliderValue( state );
		const signature = [
			state.appMode,
			state.displayMode,
			currentValue,
			state.sectionCutPlaneMode,
			modelRoot?.uuid ?? 'none',
			state.modelLayers.map( ( layer ) => `${layer.id}:${layer.visible ? '1' : '0'}` ).join( '|' )
		].join( '::' );
		if ( signature === this.lastVisualizationSignature ) {
			return;
		}

		this.lastVisualizationSignature = signature;
		this.restoreVisualizationControllers( state.displayMode );

		switch ( state.displayMode ) {
			case 'transparent-xray': {
				const report = this.options.structureRevealController.apply( {
					modelRoot: undergroundRoot,
					value: state.transparentXrayValue,
					modelLayers: state.modelLayers
				} );
				console.info( '[LayerXray]', {
					value: report.value,
					opacityMode: report.opacityMode,
					totalLayerCount: report.totalLayerCount,
					affectedMeshCount: report.affectedMeshCount,
					affectedMaterialCount: report.affectedMaterialCount,
					hasModelRoot: report.hasModelRoot
				} );
				if ( report.opacityMode === 'layered' ) {
					for ( const layerReport of report.layerReports ) {
						console.info( '[LayerXrayLayer]', {
							layerId: layerReport.layerId,
							layerIndex: layerReport.layerIndex,
							layerName: layerReport.layerName,
							opacity: layerReport.opacity,
							visible: layerReport.visible
						} );
					}
				}
				break;
			}
			case 'layer-peeling': {
				const report = this.options.layerPeelingController.apply( state.layerPeelingValue, state.modelLayers );
				console.info( '[LayerPeeling]', {
					value: report.value,
					totalLayerCount: report.totalLayerCount,
					hiddenLayerCount: report.hiddenLayerCount,
					visibleLayerCount: report.visibleLayerCount,
					hiddenLayerIds: report.hiddenLayerIds,
					visibleLayerIds: report.visibleLayerIds
				} );
				break;
			}
			case 'section-cut': {
				this.options.sectionCutController.setPlaneMode( state.sectionCutPlaneMode );
				const report = this.options.sectionCutController.apply( modelRoot, state.sectionCutValue );
				console.info( '[SectionCut]', {
					value: report.value,
					planeMode: report.planeMode,
					axis: report.axis,
					axisMin: report.axisMin,
					axisMax: report.axisMax,
					cutPosition: report.cutPosition,
					meaning: report.meaning,
					affectedMeshCount: report.affectedMeshCount,
					affectedMaterialCount: report.affectedMaterialCount
				} );
				break;
			}
			default:
				break;
		}

	}

	applyModelLayerVisibility(): void {

		this.options.layerVisibility.applyToRoot( this.options.placementSession.getArPlacedModel() );
		this.options.syncAttachmentInfoBoardVisibility();
		this.options.displayModeController.captureMaterialBaseline();
		this.options.structureRevealController.captureVisibilityBaseline( this.options.placementSession.getArPlacedModel() );
		this.lastSyncedDisplayMode = null;
		this.lastSyncedDisplayModeRoot = null;
		const modelLayers = this.options.layerVisibility.getState();
		this.options.store.patch( {
			layerNames: modelLayers.length > 0
				? modelLayers.map( ( layer ) => layer.label )
				: STATIC_LAYER_NAMES,
			modelLayers
		} );
		this.syncDisplayModeState();
		this.syncVisualizationState();

	}

	restoreVisualizationControllers(activeMode?: ArDisplayMode): void {

		if ( activeMode !== 'transparent-xray' ) {
			this.options.structureRevealController.restore();
		}
		if ( activeMode !== 'layer-peeling' ) {
			this.options.layerPeelingController.restore();
		}
		if ( activeMode !== 'section-cut' ) {
			this.options.sectionCutController.restore();
		}

	}

}

function getDisplayModeSliderValue(
	state: RegistrationStoreState,
	mode: ArDisplayMode = state.displayMode
): number {

	switch ( mode ) {
		case 'transparent-xray':
			return state.transparentXrayValue;
		case 'layer-peeling':
			return state.layerPeelingValue;
		case 'section-cut':
			return state.sectionCutValue;
		default:
			return 0;
	}

}
