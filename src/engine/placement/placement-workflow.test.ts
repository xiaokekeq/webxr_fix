import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import { PlacementWorkflow } from './placement-workflow.js';

describe( 'PlacementWorkflow guard feedback', () => {

	it.each( [
		[ null, null, null, '模型模板尚未加载完成。' ],
		[ new THREE.Group(), null, null, '模型工程配准解尚未建立。' ],
		[
			new THREE.Group(),
			{} as EngineeringRegistrationSolution,
			null,
			'请先完成 Marker 四角点校正。'
		]
	] )( 'reports the specific missing placement prerequisite', async ( model, registration, localization, expected ) => {

		const setStatus = vi.fn();
		const workflow = new PlacementWorkflow( createOptions( model, registration, localization, setStatus ) );

		await workflow.placeLocalizedModel();

		expect( setStatus ).toHaveBeenCalledWith( expected );

	} );

} );

function createOptions(
	model: THREE.Group | null,
	registration: EngineeringRegistrationSolution | null,
	localization: ArFromEnuSolution | null,
	setStatus: (message: string) => void
): ConstructorParameters<typeof PlacementWorkflow>[ 0 ] {

	return {
		placementSession: {} as never,
		getWorkflowMode: () => 'ar-inspection',
		getSiteId: () => null,
		getCurrentSessionId: () => null,
		getInspectionTargetId: () => null,
		getInspectionStableFrameCount: () => 0,
		getPreferredLocalizationOverride: () => localization,
		getModelTemplate: () => model,
		getRegistrationSolution: () => registration,
		getRuntimeLoadStatus: () => ( {
			modelRuntimeLoadState: 'ready'
		} as never ),
		getHitTestController: () => ( {} as never ),
		getModelOrientationTarget: () => new THREE.Quaternion(),
		onBeforePlacementRequest: vi.fn(),
		onPlacementBaseResolved: vi.fn(),
		applyModelLayerVisibility: vi.fn(),
		syncRegistrationChainDebug: vi.fn(),
		syncArSessionPhase: vi.fn(),
		emit: vi.fn(),
		setStatus,
		onPlacementCompleted: vi.fn()
	};

}
