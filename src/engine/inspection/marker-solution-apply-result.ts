export type MarkerSolutionApplyStage =
	| 'session-validation'
	| 'context-validation'
	| 'solution-validation'
	| 'coordinate-service'
	| 'state-commit'
	| 'persistence'
	| 'placement';

export interface MarkerSolutionApplyDiagnostics {
	currentSessionId: string | null;
	solutionSessionId: string | null;
	markerStateSessionId: string | null;
	contextSessionId: string | null;
	isPresenting: boolean;
	hasCurrentArSessionContext: boolean;
	hasDemoModelConfig: boolean;
	hasModelTemplate: boolean;
	hasRegistrationSolution: boolean;
	hasArCoordinateServiceSolution: boolean;
	arCoordinateServiceReady: boolean;
	activeMarkerSolutionSessionId: string | null;
	activeMarkerSolutionSource: string | null;
	solutionSource: string | null;
	solutionMatrixFinite: boolean;
	solutionMatrixInvertible: boolean;
	activeModelId: string | null;
	solutionModelId: string | null;
	activeSiteId: string | null;
	solutionSiteId: string | null;
	activeMarkerId: string | null;
	solutionMarkerId: string | null;
	calibrationModelId: string | null;
	calibrationSiteId: string | null;
	calibrationMarkerId: string | null;
	capturedCornerCount: number;
	expectedCornerCount: number;
	arSessionGeneration: number;
	modelRuntimeGeneration: number;
	markerCalibrationGeneration: number;
}

export type MarkerSolutionApplyResult =
	| {
		ok: true;
		sessionId: string;
		markerId: string;
		appliedSource: 'marker';
		placementState: 'ready' | 'marker-applied-model-runtime-pending';
		diagnostics: MarkerSolutionApplyDiagnostics;
	}
	| { ok: false; stage: MarkerSolutionApplyStage; reason: string; diagnostics: MarkerSolutionApplyDiagnostics; };

/** A dependency-free contract check callable from a browser console or dev runtime. */
export function runMarkerSolutionApplyResultSelfCheck(): void {

	const diagnostics = createSelfCheckDiagnostics();
	const success: MarkerSolutionApplyResult = {
		ok: true,
		sessionId: 'session-a',
		markerId: 'marker-a',
		appliedSource: 'marker',
		placementState: 'ready',
		diagnostics
	};
	const failure: MarkerSolutionApplyResult = {
		ok: false,
		stage: 'context-validation',
		reason: 'session-context-missing',
		 diagnostics
	};
	const pending: MarkerSolutionApplyResult = {
		...success,
		placementState: 'marker-applied-model-runtime-pending'
	};
	if (
		success.sessionId !== 'session-a'
		|| pending.placementState !== 'marker-applied-model-runtime-pending'
		|| failure.reason !== 'session-context-missing'
	) {
		throw new Error( 'MarkerSolutionApplyResult contract self-check failed.' );
	}

}

function createSelfCheckDiagnostics(): MarkerSolutionApplyDiagnostics {

	return {
		currentSessionId: 'session-a',
		solutionSessionId: 'session-a',
		markerStateSessionId: 'session-a',
		contextSessionId: 'session-a',
		isPresenting: true,
		hasCurrentArSessionContext: true,
		hasDemoModelConfig: true,
		hasModelTemplate: true,
		hasRegistrationSolution: true,
		hasArCoordinateServiceSolution: true,
		arCoordinateServiceReady: true,
		activeMarkerSolutionSessionId: 'session-a',
		activeMarkerSolutionSource: 'marker',
		solutionSource: 'marker',
		solutionMatrixFinite: true,
		solutionMatrixInvertible: true,
		activeModelId: 'model-a',
		solutionModelId: 'model-a',
		activeSiteId: 'site-a',
		solutionSiteId: 'site-a',
		activeMarkerId: 'marker-a',
		solutionMarkerId: 'marker-a',
		calibrationModelId: 'model-a',
		calibrationSiteId: 'site-a',
		calibrationMarkerId: 'marker-a',
		capturedCornerCount: 4,
		expectedCornerCount: 4,
		arSessionGeneration: 1,
		modelRuntimeGeneration: 1,
		markerCalibrationGeneration: 1
	};

}
