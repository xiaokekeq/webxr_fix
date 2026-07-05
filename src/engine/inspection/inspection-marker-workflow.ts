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
import type {
	InspectionPlacementSource,
	MarkerAutoImageState,
	MarkerAutoImageUiState
} from '@/localization/core/registration-store.js';
import { getControlTargetImageUrl, isPattFileUrl } from '@/localization/baseline/site-calibration-baseline.js';

const AUTO_MARKER_STABLE_FRAME_COUNT = 3;
const AUTO_MARKER_MAX_POSITION_JITTER_METERS = 0.15;
const AUTO_MARKER_MAX_ROTATION_JITTER_DEGREES = 5;
const AUTO_MARKER_FALLBACK_TIMEOUT_MS = 8000;
const AUTO_MARKER_WIDTH_WARNING_RATIO = 0.15;

const MARKER_AUTO_IMAGE_MESSAGES: Record<MarkerAutoImageUiState, string> = {
	idle: '尚未开始自动控制标志识别。',
	'preparing-tracked-images': '正在准备控制标志图片。',
	'tracked-images-ready': '控制标志图片已加载，请将现场 Marker 放入画面。',
	'image-tracking-requested': '正在尝试自动识别控制标志。',
	'image-tracking-unsupported': '当前浏览器不支持自动控制标志识别，请使用手动四角点校正。',
	'image-tracking-api-missing': '当前 WebXR 会话不支持 getImageTrackingResults，请使用手动四角点校正。',
	'tracked-images-empty': '当前模型未配置可识别控制标志图片，请使用手动四角点校正。',
	'image-load-failed': '控制标志图片加载失败，请检查 imageUrl。',
	'waiting-for-marker': '请将控制标志完整放入画面，并保持 1-2 秒。',
	'marker-observed': '已检测到控制标志，正在确认稳定性。',
	'marker-stabilizing': '控制标志识别中，请保持手机稳定。',
	'width-mismatch-warning': '识别宽度与配置不一致，请检查打印尺寸或 trackingWidthMeters。',
	'localization-applied': '自动控制标志校正完成，模型已按工程坐标显示。',
	'fallback-manual': '自动识别不可用，请使用手动四角点校正。'
};

const STATUS_SCAN_PLANE_AND_ALIGN_MARKER = '请先扫描平面，等待 AR 跟踪稳定，然后对准现场控制标志完成空间校正。';
const STATUS_AUTO_TRACKING_MARKER = '自动控制标志识别中，请让控制标志保持在视野中。';
const STATUS_STABILIZING_MARKER = '已识别控制标志，正在稳定定位。';
const STATUS_AUTO_TRACKING_NOT_READY = '自动识别暂未成功，可继续对准控制标志或切换手动四角点校正。';
const STATUS_MANUAL_NO_TRACKED_IMAGE = '当前控制标志未配置可识别图片，请使用手动四角点校正。';
const STATUS_MANUAL_PATT_NOT_ALLOWED = '.patt 不能用于 WebXR Image Tracking，请配置 PNG/JPG/WebP 图片并使用手动四角点校正。';
const STATUS_MANUAL_INVALID_TRACKED_IMAGE = '控制标志图片或 trackingWidthMeters 配置不可用，请检查 marker 配置并使用手动四角点校正。';
const STATUS_MANUAL_UNSUPPORTED = '当前设备不支持自动识别，请使用手动四角点校正。';
const STATUS_MANUAL_IMAGE_LOAD_FAILED = '控制标志图片加载失败，请检查 marker 配置。';
const STATUS_SCAN_PLANE_AND_MANUAL = '请先扫描平面，然后开始手动四角点校正。';
const STATUS_TEMP_PLANE_PLACEMENT = '已识别平面，当前为临时演示放置，不代表正式定位。';
const STATUS_WAIT_FOR_TEMP_PLANE = '请先扫描平面，识别成功后可进行临时演示放置。';

interface InspectionMarkerWorkflowOptions {
	getWorkflowMode(): ArWorkflowMode;
	getInspectionPlacementSource(): InspectionPlacementSource;
	getCurrentSessionId(): string | null;
	getSiteId(): string | null;
	getControlTargets(): VisualControlTarget[];
	getPrimaryTargetId(): string | null;
	hasGroundHit(): boolean;
	hasPlacedModel(): boolean;
	setStatus(message: string): void;
	requestPreferredPlacement(): void;
	startManualCalibration(message: string): void;
	updateAutoImageState(patch: Partial<MarkerAutoImageState>): void;
	onStableObservation(
		targetId: string,
		observation: XrImageTrackingObservation,
		stableFrameCount: number
	): boolean;
}

function formatMeters(value: number | null | undefined): string {

	return typeof value === 'number' && Number.isFinite( value )
		? `${value.toFixed( 3 )}m`
		: '-';

}

function getImageFormatText(url: string | null | undefined): string {

	if ( typeof url !== 'string' || url.trim().length === 0 || url === '-' ) {
		return '未配置';
	}

	if ( isPattFileUrl( url ) ) {
		return '.patt 不支持';
	}

	const match = url.trim().toLowerCase().match( /\.(png|jpe?g|webp)(?:$|\?)/ );
	if ( match === null ) {
		return '不支持';
	}

	return match[ 1 ] === 'jpg' || match[ 1 ] === 'jpeg'
		? 'JPG'
		: match[ 1 ].toUpperCase();

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
	private preferredPlacementRequested = false;
	private autoNotReadyLogged = false;

	constructor(private readonly options: InspectionMarkerWorkflowOptions) {}

	getTrackedImages(): XrTrackedImageDefinition[] {

		if (
			this.options.getWorkflowMode() !== 'ar-inspection'
			|| this.options.getInspectionPlacementSource() !== 'marker-auto'
		) {
			return [];
		}

		const siteId = this.options.getSiteId();
		this.patchAutoImageState( 'preparing-tracked-images', {
			reason: 'preparing-tracked-images'
		} );
		const trackedImages = this.options.getControlTargets()
			.flatMap( ( target ) => this.createTrackedImageDefinition( target, siteId ) );

		if ( trackedImages.length === 0 ) {
			this.patchAutoImageState( 'tracked-images-empty', {
				imageLoadStatus: 'missing',
				reason: 'no-trackable-image',
				canFallbackManual: true
			} );
			console.info( '[ArInspectionTrackedImagesEmpty]', {
				mode: this.options.getWorkflowMode(),
				siteId: siteId ?? null,
				sessionId: this.options.getCurrentSessionId(),
				targetId: null,
				source: 'marker-auto-image',
				trackedImagesCount: 0,
				createdAt: Date.now()
			} );
			return [];
		}

		this.patchAutoImageState( 'tracked-images-ready', {
			imageLoadStatus: 'pending',
			reason: 'tracked-image-definitions-ready'
		} );
		for ( const trackedImage of trackedImages ) {
			console.info( '[ArInspectionTrackedImagePrepared]', {
				mode: this.options.getWorkflowMode(),
				siteId: siteId ?? null,
				sessionId: this.options.getCurrentSessionId(),
				targetId: trackedImage.targetId,
				source: 'marker-auto-image',
				imageUrl: trackedImage.imageUrl,
				patternUrl: trackedImage.patternUrl ?? null,
				trackedImagesCount: trackedImages.length,
				createdAt: Date.now()
			} );
		}

		return trackedImages;

	}

	startSession(): void {

		const preferredSource = this.options.getInspectionPlacementSource();
		const trackedImages = this.getTrackedImages();
		this.fallbackTriggered = false;
		this.autoApplied = false;
		this.startedAt = Date.now();
		this.lastObservationAt = 0;
		this.stableTargetId = null;
		this.stableFrameCount = 0;
		this.samples = [];
		this.planeReadyLogged = false;
		this.preferredPlacementRequested = false;
		this.autoNotReadyLogged = false;
		this.imageTrackingState = {
			requested: trackedImages.length > 0,
			supported: false,
			active: false,
			reason: trackedImages.length > 0 ? 'awaiting-session' : 'no-targets'
		};
		this.patchAutoImageState(
			trackedImages.length > 0 ? 'image-tracking-requested' : 'tracked-images-empty',
			{
				stableFrameCount: 0,
				trackingState: 'unknown',
				recentObservationText: '无',
				browserSupportText: '未知',
				reason: trackedImages.length > 0 ? 'awaiting-session' : 'no-targets',
				canFallbackManual: trackedImages.length === 0
			}
		);

		if ( this.options.getWorkflowMode() !== 'ar-inspection' ) {
			return;
		}

		if ( preferredSource === 'marker-auto' ) {
			console.info( '[AutoMarkerImageTrackingRequested]', this.buildLogPayload( {
				targetId: this.options.getPrimaryTargetId(),
				source: 'marker-auto-image',
				trackingState: 'requested',
				stableFrameCount: 0,
				hasHitTest: this.options.hasGroundHit(),
				createdAt: Date.now()
			} ) );

			if ( trackedImages.length === 0 ) {
				this.fallbackToManual( this.getTrackedImageUnavailableMessage() );
				return;
			}

			this.options.setStatus( STATUS_SCAN_PLANE_AND_ALIGN_MARKER );
			console.info( '[ArUiMarkerAlignmentPromptShown]', this.buildUiLogPayload( {
				currentStep: 'scan-plane-and-align-marker',
				localizationSource: 'marker-auto-image',
				targetId: this.options.getPrimaryTargetId(),
				message: STATUS_SCAN_PLANE_AND_ALIGN_MARKER
			} ) );
			return;
		}

		this.options.setStatus( STATUS_WAIT_FOR_TEMP_PLANE );

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
		this.preferredPlacementRequested = false;
		this.autoNotReadyLogged = false;
		this.patchAutoImageState( 'idle', {
			targetId: null,
			targetName: '-',
			imageUrl: '-',
			imageLoadStatus: 'unknown',
			imageFormatText: '-',
			trackingWidthMeters: null,
			trackingWidthMetersText: '-',
			measuredWidthInMeters: null,
			measuredWidthInMetersText: '-',
			browserSupportText: '未知',
			recentObservationText: '无',
			stableFrameCount: 0,
			trackingState: 'unknown',
			canFallbackManual: false,
			reason: 'stopped'
		} );

	}

	markManualCalibrationStarted(): void {

		this.fallbackTriggered = true;
		this.imageTrackingState = {
			...this.imageTrackingState,
			active: false,
			reason: 'manual-corners'
		};
		this.patchAutoImageState( 'fallback-manual', {
			modeText: '手动四角点',
			canFallbackManual: false,
			reason: 'manual-corners'
		} );

	}

	markAutoApplied(): void {

		this.autoApplied = true;
		this.imageTrackingState = {
			...this.imageTrackingState,
			active: false,
			supported: true,
			reason: 'applied'
		};
		this.patchAutoImageState( 'localization-applied', {
			browserSupportText: '支持',
			recentObservationText: '已观测',
			canFallbackManual: false,
			reason: 'applied'
		} );

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

		if (
			this.options.getWorkflowMode() !== 'ar-inspection'
			|| this.options.getInspectionPlacementSource() !== 'marker-auto'
		) {
			this.imageTrackingState = state;
			return;
		}

		const previous = this.imageTrackingState;
		this.imageTrackingState = state;
		if ( state.reason === previous.reason && state.active === previous.active && state.supported === previous.supported ) {
			return;
		}

		if ( state.requested && state.supported && state.active ) {
			this.patchAutoImageState( 'waiting-for-marker', {
				imageLoadStatus: 'success',
				browserSupportText: '支持',
				trackingState: 'waiting',
				reason: state.reason
			} );
			this.options.setStatus(
				this.options.hasGroundHit()
					? STATUS_AUTO_TRACKING_MARKER
					: STATUS_SCAN_PLANE_AND_ALIGN_MARKER
			);
			return;
		}

		if ( state.reason === 'image-load-failed' && this.fallbackTriggered === false ) {
			this.patchAutoImageState( 'image-load-failed', {
				imageLoadStatus: 'failed',
				browserSupportText: '未知',
				reason: state.reason,
				canFallbackManual: true
			} );
			this.fallbackToManual( STATUS_MANUAL_IMAGE_LOAD_FAILED );
			return;
		}

		if ( state.reason === 'frame-api-missing' ) {
			this.patchAutoImageState( 'image-tracking-api-missing', {
				browserSupportText: '不支持',
				reason: state.reason,
				canFallbackManual: true
			} );
		}

		if (
			state.requested
			&& (
				state.supported === false
				|| state.reason === 'frame-api-missing'
				|| state.reason === 'create-image-bitmap-unavailable'
			)
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
			this.patchAutoImageState(
				state.reason === 'frame-api-missing' ? 'image-tracking-api-missing' : 'image-tracking-unsupported',
				{
					browserSupportText: '不支持',
					reason: state.reason,
					canFallbackManual: true
				}
			);
			this.fallbackToManual( STATUS_MANUAL_UNSUPPORTED );
		}

	}

	handleImageTrackingObservation(observation: XrImageTrackingObservation): void {

		if (
			this.options.getWorkflowMode() !== 'ar-inspection'
			|| this.options.getCurrentSessionId() === null
			|| this.options.getInspectionPlacementSource() !== 'marker-auto'
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
			this.patchAutoImageState( 'marker-observed', {
				targetId: observation.targetId,
				recentObservationText: '已观测',
				trackingState: observation.trackingState,
				measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
				measuredWidthInMetersText: formatMeters( observation.measuredWidthInMeters ),
				reason: 'tracking-state-not-tracked'
			} );
			return;
		}

		this.lastObservationAt = observation.timestamp;
		const widthWarning = this.getWidthMismatchWarning( observation.targetId, observation.measuredWidthInMeters );
		if ( widthWarning !== null ) {
			console.warn( '[MarkerAutoImageWidthMismatchWarning]', {
				...this.buildLogPayload( {
					targetId: observation.targetId,
					source: 'marker-auto-image',
					trackingState: observation.trackingState,
					stableFrameCount: this.stableFrameCount,
					hasHitTest: this.options.hasGroundHit(),
					createdAt: observation.timestamp
				} ),
				imageUrl: widthWarning.imageUrl,
				trackingWidthMeters: widthWarning.trackingWidthMeters,
				measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
				reason: widthWarning.reason
			} );
			this.patchAutoImageState( 'width-mismatch-warning', {
				targetId: observation.targetId,
				imageUrl: widthWarning.imageUrl,
				trackingWidthMeters: widthWarning.trackingWidthMeters,
				trackingWidthMetersText: formatMeters( widthWarning.trackingWidthMeters ),
				measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
				measuredWidthInMetersText: formatMeters( observation.measuredWidthInMeters ),
				recentObservationText: '已观测',
				trackingState: observation.trackingState,
				reason: widthWarning.reason,
				canFallbackManual: true
			} );
		} else {
			this.patchAutoImageState( 'marker-observed', {
				targetId: observation.targetId,
				recentObservationText: '已观测',
				trackingState: observation.trackingState,
				measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
				measuredWidthInMetersText: formatMeters( observation.measuredWidthInMeters ),
				reason: 'marker-observed'
			} );
		}
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
		console.info( '[MarkerAutoImageStabilizing]', {
			...this.buildLogPayload( {
				targetId: observation.targetId,
				source: 'marker-auto-image',
				trackingState: 'stabilizing',
				stableFrameCount: this.stableFrameCount,
				hasHitTest: this.options.hasGroundHit(),
				createdAt: observation.timestamp
			} ),
			measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
			reason: this.isStable() ? 'stable' : 'waiting-for-stable-samples'
		} );
		if ( widthWarning === null ) {
			this.patchAutoImageState(
				this.stableFrameCount >= AUTO_MARKER_STABLE_FRAME_COUNT ? 'marker-stabilizing' : 'marker-observed',
				{
					targetId: observation.targetId,
					stableFrameCount: this.stableFrameCount,
					stableFrameText: `${this.stableFrameCount} / ${AUTO_MARKER_STABLE_FRAME_COUNT}`,
					recentObservationText: '已观测',
					trackingState: observation.trackingState,
					measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
					measuredWidthInMetersText: formatMeters( observation.measuredWidthInMeters ),
					reason: 'stabilizing'
				}
			);
		}
		this.options.setStatus(
			this.stableFrameCount >= AUTO_MARKER_STABLE_FRAME_COUNT
				? STATUS_STABILIZING_MARKER
				: STATUS_AUTO_TRACKING_MARKER
		);

		if ( this.samples.length < AUTO_MARKER_STABLE_FRAME_COUNT || this.isStable() === false ) {
			if ( this.samples.length >= AUTO_MARKER_STABLE_FRAME_COUNT ) {
				this.patchAutoImageState( 'marker-stabilizing', {
					targetId: observation.targetId,
					stableFrameCount: this.stableFrameCount,
					stableFrameText: `${this.stableFrameCount} / ${AUTO_MARKER_STABLE_FRAME_COUNT}`,
					recentObservationText: '已观测',
					trackingState: observation.trackingState,
					measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
					measuredWidthInMetersText: formatMeters( observation.measuredWidthInMeters ),
					canFallbackManual: true,
					reason: 'unstable-observation'
				} );
			}
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
			this.handlePlaneReadyHint();
		} else if ( hasGroundHit === false ) {
			this.planeReadyLogged = false;
			this.preferredPlacementRequested = false;
		}

		if (
			this.imageTrackingState.requested
			&& this.autoApplied === false
			&& this.fallbackTriggered === false
			&& Date.now() - this.startedAt >= AUTO_MARKER_FALLBACK_TIMEOUT_MS
			&& this.lastObservationAt === 0
			&& this.autoNotReadyLogged === false
		) {
			this.autoNotReadyLogged = true;
			this.patchAutoImageState( 'waiting-for-marker', {
				reason: 'no-observation-timeout',
				canFallbackManual: true
			} );
			this.options.setStatus( STATUS_AUTO_TRACKING_NOT_READY );
			console.info( '[ArUiMarkerAlignmentPromptShown]', this.buildUiLogPayload( {
				currentStep: 'marker-auto-image-not-yet-observed',
				localizationSource: 'marker-auto-image',
				targetId: this.options.getPrimaryTargetId(),
				message: STATUS_AUTO_TRACKING_NOT_READY
			} ) );
		}

	}

	private createTrackedImageDefinition(
		target: VisualControlTarget,
		siteId: string | null
	): XrTrackedImageDefinition[] {

		const imageUrl = getControlTargetImageUrl( target );
		if ( imageUrl === null ) {
			this.patchAutoImageState( 'tracked-images-empty', {
				targetId: target.id,
				targetName: target.name ?? target.markerId ?? target.id,
				imageUrl: target.imageUrl ?? target.patternUrl ?? '-',
				imageLoadStatus: 'missing',
				imageFormatText: getImageFormatText( target.imageUrl ?? target.patternUrl ),
				trackingWidthMeters: target.trackingWidthMeters ?? target.sizeMeters ?? null,
				trackingWidthMetersText: formatMeters( target.trackingWidthMeters ?? target.sizeMeters ),
				canFallbackManual: true,
				reason: 'invalid-image-url'
			} );
			console.warn(
				typeof target.patternUrl === 'string' && isPattFileUrl( target.patternUrl )
					? '[MarkerImageUrlInvalidPattFile]'
					: '[MarkerImageUrlMissing]',
				{
					mode: this.options.getWorkflowMode(),
					siteId: siteId ?? null,
					sessionId: this.options.getCurrentSessionId(),
					targetId: target.id,
					imageUrl: target.imageUrl ?? null,
					patternUrl: target.patternUrl ?? null,
					createdAt: Date.now()
				}
			);
			return [];
		}

		const widthInMeters = target.trackingWidthMeters ?? target.sizeMeters;
		if (
			typeof widthInMeters !== 'number'
			|| Number.isFinite( widthInMeters ) === false
			|| widthInMeters <= 0
		) {
			this.patchAutoImageState( 'tracked-images-empty', {
				targetId: target.id,
				targetName: target.name ?? target.markerId ?? target.id,
				imageUrl,
				imageLoadStatus: 'success',
				imageFormatText: getImageFormatText( imageUrl ),
				trackingWidthMeters: null,
				trackingWidthMetersText: '-',
				canFallbackManual: true,
				reason: 'invalid-tracking-width'
			} );
			return [];
		}

		return [ {
			targetId: target.id,
			siteId: siteId ?? undefined,
			markerId: target.id,
			imageUrl,
			patternUrl: target.patternUrl ?? imageUrl,
			widthInMeters,
			trackingWidthMeters: target.trackingWidthMeters,
			sizeMeters: target.sizeMeters
		} ];

	}

	private handlePlaneReadyHint(): void {

		console.info( '[ArInspectionPlaneReady]', this.buildLogPayload( {
			targetId: this.options.getPrimaryTargetId(),
			source: this.imageTrackingState.requested ? 'marker-auto-image' : 'marker',
			trackingState: 'plane-ready',
			stableFrameCount: this.stableFrameCount,
			hasHitTest: true,
			createdAt: Date.now()
		} ) );

		if ( this.options.hasPlacedModel() === false ) {
			if ( this.options.getInspectionPlacementSource() === 'marker-auto' ) {
				const message = this.imageTrackingState.requested
					? STATUS_SCAN_PLANE_AND_ALIGN_MARKER
					: STATUS_SCAN_PLANE_AND_MANUAL;
				this.options.setStatus( message );
				console.info( '[ArUiMarkerAlignmentPromptShown]', this.buildUiLogPayload( {
					currentStep: 'plane-ready-align-marker',
					localizationSource: this.imageTrackingState.requested ? 'marker-auto-image' : 'marker',
					targetId: this.options.getPrimaryTargetId(),
					message
				} ) );
			} else {
				this.options.setStatus( STATUS_TEMP_PLANE_PLACEMENT );
				console.info( '[ArUiTemporaryPlacementWarningShown]', this.buildUiLogPayload( {
					currentStep: 'hit-test-temporary-placement',
					localizationSource: 'fallback',
					targetId: this.options.getPrimaryTargetId(),
					message: STATUS_TEMP_PLANE_PLACEMENT
				} ) );
			}
		}

		if (
			this.options.hasPlacedModel() === false
			&& this.preferredPlacementRequested === false
			&& this.options.getInspectionPlacementSource() !== 'marker-auto'
		) {
			this.preferredPlacementRequested = true;
			this.options.requestPreferredPlacement();
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
		const target = this.getTarget( this.stableTargetId ?? this.options.getPrimaryTargetId() );
		this.patchAutoImageState( 'fallback-manual', {
			targetId: this.stableTargetId ?? this.options.getPrimaryTargetId(),
			targetName: target?.name ?? target?.markerId ?? target?.id ?? '-',
			modeText: '手动四角点',
			canFallbackManual: false,
			reason: 'fallback-manual'
		} );
		console.info( '[AutoMarkerFallbackToManualCorners]', this.buildLogPayload( {
			targetId: this.stableTargetId ?? this.options.getPrimaryTargetId(),
			source: 'marker-auto-image',
			trackingState: 'fallback-manual',
			stableFrameCount: this.stableFrameCount,
			hasHitTest: this.options.hasGroundHit(),
			createdAt: Date.now()
		} ) );
		console.info( '[MarkerAutoImageFallbackManual]', {
			...this.buildLogPayload( {
				targetId: this.stableTargetId ?? this.options.getPrimaryTargetId(),
				source: 'marker-auto-image',
				trackingState: 'fallback-manual',
				stableFrameCount: this.stableFrameCount,
				hasHitTest: this.options.hasGroundHit(),
				createdAt: Date.now()
			} ),
			imageUrl: target?.imageUrl ?? target?.patternUrl ?? null,
			trackingWidthMeters: target?.trackingWidthMeters ?? target?.sizeMeters ?? null,
			measuredWidthInMeters: this.samples[ this.samples.length - 1 ]?.measuredWidthInMeters ?? null,
			reason: 'fallback-manual'
		} );
		console.info( '[ArUiMarkerAutoImageUnavailableFallbackManual]', this.buildUiLogPayload( {
			currentStep: 'fallback-manual-corners',
			localizationSource: 'marker-auto-image',
			targetId: this.stableTargetId ?? this.options.getPrimaryTargetId(),
			message
		} ) );
		this.options.startManualCalibration( message );

	}

	private getTrackedImageUnavailableMessage(): string {

		const targets = this.options.getControlTargets();
		if ( targets.length === 0 ) {
			return '当前模型未配置控制标志，请使用手动四角点校正。';
		}

		const hasPattFile = targets.some( ( target ) => (
			( typeof target.patternUrl === 'string' && isPattFileUrl( target.patternUrl ) )
			|| ( typeof target.imageUrl === 'string' && isPattFileUrl( target.imageUrl ) )
		) );
		if ( hasPattFile ) {
			return STATUS_MANUAL_PATT_NOT_ALLOWED;
		}

		const hasDeclaredImage = targets.some( ( target ) => (
			( typeof target.patternUrl === 'string' && target.patternUrl.trim().length > 0 )
			|| ( typeof target.imageUrl === 'string' && target.imageUrl.trim().length > 0 )
		) );
		if ( hasDeclaredImage === false ) {
			return STATUS_MANUAL_NO_TRACKED_IMAGE;
		}

		return STATUS_MANUAL_INVALID_TRACKED_IMAGE;

	}

	private isStable(): boolean {

		if ( this.samples.length < AUTO_MARKER_STABLE_FRAME_COUNT ) {
			return false;
		}

		const basePosition = this.samples[ 0 ].position;
		const baseRotation = this.samples[ 0 ].rotation;

		for ( let index = 1; index < this.samples.length; index += 1 ) {
			const current = this.samples[ index ];
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

	private patchAutoImageState(
		state: MarkerAutoImageUiState,
		patch: Partial<MarkerAutoImageState> = {}
	): void {

		const target = this.getTarget( patch.targetId ?? this.stableTargetId ?? this.options.getPrimaryTargetId() );
		const imageUrl = patch.imageUrl ?? target?.imageUrl ?? target?.patternUrl ?? '-';
		const trackingWidthMeters = patch.trackingWidthMeters
			?? target?.trackingWidthMeters
			?? target?.sizeMeters
			?? null;
		const stableFrameCount = patch.stableFrameCount ?? this.stableFrameCount;
		const measuredWidthInMeters = patch.measuredWidthInMeters ?? null;

		this.options.updateAutoImageState( {
			state,
			message: patch.message ?? MARKER_AUTO_IMAGE_MESSAGES[ state ],
			modeText: patch.modeText ?? this.resolveModeText(),
			targetId: patch.targetId ?? target?.id ?? null,
			targetName: patch.targetName ?? target?.name ?? target?.markerId ?? target?.id ?? '-',
			imageUrl,
			imageLoadStatus: patch.imageLoadStatus ?? 'unknown',
			imageFormatText: patch.imageFormatText ?? getImageFormatText( imageUrl ),
			trackingWidthMeters,
			trackingWidthMetersText: patch.trackingWidthMetersText ?? formatMeters( trackingWidthMeters ),
			measuredWidthInMeters,
			measuredWidthInMetersText: patch.measuredWidthInMetersText ?? formatMeters( measuredWidthInMeters ),
			browserSupportText: patch.browserSupportText ?? '未知',
			recentObservationText: patch.recentObservationText ?? '无',
			stableFrameCount,
			requiredStableFrameCount: AUTO_MARKER_STABLE_FRAME_COUNT,
			stableFrameText: patch.stableFrameText ?? `${stableFrameCount} / ${AUTO_MARKER_STABLE_FRAME_COUNT}`,
			trackingState: patch.trackingState ?? this.imageTrackingState.reason,
			fallbackText: patch.fallbackText ?? '可用',
			canFallbackManual: patch.canFallbackManual ?? false,
			reason: patch.reason ?? state,
			lastUpdatedAt: Date.now()
		} );

	}

	private resolveModeText(): string {

		if ( this.options.getInspectionPlacementSource() !== 'marker-auto' ) {
			return '未开始';
		}

		return this.fallbackTriggered ? '手动四角点' : '自动识别';

	}

	private getTarget(targetId: string | null): VisualControlTarget | null {

		const targets = this.options.getControlTargets();
		if ( targetId !== null ) {
			return targets.find( ( target ) => target.id === targetId || target.markerId === targetId ) ?? null;
		}

		return targets[ 0 ] ?? null;

	}

	private getWidthMismatchWarning(
		targetId: string,
		measuredWidthInMeters: number | undefined
	): {
		imageUrl: string;
		trackingWidthMeters: number;
		reason: string;
	} | null {

		if ( typeof measuredWidthInMeters !== 'number' || Number.isFinite( measuredWidthInMeters ) === false ) {
			return null;
		}

		const target = this.getTarget( targetId );
		const trackingWidthMeters = target?.trackingWidthMeters ?? target?.sizeMeters;
		if (
			typeof trackingWidthMeters !== 'number'
			|| Number.isFinite( trackingWidthMeters ) === false
			|| trackingWidthMeters <= 0
		) {
			return null;
		}

		const ratio = Math.abs( measuredWidthInMeters - trackingWidthMeters ) / trackingWidthMeters;
		if ( ratio <= AUTO_MARKER_WIDTH_WARNING_RATIO ) {
			return null;
		}

		return {
			imageUrl: target?.imageUrl ?? target?.patternUrl ?? '-',
			trackingWidthMeters,
			reason: 'measured-width-mismatch'
		};

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

	private buildUiLogPayload(args: {
		currentStep: string;
		localizationSource: 'marker' | 'marker-auto-image' | 'fallback';
		targetId: string | null;
		message: string;
	}): Record<string, unknown> {

		return {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			modelId: null,
			sessionId: this.options.getCurrentSessionId(),
			currentStep: args.currentStep,
			localizationSource: args.localizationSource,
			targetId: args.targetId,
			message: args.message,
			createdAt: Date.now()
		};

	}

}
