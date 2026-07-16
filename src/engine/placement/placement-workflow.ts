import { arWarn } from '@/engine/debug/ar-logger.js';
import * as THREE from 'three';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ModelRuntimeLoadStatus } from '@/localization/core/registration-store.js';
import type { PlacementSession } from './session.js';

interface PlacementWorkflowOptions {
	placementSession: PlacementSession;
	getCurrentSessionId(): string | null;
	getPreferredLocalizationOverride(): ArFromEnuSolution | null;
	getModelTemplate(): THREE.Group | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getRuntimeLoadStatus(): ModelRuntimeLoadStatus;
	onBeforePlacementRequest(): void;
	applyModelLayerVisibility(): void;
	syncRegistrationChainDebug(): void;
	syncLocalizationDebug(): void;
	syncArSessionPhase(): void;
	emit(): void;
	setStatus(message: string): void;
	onPlacementCompleted(): void;
}

export class PlacementWorkflow {

	constructor(private readonly options: PlacementWorkflowOptions) {}

	async placeLocalizedModel(): Promise<void> {

		const modelTemplate = this.options.getModelTemplate();
		const registrationSolution = this.options.getRegistrationSolution();
		const localization = this.options.getPreferredLocalizationOverride();
		if ( modelTemplate === null || registrationSolution === null || localization === null ) {
			const runtime = this.options.getRuntimeLoadStatus();
			arWarn( '[EngineeringPlacementBlocked]', {
				hasModelTemplate: modelTemplate !== null,
				hasRegistrationSolution: registrationSolution !== null,
				hasLocalization: localization !== null,
				runtimeState: runtime.modelRuntimeLoadState,
				runtimeStage: runtime.modelRuntimeLoadStage,
				runtimeFailureReason: runtime.modelRuntimeLoadFailureReason
			} );
			this.options.setStatus(
				modelTemplate === null
					? '模型模板尚未加载完成。'
					: registrationSolution === null
						? '模型工程配准解尚未建立。'
						: '请先完成 Marker 四角点校正。'
			);
			return;
		}

		this.options.onBeforePlacementRequest();
		const hadPlacedModel = this.options.placementSession.getPlacedModel() !== null;
		const placed = this.options.placementSession.placeEngineeringModelFromCurrentArFromEnu( {
			modelTemplate,
			registrationSolution,
			arFromEnuSolution: localization,
			currentSessionId: this.options.getCurrentSessionId(),
			reason: hadPlacedModel ? 'marker-confirmed' : 'initial-placement',
			source: 'PlacementWorkflow.placeLocalizedModel()'
		} );
		if ( placed ) {
			this.options.applyModelLayerVisibility();
			this.options.syncRegistrationChainDebug();
			this.options.syncLocalizationDebug();
			if ( hadPlacedModel === false ) this.options.onPlacementCompleted();
			this.options.syncArSessionPhase();
			this.options.emit();
			return;
		}

		this.options.syncArSessionPhase();
		this.options.setStatus( '工程放置未完成，请重试。' );

	}

}
