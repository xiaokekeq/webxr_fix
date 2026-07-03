import * as THREE from 'three';
import type {
	XrImageTrackingObservation,
	XrImageTrackingState,
	XrTrackedImageDefinition
} from '@/features/ar/types/runtime-types.js';
import type {
	ArWorkflowMode,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';

const AUTO_MARKER_STABLE_FRAME_COUNT = 3;
const AUTO_MARKER_MAX_POSITION_JITTER_METERS = 0.15;
const AUTO_MARKER_MAX_ROTATION_JITTER_DEGREES = 5;
const AUTO_MARKER_FALLBACK_TIMEOUT_MS = 8000;

interface InspectionMarkerWorkflowOptions {
	getWorkflowMode(): ArWorkflowMode;
	getCurrentSessionId(): string | null;
	getSiteId(): string | null;
	getControlTargets(): VisualControlTarget[];
	getPrimaryTargetId(): string | null;
	hasGroundHit(): boolean;
	hasPlacedModel(): boolean;
	setStatus(message: string): void;
	startManualCalibration(message: string): void;
	onStableObservation(
		targetId: string,
		observation: XrImageTrackingObservation,
		stableFrameCount: number
	): boolean;
}

export class InspectionMarkerWorkflow {

	private imageTrackingState: XrImageTrackingState = {
		requested: false,
		supported: false,
		active: false,
		reason: 'idle'
	};
	private fallbackTriggered = false;
	private autoApplied = false;
	private startedAt = 0;
	private lastObservationAt = 0;
	private stableTargetId: string | null = null;
	private stableFrameCount = 0;
	private samples: XrImageTrackingObservation[] = [];
	private planeReadyLogged = false;

	constructor(private readonly options: InspectionMarkerWorkflowOptions) {}

	getTrackedImages(): XrTrackedImageDefinition[] {

		if ( this.options.getWorkflowMode() !== 'ar-inspection' ) {
			return [];
		}

		return this.options.getControlTargets()
			.flatMap( ( target ) => {
				if ( typeof target.imageUrl !== 'string' || target.imageUrl.length === 0 ) {
					return [];
				}

				const widthInMeters = target.trackingWidthMeters ?? target.sizeMeters;
				if ( Number.isFinite( widthInMeters ) === false || widthInMeters <= 0 ) {
					return [];
				}

				return [ {
					targetId: target.id,
					imageUrl: target.imageUrl,
					widthInMeters
				} ];
			} );

	}

	startSession(): void {

		const trackedImages = this.getTrackedImages();
		this.fallbackTriggered = false;
		this.autoApplied = false;
		this.startedAt = Date.now();
		this.lastObservationAt = 0;
		this.stableTargetId = null;
		this.stableFrameCount = 0;
		this.samples = [];
		this.planeReadyLogged = false;
		this.imageTrackingState = {
			requested: trackedImages.length > 0,
			supported: false,
			active: false,
			reason: trackedImages.length > 0 ? 'awaiting-session' : 'no-targets'
		};

		if ( this.options.getWorkflowMode() !== 'ar-inspection' ) {
			return;
		}

		console.info( '[AutoMarkerImageTrackingRequested]', this.buildLogPayload( {
			targetId: this.options.getPrimaryTargetId(),
			source: 'marker-auto-image',
			trackingState: 'requested',
			stableFrameCount: 0,
			hasHitTest: this.options.hasGroundHit(),
			createdAt: Date.now()
		} ) );
		this.options.setStatus( '请先扫描平面，然后对准现场控制标志。' );

	}

	stopSession(): void {

		this.imageTrackingState = {
			requested: false,
			supported: false,
			active: false,
			reason: 'stopped'
		};
		this.fallbackTriggered = false;
		this.autoApplied = false;
		this.startedAt = 0;
		this.lastObservationAt = 0;
		this.stableTargetId = null;
		this.stableFrameCount = 0;
		this.samples = [];
		this.planeReadyLogged = false;

	}

	markManualCalibrationStarted(): void {

		this.fallbackTriggered = true;
		this.imageTrackingState = {
			...this.imageTrackingState,
			active: false,
			reason: 'manual-corners'
		};

	}

	markAutoApplied(): void {

		this.autoApplied = true;
		this.imageTrackingState = {
			...this.imageTrackingState,
			active: false,
			supported: true,
			reason: 'applied'
		};

	}

	getStableTargetId(): string | null {

		return this.stableTargetId;

	}

	getStableFrameCount(): number {

		return this.stableFrameCount;

	}

	isAutoTrackingRequested(): boolean {

		return this.imageTrackingState.requested;

	}

	handleImageTrackingStateChange(state: XrImageTrackingState): void {

		if ( this.options.getWorkflowMode() !== 'ar-inspection' ) {
			this.imageTrackingState = state;
			return;
		}

		const previous = this.imageTrackingState;
		this.imageTrackingState = state;
		if ( state.reason === previous.reason && state.active === previous.active && state.supported === previous.supported ) {
			return;
		}

		if ( state.requested && state.supported && state.active ) {
			this.options.setStatus(
				this.options.hasGroundHit()
					? '正在自动识别控制标志...'
					: '请先扫描平面，然后对准现场控制标志。'
			);
			return;
		}

		if (
			state.requested
			&& ( state.supported === false || state.reason === 'frame-api-missing' )
			&& this.fallbackTriggered === false
		) {
			console.info( '[AutoMarkerImageTrackingUnsupported]', this.buildLogPayload( {
				targetId: this.options.getPrimaryTargetId(),
				source: 'marker-auto-image',
				trackingState: state.reason,
				stableFrameCount: this.stableFrameCount,
				hasHitTest: this.options.hasGroundHit(),
				createdAt: Date.now()
			} ) );
			this.fallbackToManual( '当前设备不支持自动识别，已切换为手动四角点校正。' );
		}

	}

	handleImageTrackingObservation(observation: XrImageTrackingObservation): void {

		if (
			this.options.getWorkflowMode() !== 'ar-inspection'
			|| this.options.getCurrentSessionId() === null
			|| this.fallbackTriggered
			|| this.autoApplied
		) {
			return;
		}

		console.info( '[AutoMarkerObservationReceived]', this.buildLogPayload( {
			targetId: observation.targetId,
			source: 'marker-auto-image',
			trackingState: observation.trackingState,
			stableFrameCount: this.stableFrameCount,
			hasHitTest: this.options.hasGroundHit(),
			createdAt: observation.timestamp
		} ) );

		if ( observation.trackingState !== 'tracked' ) {
			return;
		}

		this.lastObservationAt = observation.timestamp;
		if ( this.stableTargetId !== observation.targetId ) {
			this.stableTargetId = observation.targetId;
			this.stableFrameCount = 0;
			this.samples = [];
		}

		this.samples.push( observation );
		this.samples = this.samples.slice( - AUTO_MARKER_STABLE_FRAME_COUNT );
		this.stableFrameCount = this.samples.length;

		console.info( '[AutoMarkerPoseStabilizing]', this.buildLogPayload( {
			targetId: observation.targetId,
			source: 'marker-auto-image',
			trackingState: 'stabilizing',
			stableFrameCount: this.stableFrameCount,
			hasHitTest: this.options.hasGroundHit(),
			createdAt: observation.timestamp
		} ) );
		this.options.setStatus(
			this.stableFrameCount >= AUTO_MARKER_STABLE_FRAME_COUNT
				? '已识别控制标志，正在稳定定位...'
				: '正在自动识别控制标志...'
		);

		if ( this.samples.length < AUTO_MARKER_STABLE_FRAME_COUNT ) {
			return;
		}

		if ( this.isStable() === false ) {
			return;
		}

		const applied = this.options.onStableObservation(
			observation.targetId,
			observation,
			this.stableFrameCount
		);
		if ( applied ) {
			this.markAutoApplied();
			console.info( '[AutoMarkerApplied]', this.buildLogPayload( {
				targetId: observation.targetId,
				source: 'marker-auto-image',
				trackingState: 'applied',
				stableFrameCount: this.stableFrameCount,
				hasHitTest: this.options.hasGroundHit(),
				createdAt: observation.timestamp
			} ) );
		}

	}

	syncHints(): void {

		if ( this.options.getWorkflowMode() !== 'ar-inspection' ) {
			return;
		}

		const hasGroundHit = this.options.hasGroundHit();
		if ( hasGroundHit && this.planeReadyLogged === false ) {
			this.planeReadyLogged = true;
			console.info( '[ArInspectionPlaneReady]', this.buildLogPayload( {
				targetId: this.options.getPrimaryTargetId(),
				source: this.imageTrackingState.requested ? 'marker-auto-image' : 'marker',
				trackingState: 'plane-ready',
				stableFrameCount: this.stableFrameCount,
				hasHitTest: hasGroundHit,
				createdAt: Date.now()
			} ) );
			if ( this.options.hasPlacedModel() === false ) {
				this.options.setStatus(
					this.imageTrackingState.requested
						? '请先扫描平面，然后对准现场控制标志。'
						: '请先扫描平面，然后开始手动四角点校正。'
				);
			}
		} else if ( hasGroundHit === false ) {
			this.planeReadyLogged = false;
		}

		if (
			this.imageTrackingState.requested
			&& this.autoApplied === false
			&& this.fallbackTriggered === false
			&& Date.now() - this.startedAt >= AUTO_MARKER_FALLBACK_TIMEOUT_MS
			&& this.lastObservationAt === 0
		) {
			this.fallbackToManual( '当前设备未能识别控制标志，已切换为手动四角点校正。' );
		}

	}

	private fallbackToManual(message: string): void {

		if ( this.fallbackTriggered || this.options.getWorkflowMode() !== 'ar-inspection' ) {
			return;
		}

		this.fallbackTriggered = true;
		this.imageTrackingState = {
			...this.imageTrackingState,
			active: false,
			reason: 'fallback-manual'
		};
		console.info( '[AutoMarkerFallbackToManualCorners]', this.buildLogPayload( {
			targetId: this.stableTargetId ?? this.options.getPrimaryTargetId(),
			source: 'marker-auto-image',
			trackingState: 'fallback-manual',
			stableFrameCount: this.stableFrameCount,
			hasHitTest: this.options.hasGroundHit(),
			createdAt: Date.now()
		} ) );
		this.options.startManualCalibration( message );

	}

	private isStable(): boolean {

		if ( this.samples.length < AUTO_MARKER_STABLE_FRAME_COUNT ) {
			return false;
		}

		const samples = this.samples;
		const basePosition = samples[ 0 ].position;
		const baseRotation = samples[ 0 ].rotation;

		for ( let index = 1; index < samples.length; index += 1 ) {
			const current = samples[ index ];
			const positionDistance = Math.sqrt(
				( current.position[ 0 ] - basePosition[ 0 ] ) ** 2
				+ ( current.position[ 1 ] - basePosition[ 1 ] ) ** 2
				+ ( current.position[ 2 ] - basePosition[ 2 ] ) ** 2
			);
			if ( positionDistance > AUTO_MARKER_MAX_POSITION_JITTER_METERS ) {
				return false;
			}

			const rotationDeltaDeg = THREE.MathUtils.radToDeg(
				new THREE.Quaternion(
					baseRotation[ 0 ],
					baseRotation[ 1 ],
					baseRotation[ 2 ],
					baseRotation[ 3 ]
				).angleTo(
					new THREE.Quaternion(
						current.rotation[ 0 ],
						current.rotation[ 1 ],
						current.rotation[ 2 ],
						current.rotation[ 3 ]
					)
				)
			);
			if ( rotationDeltaDeg > AUTO_MARKER_MAX_ROTATION_JITTER_DEGREES ) {
				return false;
			}
		}

		return true;

	}

	private buildLogPayload(args: {
		targetId: string | null;
		source: 'marker' | 'marker-auto-image';
		trackingState: string;
		stableFrameCount: number;
		hasHitTest: boolean;
		createdAt: number;
	}): Record<string, unknown> {

		return {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			sessionId: this.options.getCurrentSessionId(),
			targetId: args.targetId,
			source: args.source,
			trackingState: args.trackingState,
			stableFrameCount: args.stableFrameCount,
			hasHitTest: args.hasHitTest,
			createdAt: args.createdAt
		};

	}

}
