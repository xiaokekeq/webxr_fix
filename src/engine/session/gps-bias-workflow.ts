import * as THREE from 'three';
import type { ArPlacementMode } from '@/localization/core/registration-store.js';
import {
	canUseGpsBiasForLocalization,
	createGpsBiasArFromEnuSolution,
	shouldAcceptGpsAccuracy,
	type GpsBiasGeolocationSample
} from '@/localization/gps-bias/gps-bias-registration.js';
import {
	createArFromEnuSolution,
	type ArFromEnuSolution
} from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ManualPlacementBase } from '@/localization/manual/manual-registration.js';
import type { GpsBiasCorrection as StoredGpsBiasCorrection } from '@/localization/gps-bias/gps-bias-storage.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { InspectionPlacementSource } from '@/localization/core/registration-store.js';

const tempGpsBiasSmoothedPosition = new THREE.Vector3();
const tempGpsBiasSmoothedOrientation = new THREE.Quaternion();

interface GpsBiasWorkflowOptions {
	placementSession: PlacementSession;
	getWorkflowMode(): ArWorkflowMode;
	getInspectionPlacementSource(): InspectionPlacementSource;
	getSiteId(): string | null;
	getCurrentSessionId(): string | null;
	getActiveCorrection(): StoredGpsBiasCorrection | null;
	getCurrentHeadingDeg(): number | null;
	getActiveArFromEnuSolution(): ArFromEnuSolution | null;
	getActiveMarkerArFromEnuSolution(): ArFromEnuSolution | null;
	getCurrentViewerArPosition(): THREE.Vector3 | null;
	getPlacementMode(): ArPlacementMode;
	getModelTemplate(): THREE.Group | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getManualApplyToPlacement(): (
		base: ManualPlacementBase,
		targetPosition: THREE.Vector3,
		targetOrientation: THREE.Quaternion
	) => { position: THREE.Vector3; orientation: THREE.Quaternion; scale: number };
	getManualPositionTarget(): THREE.Vector3;
	getManualOrientationTarget(): THREE.Quaternion;
	isPresenting(): boolean;
	getReferenceSpace(): XRReferenceSpace | null;
	refreshGpsBiasCorrectionState(options?: { silentStatus?: boolean }): void;
	syncRegistrationChainDebug(): void;
	applyModelLayerVisibility(): void;
	emit(): void;
	setStatus(message: string): void;
}

export class GpsBiasWorkflow {

	private currentSessionSolution: ArFromEnuSolution | null = null;
	private lastGpsBiasPollAt = 0;
	private gpsBiasPollPromise: Promise<GpsBiasGeolocationSample | null> | null = null;
	private latestGpsBiasSample: GpsBiasGeolocationSample | null = null;
	private latestAcceptedGpsBiasSample: GpsBiasGeolocationSample | null = null;
	private attachedReferenceSpace: XRReferenceSpace | null = null;
	private gpsBiasLowAccuracyWarned = false;

	constructor(private readonly options: GpsBiasWorkflowOptions) {}

	resetRuntimeState(): void {

		this.currentSessionSolution = null;
		this.latestGpsBiasSample = null;
		this.latestAcceptedGpsBiasSample = null;
		this.lastGpsBiasPollAt = 0;
		this.gpsBiasLowAccuracyWarned = false;
		this.detachReferenceSpace();

	}

	clearSessionSolution(): void {

		this.currentSessionSolution = null;

	}

	setAcceptedSample(sample: GpsBiasGeolocationSample | null): void {

		this.latestAcceptedGpsBiasSample = sample;

	}

	getLatestSample(): GpsBiasGeolocationSample | null {

		return this.latestGpsBiasSample;

	}

	getLatestAcceptedSample(): GpsBiasGeolocationSample | null {

		return this.latestAcceptedGpsBiasSample;

	}

	getSessionSolution(): ArFromEnuSolution | null {

		const currentSessionId = this.options.getCurrentSessionId();
		if (
			this.currentSessionSolution === null
			|| this.currentSessionSolution.sessionId !== currentSessionId
		) {
			return null;
		}

		return cloneArFromEnuSolution( this.currentSessionSolution );

	}

	getPreferredLocalizationOverride(): ArFromEnuSolution | null {

		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			const preferredSource = this.options.getInspectionPlacementSource();
			if ( preferredSource === 'marker-auto' ) {
				return this.options.getActiveMarkerArFromEnuSolution();
			}

			if ( preferredSource === 'gps-bias' ) {
				return this.getSessionSolution();
			}

			return null;
		}

		const markerSolution = this.options.getActiveMarkerArFromEnuSolution();
		if ( markerSolution !== null ) {
			return markerSolution;
		}

		const gpsBiasSolution = this.getSessionSolution();
		if ( gpsBiasSolution !== null ) {
			return gpsBiasSolution;
		}

		return null;

	}

	getTrustedArFromEnuSolutionForCapture(): ArFromEnuSolution | null {

		const activeSolution = this.options.getActiveArFromEnuSolution();
		if ( activeSolution === null ) {
			return null;
		}

		return activeSolution.source === 'marker'
			|| activeSolution.source === 'marker-auto-image'
			|| activeSolution.source === 'manual-site-pose'
			|| activeSolution.source === 'rtk'
			? activeSolution
			: null;

	}

	syncReferenceSpace(): void {

		const referenceSpace = this.options.getReferenceSpace();
		if ( referenceSpace === this.attachedReferenceSpace ) {
			return;
		}

		this.detachReferenceSpace();
		if ( referenceSpace === null || 'addEventListener' in referenceSpace === false ) {
			return;
		}

		referenceSpace.addEventListener( 'reset', this.handleReferenceSpaceReset as EventListener );
		this.attachedReferenceSpace = referenceSpace;

	}

	detachReferenceSpace(): void {

		if ( this.attachedReferenceSpace !== null && 'removeEventListener' in this.attachedReferenceSpace ) {
			this.attachedReferenceSpace.removeEventListener(
				'reset',
				this.handleReferenceSpaceReset as EventListener
			);
		}

		this.attachedReferenceSpace = null;

	}

	syncFromFrame(): void {

		const currentSessionId = this.options.getCurrentSessionId();
		if ( this.options.isPresenting() === false || currentSessionId === null ) {
			return;
		}

		void this.fetchSample();
		const correction = this.options.getActiveCorrection();
		const gpsSample = this.latestAcceptedGpsBiasSample;
		if ( correction === null || gpsSample === null ) {
			this.options.refreshGpsBiasCorrectionState( { silentStatus: true } );
			return;
		}

		const viewerPositionAr = this.options.getCurrentViewerArPosition();
		if ( viewerPositionAr === null ) {
			return;
		}

		const solutionResult = createGpsBiasArFromEnuSolution( {
			correction,
			rawGpsSample: gpsSample,
			viewerPositionAr,
			headingDeg: this.resolveHeadingDeg(),
			sessionId: currentSessionId
		} );
		const previousSolution = this.currentSessionSolution;
		const nextSolution = previousSolution === null
			? solutionResult.solution
			: smoothGpsBiasArFromEnuSolution( previousSolution, solutionResult.solution );
		this.currentSessionSolution = nextSolution;

		if ( previousSolution === null ) {
			console.info( '[GpsBiasSolutionCreated]', {
				siteId: correction.siteId,
				sessionId: currentSessionId,
				accuracyMeters: gpsSample.accuracyMeters ?? null,
				rawGpsEnu: vector3ToObject( solutionResult.rawGpsEnu ),
				deltaEnu: { x: correction.deltaEnu[ 0 ], y: correction.deltaEnu[ 1 ], z: correction.deltaEnu[ 2 ] },
				correctedDeviceEnu: vector3ToObject( solutionResult.correctedDeviceEnu ),
				source: nextSolution.source,
				createdAt: nextSolution.timestamp
			} );
		} else {
			console.info( '[GpsBiasSolutionSmoothed]', {
				siteId: correction.siteId,
				sessionId: currentSessionId,
				accuracyMeters: gpsSample.accuracyMeters ?? null,
				rawGpsEnu: vector3ToObject( solutionResult.rawGpsEnu ),
				deltaEnu: { x: correction.deltaEnu[ 0 ], y: correction.deltaEnu[ 1 ], z: correction.deltaEnu[ 2 ] },
				correctedDeviceEnu: vector3ToObject( solutionResult.correctedDeviceEnu ),
				source: nextSolution.source,
				createdAt: nextSolution.timestamp
			} );
		}

		if ( this.shouldAutoApplySolution() ) {
			const applied = this.options.placementSession.applyArLocalizationSolution( {
				modelTemplate: this.options.getModelTemplate(),
				registrationSolution: this.options.getRegistrationSolution(),
				arFromEnuSolution: nextSolution,
				currentSessionId,
				manualApplyToPlacement: this.options.getManualApplyToPlacement(),
				manualPositionTarget: this.options.getManualPositionTarget(),
				manualOrientationTarget: this.options.getManualOrientationTarget()
			} );
			if ( applied ) {
				console.info( '[GpsBiasSolutionApplied]', {
					siteId: correction.siteId,
					sessionId: currentSessionId,
					accuracyMeters: gpsSample.accuracyMeters ?? null,
					rawGpsEnu: vector3ToObject( solutionResult.rawGpsEnu ),
					deltaEnu: { x: correction.deltaEnu[ 0 ], y: correction.deltaEnu[ 1 ], z: correction.deltaEnu[ 2 ] },
					correctedDeviceEnu: vector3ToObject( solutionResult.correctedDeviceEnu ),
					source: nextSolution.source,
					createdAt: nextSolution.timestamp
				} );
				if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
					console.info( '[ArInspectionFallbackToGpsBias]', {
						mode: this.options.getWorkflowMode(),
						siteId: correction.siteId,
						sessionId: currentSessionId,
						source: nextSolution.source,
						targetId: null,
						createdAt: nextSolution.timestamp,
						trackingState: 'gps-bias-applied',
						stableFrameCount: 0
					} );
					this.options.setStatus( '当前为 GPS 粗定位，可能存在米级偏差。' );
				}
				this.options.applyModelLayerVisibility();
			}
		} else if ( this.hasHigherPrioritySourceThanGpsBias() ) {
			console.info( '[GpsBiasSkippedBecauseHigherPrioritySource]', {
				siteId: correction.siteId,
				sessionId: currentSessionId,
				accuracyMeters: gpsSample.accuracyMeters ?? null,
				source: this.options.getActiveArFromEnuSolution()?.source ?? 'unknown',
				createdAt: nextSolution.timestamp
			} );
		}

		console.info( '[GpsBiasSolutionRecomputed]', {
			siteId: correction.siteId,
			sessionId: currentSessionId,
			accuracyMeters: gpsSample.accuracyMeters ?? null,
			rawGpsEnu: vector3ToObject( solutionResult.rawGpsEnu ),
			deltaEnu: { x: correction.deltaEnu[ 0 ], y: correction.deltaEnu[ 1 ], z: correction.deltaEnu[ 2 ] },
			correctedDeviceEnu: vector3ToObject( solutionResult.correctedDeviceEnu ),
			source: nextSolution.source,
			createdAt: nextSolution.timestamp
		} );

		this.options.refreshGpsBiasCorrectionState( { silentStatus: true } );
		this.options.syncRegistrationChainDebug();

	}

	async fetchSample(options?: {
		force?: boolean;
	}): Promise<GpsBiasGeolocationSample | null> {

		if ( this.gpsBiasPollPromise !== null && options?.force !== true ) {
			return this.gpsBiasPollPromise.then( () => this.latestGpsBiasSample );
		}

		const now = Date.now();
		if ( options?.force !== true && now - this.lastGpsBiasPollAt < 2000 ) {
			return this.latestGpsBiasSample;
		}

		this.lastGpsBiasPollAt = now;
		this.gpsBiasPollPromise = this.readCurrentSample()
			.then( ( sample ) => {
				this.latestGpsBiasSample = sample;
				if ( sample !== null && shouldAcceptGpsAccuracy( sample.accuracyMeters ) ) {
					this.latestAcceptedGpsBiasSample = sample;
					this.gpsBiasLowAccuracyWarned = false;
				} else if ( sample !== null && this.gpsBiasLowAccuracyWarned === false ) {
					this.gpsBiasLowAccuracyWarned = true;
					console.warn( '[GpsBiasCorrectionRejectedLowAccuracy]', {
						siteId: this.options.getSiteId(),
						sessionId: this.options.getCurrentSessionId(),
						accuracyMeters: sample.accuracyMeters ?? null
					} );
				}

				return sample;
			} )
			.finally( () => {
				this.gpsBiasPollPromise = null;
			} );

		return this.gpsBiasPollPromise;

	}

	private handleReferenceSpaceReset = (): void => {

		console.info( '[GpsBiasReferenceSpaceReset]', {
			siteId: this.options.getSiteId(),
			sessionId: this.options.getCurrentSessionId()
		} );
		this.currentSessionSolution = null;
		this.options.refreshGpsBiasCorrectionState( { silentStatus: true } );
		this.options.syncRegistrationChainDebug();
		this.options.emit();

	};

	private async readCurrentSample(): Promise<GpsBiasGeolocationSample | null> {

		if ( 'geolocation' in navigator === false ) {
			return null;
		}

		return new Promise<GpsBiasGeolocationSample | null>( ( resolve ) => {
			navigator.geolocation.getCurrentPosition(
				( position ) => {
					resolve( {
						latitude: position.coords.latitude,
						longitude: position.coords.longitude,
						altitude: position.coords.altitude ?? 0,
						accuracyMeters: position.coords.accuracy,
						timestamp: position.timestamp
					} );
				},
				() => {
					resolve( null );
				},
				{
					enableHighAccuracy: true,
					timeout: 8000,
					maximumAge: 0
				}
			);
		} );

	}

	private resolveHeadingDeg(): number {

		const currentHeadingDeg = this.options.getCurrentHeadingDeg();
		if ( currentHeadingDeg !== null ) {
			return currentHeadingDeg;
		}

		const activeSolution = this.options.getActiveArFromEnuSolution();
		if ( activeSolution !== null && canUseGpsBiasForLocalization( activeSolution.source ) ) {
			return activeSolution.headingDeg;
		}

		return this.options.getActiveCorrection()?.yawCorrectionDeg ?? 0;

	}

	private hasHigherPrioritySourceThanGpsBias(): boolean {

		const activeSolution = this.options.getActiveArFromEnuSolution();
		return activeSolution?.source === 'marker'
			|| activeSolution?.source === 'marker-auto-image'
			|| activeSolution?.source === 'manual-site-pose'
			|| activeSolution?.source === 'rtk';

	}

	private shouldAutoApplySolution(): boolean {

		if ( this.hasHigherPrioritySourceThanGpsBias() ) {
			return false;
		}

		if ( this.options.getPlacementMode() !== 'localized' ) {
			return false;
		}

		const placementBase = this.options.placementSession.getPlacementBase();
		const placedModel = this.options.placementSession.getArPlacedModel();
		if ( placedModel === null || placementBase?.siteContext === undefined ) {
			return false;
		}

		return placementBase.siteContext.source !== 'unknown';

	}

}

function smoothGpsBiasArFromEnuSolution(
	previous: ArFromEnuSolution,
	target: ArFromEnuSolution
): ArFromEnuSolution {

	const smoothingFactor = 0.18;
	return createArFromEnuSolution( {
		position: tempGpsBiasSmoothedPosition
			.copy( previous.siteOriginArPosition )
			.lerp( target.siteOriginArPosition, smoothingFactor )
			.clone(),
		orientation: tempGpsBiasSmoothedOrientation
			.copy( previous.orientation )
			.slerp( target.orientation, smoothingFactor )
			.clone(),
		headingDeg: target.headingDeg,
		source: target.source,
		sessionId: target.sessionId,
		accuracyMeters: target.accuracyMeters,
		yawAccuracyDegrees: target.yawAccuracyDegrees,
		timestamp: target.timestamp
	} );

}

function cloneArFromEnuSolution(solution: ArFromEnuSolution): ArFromEnuSolution {

	return {
		matrix: solution.matrix.clone(),
		orientation: solution.orientation.clone(),
		siteOriginArPosition: solution.siteOriginArPosition.clone(),
		headingDeg: solution.headingDeg,
		source: solution.source,
		sessionId: solution.sessionId,
		accuracyMeters: solution.accuracyMeters,
		yawAccuracyDegrees: solution.yawAccuracyDegrees,
		timestamp: solution.timestamp
	};

}

function vector3ToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: vector.x,
		y: vector.y,
		z: vector.z
	};

}
