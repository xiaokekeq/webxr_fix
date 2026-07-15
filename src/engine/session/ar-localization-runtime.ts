import { arWarn } from '@/engine/debug/ar-logger.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';

interface ArLocalizationRuntimeOptions {
	getCurrentSessionId(): string | null;
	getActiveMarkerArFromEnuSolution(): ArFromEnuSolution | null;
	getMarkerCorrectionFallbackArFromEnuSolution(): ArFromEnuSolution | null;
}

export class ArLocalizationRuntime {

	constructor(private readonly options: ArLocalizationRuntimeOptions) {}

	getActiveArFromEnuSolution(): ArFromEnuSolution | null {

		return this.getActiveMarkerArFromEnuSolutionForCurrentSession();

	}

	getCurrentNonMarkerArFromEnuSolution(): ArFromEnuSolution | null {

		// Reserved for a future real RTK current-session localization source.
		return null;

	}

	getMarkerCorrectionFallbackSolution(): ArFromEnuSolution | null {

		const markerFallbackSolution = this.options.getMarkerCorrectionFallbackArFromEnuSolution();
		if ( markerFallbackSolution !== null ) {
			return cloneArFromEnuSolution( markerFallbackSolution );
		}

		return null;

	}

	getActiveMarkerArFromEnuSolutionForCurrentSession(): ArFromEnuSolution | null {

		const activeMarkerSolution = this.options.getActiveMarkerArFromEnuSolution();
		if (
			activeMarkerSolution === null
			|| activeMarkerSolution.sessionId !== this.options.getCurrentSessionId()
		) {
			if ( activeMarkerSolution !== null ) {
				arWarn( '[CurrentSessionLocalizationRejectedSessionMismatch]', {
					mode: 'marker-corners-4',
					workflowMode: null,
					siteId: null,
					modelId: null,
					targetId: null,
					currentCorner: null,
					capturedPointCount: null,
					arLocalPosition: null,
					cornersEnu: null,
					source: activeMarkerSolution.source,
					solutionSessionId: activeMarkerSolution.sessionId ?? null,
					currentSessionId: this.options.getCurrentSessionId(),
					hitTestReady: null,
					localizationReady: false,
					createdAt: Date.now()
				} );
			}
			return null;
		}

		return cloneArFromEnuSolution( activeMarkerSolution );

	}

}

function cloneArFromEnuSolution(solution: ArFromEnuSolution): ArFromEnuSolution {

	return {
		matrix: solution.matrix.clone(),
		siteOriginArPosition: solution.siteOriginArPosition.clone(),
		orientation: solution.orientation.clone(),
		headingDeg: solution.headingDeg,
		source: solution.source,
		sessionId: solution.sessionId ?? null,
		accuracyMeters: solution.accuracyMeters,
		yawAccuracyDegrees: solution.yawAccuracyDegrees,
		timestamp: solution.timestamp
	};

}
