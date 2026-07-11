import * as THREE from 'three';
import {
	STATIC_LAYER_NAMES
} from '@/models/catalog/model-api.js';
import type { RegistrationStore } from '@/localization/core/registration-store.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { LayerVisibilityController } from '@/engine/visualization/layer-visibility.js';
import type { ArXrayVisualizationController } from '@/engine/visualization/ar-xray-visualization.js';
import type { ArLayerPeelingController } from '@/engine/visualization/ar-layer-peeling.js';
import type { ArSectionCutController } from '@/engine/visualization/ar-section-cut.js';

interface VisualizationStateRuntimeOptions {
	store: RegistrationStore;
	placementSession: PlacementSession;
	layerVisibility: LayerVisibilityController;
	structureRevealController: ArXrayVisualizationController;
	layerPeelingController: ArLayerPeelingController;
	sectionCutController: ArSectionCutController;
	getUndergroundModelRoot(): THREE.Object3D | null;
	syncAttachmentInfoBoardVisibility(): void;
}

export class VisualizationStateRuntime {

	private lastVisualizationSignature = '';

	constructor(private readonly options: VisualizationStateRuntimeOptions) {}

	reset(): void {

		this.restoreVisualizationControllers();
		this.lastVisualizationSignature = '';

	}

	syncVisualizationState(): void {

		const state = this.options.store.getState();
		const modelRoot = state.appMode === 'ar-session'
			? this.options.placementSession.getArPlacedModel()
			: null;
		const undergroundRoot = state.appMode === 'ar-session'
			? this.options.getUndergroundModelRoot()
			: null;
		const signature = [
			state.appMode,
			state.undergroundMaterialMode,
			state.transparentXrayValue,
			state.layerPeelingEnabled,
			state.layerPeelingValue,
			state.sectionCutEnabled,
			state.sectionCutValue,
			state.sectionCutPlaneMode,
			modelRoot?.uuid ?? 'none',
			state.modelLayers.map( ( layer ) => `${layer.id}:${layer.visible ? '1' : '0'}` ).join( '|' )
		].join( '::' );
		if ( signature === this.lastVisualizationSignature ) {
			return;
		}

		this.lastVisualizationSignature = signature;
		this.restoreVisualizationControllers();

		if ( state.undergroundMaterialMode === 'xray' ) {
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
		}
		if ( state.layerPeelingEnabled ) {
				const report = this.options.layerPeelingController.apply( state.layerPeelingValue, state.modelLayers );
				console.info( '[LayerPeeling]', {
					value: report.value,
					totalLayerCount: report.totalLayerCount,
					hiddenLayerCount: report.hiddenLayerCount,
					visibleLayerCount: report.visibleLayerCount,
					hiddenLayerIds: report.hiddenLayerIds,
					visibleLayerIds: report.visibleLayerIds
				} );
		}
		if ( state.sectionCutEnabled ) {
				this.options.sectionCutController.setPlaneMode( state.sectionCutPlaneMode );
				const report = this.options.sectionCutController.apply( undergroundRoot, state.sectionCutValue );
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
		}

	}

	applyModelLayerVisibility(): void {

		this.options.layerVisibility.applyToRoot( this.options.placementSession.getArPlacedModel() );
		this.options.syncAttachmentInfoBoardVisibility();
		this.options.structureRevealController.captureVisibilityBaseline( this.options.placementSession.getArPlacedModel() );
		const modelLayers = this.options.layerVisibility.getState();
		this.options.store.patch( {
			layerNames: modelLayers.length > 0
				? modelLayers.map( ( layer ) => layer.label )
				: STATIC_LAYER_NAMES,
			modelLayers
		} );
		this.syncVisualizationState();

	}

	restoreVisualizationControllers(): void {

		this.options.structureRevealController.restore();
		this.options.layerPeelingController.restore();
		this.options.sectionCutController.restore();

	}

}
