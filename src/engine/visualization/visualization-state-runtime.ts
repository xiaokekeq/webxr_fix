import * as THREE from 'three';
import {
	STATIC_LAYER_NAMES
} from '@/models/catalog/model-api.js';
import type { RegistrationStore } from '@/localization/core/registration-store.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { LayerVisibilityController } from '@/engine/visualization/layer-visibility.js';
import { isArDebugEnabled } from '@/engine/debug/ar-logger.js';
import type { MaterialStateRuntime } from '@/engine/visualization/material-state-runtime.js';
import type { ArLayerPeelingController } from '@/engine/visualization/ar-layer-peeling.js';
import type { ArSectionCutController } from '@/engine/visualization/ar-section-cut.js';

interface VisualizationStateRuntimeOptions {
	store: RegistrationStore;
	placementSession: PlacementSession;
	layerVisibility: LayerVisibilityController;
	materialStateRuntime: MaterialStateRuntime;
	layerPeelingController: ArLayerPeelingController;
	sectionCutController: ArSectionCutController;
	getUndergroundModelRoot(): THREE.Object3D | null;
	syncAttachmentInfoBoardVisibility(): void;
}

export class VisualizationStateRuntime {

	private lastState: { root: THREE.Object3D | null; materialMode: string; opacity: number; layerEnabled: boolean; layerValue: number; sectionEnabled: boolean; sectionValue: number; sectionMode: string; layers: unknown } | null = null;

	constructor(private readonly options: VisualizationStateRuntimeOptions) {}

	reset(): void {

		this.restoreVisualizationControllers();
		this.lastState = null;

	}

	syncVisualizationState(): void {

		const state = this.options.store.getState();
		const modelRoot = state.appMode === 'ar-session'
			? this.options.placementSession.getArPlacedModel()
			: null;
		const undergroundRoot = state.appMode === 'ar-session'
			? this.options.getUndergroundModelRoot()
			: null;
		const previous = this.lastState;
		if ( previous?.root === undergroundRoot && previous.materialMode === state.undergroundMaterialMode && previous.opacity === state.transparentXrayValue && previous.layerEnabled === state.layerPeelingEnabled && previous.layerValue === state.layerPeelingValue && previous.sectionEnabled === state.sectionCutEnabled && previous.sectionValue === state.sectionCutValue && previous.sectionMode === state.sectionCutPlaneMode && previous.layers === state.modelLayers ) return;
		this.lastState = { root: undergroundRoot, materialMode: state.undergroundMaterialMode, opacity: state.transparentXrayValue, layerEnabled: state.layerPeelingEnabled, layerValue: state.layerPeelingValue, sectionEnabled: state.sectionCutEnabled, sectionValue: state.sectionCutValue, sectionMode: state.sectionCutPlaneMode, layers: state.modelLayers };

		let clippingPlane: THREE.Plane | null = null;
		this.options.sectionCutController.restore();
		if ( state.sectionCutEnabled ) {
			this.options.sectionCutController.setPlaneMode( state.sectionCutPlaneMode );
			clippingPlane = this.options.sectionCutController.apply( undergroundRoot, state.sectionCutValue ).plane;
		}
		this.options.materialStateRuntime.apply( undergroundRoot, { mode: state.undergroundMaterialMode, opacity: state.transparentXrayValue, clippingPlane } );
		if ( state.layerPeelingEnabled ) {
				const report = this.options.layerPeelingController.apply( state.layerPeelingValue, state.modelLayers );
				if ( isArDebugEnabled() ) console.info( '[LayerPeeling]', {
					value: report.value,
					totalLayerCount: report.totalLayerCount,
					hiddenLayerCount: report.hiddenLayerCount,
					visibleLayerCount: report.visibleLayerCount,
					hiddenLayerIds: report.hiddenLayerIds,
					visibleLayerIds: report.visibleLayerIds
				} );
		}

	}

	applyModelLayerVisibility(): void {

		this.options.layerVisibility.applyToRoot( this.options.placementSession.getArPlacedModel() );
		this.options.syncAttachmentInfoBoardVisibility();
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

		this.options.materialStateRuntime.restore();
		this.options.layerPeelingController.restore();
		this.options.sectionCutController.restore();

	}

}
