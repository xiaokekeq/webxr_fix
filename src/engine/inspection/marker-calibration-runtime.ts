import { arError } from '@/engine/debug/ar-logger.js';
import * as THREE from 'three';
import type {
	MarkerCalibrationState,
	RegistrationStore
} from '@/localization/core/registration-store.js';
import {
	createDefaultMarkerCalibrationState
} from '@/localization/core/registration-store.js';
import {
	resolveMarkerCornersInEnuFromControlTarget,
	solveMarkerLocalization,
	solveMarkerLocalizationGroundPlane2D,
	type MarkerLocalizationSolution,
	type MarkerPoseInEnu
} from '@/localization/marker/marker-localization.js';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import type {
	ArWorkflowMode,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';
import type { XrTrackingStatus } from '@/features/ar/types/runtime-types.js';
import {
	type MarkerSolutionApplyDiagnostics,
	type MarkerSolutionApplyResult,
	type MarkerSolutionApplyStage
} from './marker-solution-apply-result.js';

export const MARKER_CORNER_SEQUENCE = [
	{ id: 'top-left', cornerOrderValue: 'leftTop', label: 'leftTop 左上角', pointLabel: 'leftTop', shortPointLabel: 'LT' },
	{ id: 'top-right', cornerOrderValue: 'rightTop', label: 'rightTop 右上角', pointLabel: 'rightTop', shortPointLabel: 'RT' },
	{ id: 'bottom-right', cornerOrderValue: 'rightBottom', label: 'rightBottom 右下角', pointLabel: 'rightBottom', shortPointLabel: 'RB' },
	{ id: 'bottom-left', cornerOrderValue: 'leftBottom', label: 'leftBottom 左下角', pointLabel: 'leftBottom', shortPointLabel: 'LB' }
] as const;

export type MarkerCornerSequenceId = ( typeof MARKER_CORNER_SEQUENCE )[ number ][ 'id' ];
type MarkerCornerSequenceItem = ( typeof MARKER_CORNER_SEQUENCE )[ number ];
type MarkerCornerOrderValue = ( typeof MARKER_CORNER_SEQUENCE )[ number ][ 'cornerOrderValue' ];

const MARKER_CALIBRATION_MODE = 'marker-corners-4';
const EXPECTED_MARKER_CORNER_ORDER = MARKER_CORNER_SEQUENCE.map( ( item ) => item.cornerOrderValue );
const MARKER_CORNER_BY_ORDER = new Map<MarkerCornerOrderValue, MarkerCornerSequenceItem>(
	MARKER_CORNER_SEQUENCE.map( ( item ) => [ item.cornerOrderValue, item ] )
);

interface MarkerCalibrationRuntimeOptions {
	store: RegistrationStore;
	getWorkflowMode(): ArWorkflowMode;
	getSiteId(): string | null;
	getCurrentSessionId(): string | null;
	isPresenting(): boolean;
	getTrackingStatus(): XrTrackingStatus;
	hasGroundHit(): boolean;
	getHitPosition(target: THREE.Vector3): THREE.Vector3 | null;
	getDemoModelConfig(): DemoModelConfig | null;
	getPrimaryConfiguredMarkerPose(): MarkerPoseInEnu | null;
	getControlTargets(): VisualControlTarget[];
	hasAppliedMarkerSolutionForCurrentSession(): boolean;
	markManualCalibrationStarted(): void;
	applyCurrentSessionMarkerSolution(
		solution: MarkerLocalizationSolution,
		metadata: {
			markerId: string;
			markerConfigId: string;
			calibrationModelId: string | null;
			calibrationSiteId: string | null;
			calibrationMarkerId: string;
			source?: 'marker-calibration';
			capturedCornersAr?: THREE.Vector3[];
		}
	): boolean;
	getLastMarkerSolutionApplyResult(): MarkerSolutionApplyResult | null;
	clearLastMarkerSolutionApplyResult(): void;
	getLifecycleGenerations(): { arSessionGeneration: number; modelRuntimeGeneration: number };
	setStatus(message: string): void;
}

const tempMarkerCapturePosition = new THREE.Vector3();
const STRICT_MARKER_SELF_CHECK_MAX_ERROR_METERS = 0.12;
const DEV_MARKER_SELF_CHECK_MAX_ERROR_METERS = 0.4;
type MarkerCalibrationErrorLimitSource =
	| 'config markerCalibration.maxSelfCheckErrorMeters'
	| 'env VITE_MARKER_CALIBRATION_ERROR_LIMIT_M'
	| 'dev default'
	| 'production default';

interface MarkerCalibrationErrorLimit {
	meters: number;
	source: MarkerCalibrationErrorLimitSource;
}

export function resolveMarkerCalibrationErrorLimitMeters(config?: DemoModelConfig): number {

	return resolveMarkerCalibrationErrorLimit( config ).meters;

}

export class MarkerCalibrationRuntime {

	private currentSessionMarkerCornerCaptures: Array<{
		id: MarkerCornerSequenceId;
		label: string;
		arPosition: THREE.Vector3;
	}> = [];
	private currentSessionMarkerSolution: MarkerLocalizationSolution | null = null;
	private markerApplyAttemptCount = 0;
	private markerCalibrationGeneration = 0;
	private calibrationStartGenerations: { arSessionGeneration: number; modelRuntimeGeneration: number } | null = null;
	private calibrationIdentity: { modelId: string | null; siteId: string | null; markerId: string } | null = null;
	private pendingApplyFailure: MarkerSolutionApplyResult | null = null;

	constructor(private readonly options: MarkerCalibrationRuntimeOptions) {

	}

	private getActiveMarkerControlTarget(markerId?: string | null): VisualControlTarget | undefined {

		const resolvedMarkerId = markerId
			?? this.options.store.getState().markerCalibration.markerId
			?? this.options.getPrimaryConfiguredMarkerPose()?.markerId
			?? null;
		if ( resolvedMarkerId === null ) {
			return undefined;
		}
		return this.options.getControlTargets()
			.find( ( target ) => target.id === resolvedMarkerId || target.markerId === resolvedMarkerId );

	}

	private getMarkerCornerSequence(markerId?: string | null): MarkerCornerSequenceItem[] {

		return resolveMarkerCornerSequenceForTarget( this.getActiveMarkerControlTarget( markerId ) );

	}

	private solveMarkerCalibration(
		correspondences: Array<{ id: string; siteEnu: THREE.Vector3; arPosition: THREE.Vector3 }>,
		sessionId: string | null,
		timestamp: number,
		config: DemoModelConfig | null
	): MarkerLocalizationSolution {

		const solveMode = config?.markerCalibration?.solveMode ?? 'rigid-3d';
		if ( solveMode === 'ground-plane-2d' ) {
			const solution = solveMarkerLocalizationGroundPlane2D( {
				correspondences,
				sessionId,
				timestamp
			} );
			return solution;
		}

		return solveMarkerLocalization( {
			correspondences,
			sessionId,
			timestamp
		} );

	}

	resetRuntimeState(): void {

		this.resetCurrentSessionCalibrationState();

	}

	cancelForModelRuntimeChange(): boolean {

		const state = this.options.store.getState().markerCalibration;
		if ( state.active === false && this.currentSessionMarkerCornerCaptures.length === 0 ) {
			return false;
		}

		const failure = this.createApplyFailure( 'context-validation', 'model-runtime-generation-changed' );
		this.resetCurrentSessionCalibrationState();
		this.pendingApplyFailure = failure;
		this.options.store.patch( {
			markerCalibration: {
				...this.options.store.getState().markerCalibration,
				markerApplyStage: failure.stage,
				markerApplyResult: 'failure',
				markerApplyFailureReason: failure.reason,
				lastUpdatedAt: Date.now()
			}
		} );
		this.options.setStatus( '模型运行时资源已刷新，当前 Marker 四角校正已取消，请重新采集。' );
		return true;

	}

	syncState(override?: Partial<MarkerCalibrationState>): void {

		const currentState = this.options.store.getState().markerCalibration;
		const markerId = override?.markerId
			?? currentState.markerId
			?? this.options.getPrimaryConfiguredMarkerPose()?.markerId
			?? null;
		const cornerSequence = this.getMarkerCornerSequence( markerId );
		const capturedCornerCount = override?.capturedCornerCount ?? this.currentSessionMarkerCornerCaptures.length;
		const expectedCornerCount = override?.expectedCornerCount ?? cornerSequence.length;
		const nextCornerLabel = override?.nextCornerLabel
			?? cornerSequence[ Math.min( capturedCornerCount, cornerSequence.length - 1 ) ]?.label
			?? '';
		const solved = override?.solved ?? ( this.currentSessionMarkerSolution !== null );
		const applied = override?.applied ?? this.options.hasAppliedMarkerSolutionForCurrentSession();

		this.options.store.patch( {
			markerCalibration: {
				currentSessionId: override?.currentSessionId ?? this.options.getCurrentSessionId(),
				markerId,
				markerConfigId: override?.markerConfigId ?? currentState.markerConfigId ?? markerId,
				active: override?.active ?? currentState.active,
				capturedCornerCount,
				expectedCornerCount,
				nextCornerLabel,
				corners: override?.corners ?? this.currentSessionMarkerCornerCaptures.map( ( corner ) => ( {
					id: corner.id,
					label: corner.label,
					positionText: formatVector3Text( corner.arPosition )
				} ) ),
				canCapture: override?.canCapture ?? (
					this.options.isPresenting()
					&& ( override?.active ?? currentState.active )
					&& capturedCornerCount < expectedCornerCount
				),
				canSolve: override?.canSolve ?? ( capturedCornerCount === expectedCornerCount ),
				solved,
				applied,
				rmsErrorMeters: override?.rmsErrorMeters ?? this.currentSessionMarkerSolution?.rmsErrorMeters,
				headingDeg: override?.headingDeg ?? this.currentSessionMarkerSolution?.headingDeg,
				looseThresholdAccepted: override?.looseThresholdAccepted ?? currentState.looseThresholdAccepted ?? false,
				markerApplyStage: override?.markerApplyStage ?? currentState.markerApplyStage,
				markerApplyResult: override?.markerApplyResult ?? currentState.markerApplyResult,
				markerApplyFailureReason: override?.markerApplyFailureReason ?? currentState.markerApplyFailureReason,
				markerApplyAttemptCount: override?.markerApplyAttemptCount ?? currentState.markerApplyAttemptCount,
				lastUpdatedAt: override?.lastUpdatedAt ?? Date.now()
			}
		} );

	}

	startCurrentSessionCalibration(): void {

		if ( this.options.isPresenting() === false ) {
			this.options.setStatus( '请先进入当前 AR 会话，再开始 Marker 校正。' );
			return;
		}

		if ( this.options.getTrackingStatus() !== 'normal' ) {
			this.options.setStatus( '环境跟踪不稳定，请恢复后再开始 Marker 校正。' );
			return;
		}

		const markerPose = this.options.getPrimaryConfiguredMarkerPose();
		if ( markerPose === null ) {
			this.options.setStatus( '当前模型没有可用于 Marker 校正的控制标志配置。' );
			return;
		}

		const currentSessionId = this.options.getCurrentSessionId();
		if ( currentSessionId === null ) {
			this.options.setStatus( '当前 AR Session 尚未准备完成，请稍后重试。' );
			return;
		}
		const controlTarget = this.options.getControlTargets()
			.find( ( target ) => target.id === markerPose.markerId || target.markerId === markerPose.markerId );
		const targetValidationError = validateMarkerCornersTarget( controlTarget );
		if ( targetValidationError !== null ) {
			this.options.setStatus( targetValidationError );
			return;
		}
		const cornerSequence = resolveMarkerCornerSequenceForTarget( controlTarget );

		this.options.markManualCalibrationStarted();
		this.markerCalibrationGeneration += 1;
		this.calibrationStartGenerations = this.options.getLifecycleGenerations();
		this.calibrationIdentity = {
			modelId: this.options.getDemoModelConfig()?.modelId ?? null,
			siteId: this.options.getSiteId(),
			markerId: markerPose.markerId
		};
		this.pendingApplyFailure = null;
		this.currentSessionMarkerCornerCaptures = [];
		this.currentSessionMarkerSolution = null;
		this.syncState( {
			currentSessionId,
			markerId: markerPose.markerId,
			markerConfigId: markerPose.markerId,
			active: true,
			capturedCornerCount: 0,
			expectedCornerCount: cornerSequence.length,
			nextCornerLabel: cornerSequence[ 0 ].label,
			corners: [],
			canCapture: true,
			canSolve: false,
			solved: false,
			applied: this.options.hasAppliedMarkerSolutionForCurrentSession(),
			rmsErrorMeters: undefined,
			headingDeg: undefined,
			looseThresholdAccepted: false,
			lastUpdatedAt: Date.now()
		} );

		const message = this.options.getWorkflowMode() === 'ar-inspection'
			? `请按配置顺序采集控制标志四个角点：${cornerSequence.map( ( item ) => item.pointLabel ).join( ' -> ' )}。`
			: `Marker 校正已开始，请依次采集 ${cornerSequence.map( ( item ) => item.label ).join( '、' )}。`;
		this.options.setStatus( message );



	}

	captureCurrentSessionMarkerCorner(): void {

		if ( this.options.isPresenting() === false ) {
			this.options.setStatus( '请先进入当前 AR 会话，再采集 Marker 角点。' );
			return;
		}

		if ( this.options.getTrackingStatus() !== 'normal' ) {
			this.options.setStatus( '环境跟踪不稳定，已暂停 Marker 角点采集。' );
			return;
		}

		const generations = this.options.getLifecycleGenerations();
		if ( this.calibrationStartGenerations !== null && ( this.calibrationStartGenerations.arSessionGeneration !== generations.arSessionGeneration || this.calibrationStartGenerations.modelRuntimeGeneration !== generations.modelRuntimeGeneration ) ) {
			const failure = this.createApplyFailure( 'context-validation', this.calibrationStartGenerations.arSessionGeneration !== generations.arSessionGeneration ? 'ar-session-generation-changed' : 'model-runtime-generation-changed' );
			this.resetCurrentSessionCalibrationState();
			this.pendingApplyFailure = failure;
			return;
		}
		const markerState = this.options.store.getState().markerCalibration;
		const captureTarget = this.getActiveMarkerControlTarget( markerState.markerId );
		const cornerSequence = resolveMarkerCornerSequenceForTarget( captureTarget );
		if ( markerState.active === false ) {
			this.options.setStatus( '请先点击开始当前会话 Marker 校正。' );
			return;
		}

		const currentSessionId = this.options.getCurrentSessionId();
		if ( currentSessionId === null || markerState.currentSessionId !== currentSessionId ) {
			this.options.setStatus( '当前 Marker 采集属于旧会话，请重新开始。' );
			this.resetCurrentSessionCalibrationState();
			return;
		}

		if ( this.currentSessionMarkerCornerCaptures.length >= cornerSequence.length ) {
			this.options.setStatus( '四个角点已经采集完成，可以直接完成空间校正。' );
			return;
		}

		if ( this.options.hasGroundHit() === false ) {
			this.options.setStatus( '请缓慢移动设备，扫描地面。' );
			return;
		}

		const arPosition = this.options.getHitPosition( tempMarkerCapturePosition );
		if ( arPosition === null ) {
			this.options.setStatus( '未获取到角点 3D 坐标，请重新对准控制标志角点。' );
			return;
		}

		const cornerMeta = cornerSequence[ this.currentSessionMarkerCornerCaptures.length ];
		this.currentSessionMarkerCornerCaptures.push( {
			id: cornerMeta.id,
			label: cornerMeta.label,
			arPosition: arPosition.clone()
		} );
		this.currentSessionMarkerSolution = null;
		this.syncState();

		const capturedIndex = this.currentSessionMarkerCornerCaptures.length - 1;

		const nextCorner = cornerSequence[ this.currentSessionMarkerCornerCaptures.length ];
		const message = nextCorner !== undefined
			? `已采集 ${cornerMeta.label}，请采集控制标志 ${nextCorner.label}。`
			: '四角点已采集完成，请点击完成空间校正。';
		this.options.setStatus( message );

	}

	resetCurrentSessionCalibration(): void {

		this.resetCurrentSessionCalibrationState();
		this.options.setStatus( '当前会话 Marker 角点采集已重置。' );

	}

	solveAndApplyCurrentSessionCalibration(): MarkerSolutionApplyResult {

		this.options.clearLastMarkerSolutionApplyResult();
		const applied = this.solveAndApplyCurrentSessionCalibrationBoolean();
		const result = this.options.getLastMarkerSolutionApplyResult();
		const resolved = result ?? this.pendingApplyFailure ?? this.createApplyFailure( applied ? 'state-commit' : 'solution-validation', applied ? 'marker-apply-result-missing' : 'marker-solve-or-apply-precondition-failed' );
		resolved.diagnostics.markerCalibrationGeneration = this.markerCalibrationGeneration;
		this.recordApplyResult( resolved );
		return resolved;

	}

	private solveAndApplyCurrentSessionCalibrationBoolean(): boolean {

		if ( this.options.isPresenting() === false ) {
			this.options.setStatus( '请先进入当前 AR 会话，再应用 Marker 校正。' );
			return this.failSolveOrApply( 'session-validation', 'ar-session-not-presenting' );
		}

		if ( this.options.getTrackingStatus() !== 'normal' ) {
			this.options.setStatus( '环境跟踪不稳定，已暂停 Marker 校正确认。' );
			return this.failSolveOrApply( 'session-validation', 'tracking-not-normal' );
		}

		const demoModelConfig = this.options.getDemoModelConfig();
		if ( demoModelConfig === null ) {
			this.options.setStatus( '模型配置尚未准备完成，无法执行 Marker 校正。' );
			return this.failSolveOrApply( 'solution-validation', 'model-config-loading' );
		}

		const currentSessionId = this.options.getCurrentSessionId();
		if ( currentSessionId === null ) {
			this.options.setStatus( '当前 AR Session 尚未准备完成，请重新开始。' );
			return this.failSolveOrApply( 'session-validation', 'current-session-missing' );
		}

		const generations = this.options.getLifecycleGenerations();
		if ( this.calibrationStartGenerations !== null && ( this.calibrationStartGenerations.arSessionGeneration !== generations.arSessionGeneration || this.calibrationStartGenerations.modelRuntimeGeneration !== generations.modelRuntimeGeneration ) ) {
			const failure = this.createApplyFailure( 'context-validation', this.calibrationStartGenerations.arSessionGeneration !== generations.arSessionGeneration ? 'ar-session-generation-changed' : 'model-runtime-generation-changed' );
			this.resetCurrentSessionCalibrationState();
			this.pendingApplyFailure = failure;
			return false;
		}
		const markerState = this.options.store.getState().markerCalibration;
		const markerId = markerState.markerId ?? this.options.getPrimaryConfiguredMarkerPose()?.markerId ?? null;
		const cornerSequence = this.getMarkerCornerSequence( markerId );
		if ( markerId === null ) {
			this.options.setStatus( '当前模型没有可用于 Marker 校正的控制标志配置。' );
			return this.failSolveOrApply( 'context-validation', 'marker-target-missing' );
		}

		if ( markerState.currentSessionId !== currentSessionId ) {
			this.options.setStatus( '当前 Marker 角点采集属于旧会话，请重新开始。' );
			this.resetCurrentSessionCalibrationState();
			return this.failSolveOrApply( 'session-validation', 'marker-state-session-mismatch' );
		}

		if ( this.currentSessionMarkerCornerCaptures.length !== cornerSequence.length ) {
			this.options.setStatus( '四角点数量不足，无法求解空间校正。' );
			return this.failSolveOrApply( 'solution-validation', 'captured-corner-count-mismatch' );
		}

		try {
			const controlTarget = this.options.getControlTargets()
				.find( ( target ) => target.id === markerId || target.markerId === markerId );
			const targetValidationError = validateMarkerCornersTarget( controlTarget );
			if ( targetValidationError !== null ) {
				throw new Error( targetValidationError );
			}
			const markerControlTarget = controlTarget;
			if ( markerControlTarget === undefined ) {
				throw new Error( '未找到控制标志配置。' );
			}

			const expectedCorners = resolveMarkerCornersInEnuFromControlTarget( markerControlTarget );
			if ( expectedCorners.length !== cornerSequence.length ) {
				throw new Error( '当前控制标志四角点工程坐标数量不是 4，无法完成四角点校正。' );
			}

			const correspondences = cornerSequence.map( ( cornerMeta ) => {
				const expected = expectedCorners.find( ( item ) => item.id === cornerMeta.id );
				const captured = this.currentSessionMarkerCornerCaptures.find( ( item ) => item.id === cornerMeta.id );
				if ( expected === undefined || captured === undefined ) {
					throw new Error( `控制标志角点 ${cornerMeta.label} 不完整。` );
				}

				return {
					id: cornerMeta.id,
					siteEnu: expected.position.clone(),
					arPosition: captured.arPosition.clone()
				};
			} );

			const solution = this.solveMarkerCalibration( correspondences, currentSessionId, Date.now(), demoModelConfig );
			this.currentSessionMarkerSolution = solution;
			const errorLimit = resolveMarkerCalibrationErrorLimit( demoModelConfig );
			const selfCheck = createArFromEnuSelfCheckPayload( {
				correspondences,
				solution,
				errorLimit
			} );
			if ( selfCheck.acceptedByThreshold === false ) {
				throw new Error(
					`Marker 自检误差 ${selfCheck.maxErrorMeters.toFixed( 3 )}m 超过 ${errorLimit.meters}m，当前阈值来源：${errorLimit.source}。请重新采集三角桶底座落地点四角。`
				);
			}
			const looseThresholdAccepted = selfCheck.maxErrorMeters > STRICT_MARKER_SELF_CHECK_MAX_ERROR_METERS
				&& selfCheck.maxErrorMeters <= DEV_MARKER_SELF_CHECK_MAX_ERROR_METERS
				&& errorLimit.meters > STRICT_MARKER_SELF_CHECK_MAX_ERROR_METERS
				&& import.meta.env.DEV;



			this.syncState( {
				solved: true,
				applied: false,
				rmsErrorMeters: solution.rmsErrorMeters,
				headingDeg: solution.headingDeg,
				looseThresholdAccepted,
				lastUpdatedAt: Date.now()
			} );

			const applied = this.options.applyCurrentSessionMarkerSolution( solution, {
				markerId,
				markerConfigId: markerId,
				calibrationModelId: this.calibrationIdentity?.modelId ?? demoModelConfig.modelId,
				calibrationSiteId: this.calibrationIdentity?.siteId ?? this.options.getSiteId(),
				calibrationMarkerId: this.calibrationIdentity?.markerId ?? markerId,
				source: 'marker-calibration',
				capturedCornersAr: this.currentSessionMarkerCornerCaptures.map( ( item ) => item.arPosition.clone() )
			} );
			if ( applied ) {
				this.syncState( {
					active: false,
					solved: true,
					applied: true,
					canCapture: false,
					canSolve: false,
					rmsErrorMeters: solution.rmsErrorMeters,
					headingDeg: solution.headingDeg,
					looseThresholdAccepted,
					lastUpdatedAt: Date.now()
				} );
			}
			if ( applied === false ) {
								const failure = this.options.getLastMarkerSolutionApplyResult();
				this.options.setStatus( `Marker 校正未应用：${failure?.ok === false ? failure.reason : 'state-commit-failed'}` );
			}

			return applied;
		} catch ( error ) {
			this.syncState( {
				active: true,
				solved: false,
				applied: false,
				canCapture: false,
				canSolve: this.currentSessionMarkerCornerCaptures.length === cornerSequence.length,
				rmsErrorMeters: undefined,
				headingDeg: undefined,
				looseThresholdAccepted: false,
				lastUpdatedAt: Date.now()
			} );
			arError( '[MarkerSessionCalibrationSolveFailed]', {
				mode: MARKER_CALIBRATION_MODE,
				workflowMode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				targetId: this.options.store.getState().markerCalibration.markerId,
				capturedCornersAr: this.currentSessionMarkerCornerCaptures.map( ( item ) => ( {
					id: item.id,
					label: item.label,
					position: vector3ToObject( item.arPosition )
				} ) ),
				solveStatus: 'failed',
				error: error instanceof Error ? error.message : String( error ),
				createdAt: Date.now()
			} );
			this.options.setStatus(
				error instanceof Error
					? error.message
					: '空间校正失败，请重新采集控制标志四角。'
			);
			this.pendingApplyFailure = this.createApplyFailure(
				'solution-validation',
				error instanceof Error ? error.message : 'marker-solution-solve-failed'
			);
			return false;
		}

	}

	private createApplyFailure(
		stage: MarkerSolutionApplyStage,
		reason: string
	): Extract<MarkerSolutionApplyResult, { ok: false }> {

		const state = this.options.store.getState().markerCalibration;
		const config = this.options.getDemoModelConfig();
		const generations = this.options.getLifecycleGenerations();
		const diagnostics: MarkerSolutionApplyDiagnostics = {
			currentSessionId: this.options.getCurrentSessionId(),
			solutionSessionId: this.currentSessionMarkerSolution?.arFromEnuSolution.sessionId ?? null,
			markerStateSessionId: state.currentSessionId,
			contextSessionId: null,
			isPresenting: this.options.isPresenting(),
			hasCurrentArSessionContext: false,
			hasDemoModelConfig: config !== null,
			hasModelTemplate: false,
			hasRegistrationSolution: false,
			hasArCoordinateServiceSolution: false,
			arCoordinateServiceReady: false,
			activeMarkerSolutionSessionId: null,
			activeMarkerSolutionSource: null,
			solutionSource: this.currentSessionMarkerSolution?.arFromEnuSolution.source ?? null,
			solutionMatrixFinite: this.currentSessionMarkerSolution?.matrix.elements.every( Number.isFinite ) ?? false,
			solutionMatrixInvertible: false,
			activeModelId: config?.modelId ?? null,
			solutionModelId: this.calibrationIdentity?.modelId ?? config?.modelId ?? null,
			activeSiteId: this.options.getSiteId(),
			solutionSiteId: this.calibrationIdentity?.siteId ?? this.options.getSiteId(),
			activeMarkerId: state.markerId,
			solutionMarkerId: this.calibrationIdentity?.markerId ?? state.markerId,
			calibrationModelId: this.calibrationIdentity?.modelId ?? null,
			calibrationSiteId: this.calibrationIdentity?.siteId ?? null,
			calibrationMarkerId: this.calibrationIdentity?.markerId ?? null,
			capturedCornerCount: this.currentSessionMarkerCornerCaptures.length,
			expectedCornerCount: state.expectedCornerCount,
			arSessionGeneration: generations.arSessionGeneration,
			modelRuntimeGeneration: generations.modelRuntimeGeneration,
			markerCalibrationGeneration: this.markerCalibrationGeneration
		};
		return { ok: false, stage, reason, diagnostics };

	}

	private failSolveOrApply(stage: MarkerSolutionApplyStage, reason: string): false {

		this.pendingApplyFailure = this.createApplyFailure( stage, reason );
		return false;

	}

	private recordApplyResult(result: MarkerSolutionApplyResult): void {

		this.markerApplyAttemptCount += 1;
		const markerCalibration = this.options.store.getState().markerCalibration;
		this.options.store.patch( { markerCalibration: { ...markerCalibration, markerApplyStage: result.ok ? 'applied' : result.stage, markerApplyResult: result.ok ? 'success' : 'failure', markerApplyFailureReason: result.ok ? undefined : result.reason, markerApplyAttemptCount: this.markerApplyAttemptCount, lastUpdatedAt: Date.now() } } );

	}

	private resetCurrentSessionCalibrationState(): void {

		this.currentSessionMarkerCornerCaptures = [];
		this.currentSessionMarkerSolution = null;
		this.calibrationStartGenerations = null;
		this.calibrationIdentity = null;
		this.pendingApplyFailure = null;
		this.options.store.patch( {
			markerCalibration: {
				...createDefaultMarkerCalibrationState(),
				currentSessionId: this.options.getCurrentSessionId(),
				markerId: this.options.getPrimaryConfiguredMarkerPose()?.markerId ?? null,
				markerConfigId: this.options.getPrimaryConfiguredMarkerPose()?.markerId ?? null
			}
		} );

	}


}

function resolveMarkerCalibrationErrorLimit(config?: DemoModelConfig): MarkerCalibrationErrorLimit {

	const configuredLimit = config?.markerCalibration?.maxSelfCheckErrorMeters;
	if ( isPositiveFiniteNumber( configuredLimit ) ) {
		return {
			meters: configuredLimit,
			source: 'config markerCalibration.maxSelfCheckErrorMeters'
		};
	}

	const envLimit = Number( import.meta.env.VITE_MARKER_CALIBRATION_ERROR_LIMIT_M );
	if ( isPositiveFiniteNumber( envLimit ) ) {
		return {
			meters: envLimit,
			source: 'env VITE_MARKER_CALIBRATION_ERROR_LIMIT_M'
		};
	}

	return import.meta.env.DEV
		? {
			meters: DEV_MARKER_SELF_CHECK_MAX_ERROR_METERS,
			source: 'dev default'
		}
		: {
			meters: STRICT_MARKER_SELF_CHECK_MAX_ERROR_METERS,
			source: 'production default'
		};

}

function isPositiveFiniteNumber(value: unknown): value is number {

	return typeof value === 'number' && Number.isFinite( value ) && value > 0;

}

function resolveMarkerCornerSequenceForTarget(target: VisualControlTarget | undefined): MarkerCornerSequenceItem[] {

	if ( target?.cornerOrder === undefined ) {
		return [ ...MARKER_CORNER_SEQUENCE ];
	}

	const sequence = target.cornerOrder
		.map( normalizeMarkerCornerOrderValue )
		.map( ( value ) => value === null ? undefined : MARKER_CORNER_BY_ORDER.get( value ) );
	if (
		sequence.length !== MARKER_CORNER_SEQUENCE.length
		|| sequence.some( ( item ) => item === undefined )
	) {
		return [ ...MARKER_CORNER_SEQUENCE ];
	}

	return sequence as MarkerCornerSequenceItem[];

}

function validateMarkerCornersTarget(target: VisualControlTarget | undefined): string | null {

	if ( target === undefined ) {
		return '未找到控制标志配置。';
	}

	if ( target.cornersEnu === undefined || target.cornersEnu.length !== MARKER_CORNER_SEQUENCE.length ) {
		return '当前控制标志缺少四角点工程坐标，无法进行 Marker 四角点校正。';
	}

	if ( target.cornerOrder === undefined ) {
		return '控制标志 cornerOrder 缺失，无法确认四角采集顺序。';
	}

	if ( target.cornerOrder !== undefined ) {
		const normalizedOrder = target.cornerOrder.map( normalizeMarkerCornerOrderValue );
		const uniqueOrder = new Set( normalizedOrder );
		if (
			normalizedOrder.length !== EXPECTED_MARKER_CORNER_ORDER.length
			|| normalizedOrder.some( ( value ) => value === null )
			|| EXPECTED_MARKER_CORNER_ORDER.some( ( value ) => uniqueOrder.has( value ) === false )
		) {
			return '控制标志 cornerOrder 必须为 leftTop、rightTop、rightBottom、leftBottom，且与采集顺序一致。';
		}
	}

	return null;

}

function createArFromEnuSelfCheckPayload(args: {
	correspondences: Array<{
		id: string;
		siteEnu: THREE.Vector3;
		arPosition: THREE.Vector3;
	}>;
	solution: MarkerLocalizationSolution;
	errorLimit: MarkerCalibrationErrorLimit;
}): {
	points: Array<Record<string, unknown>>;
	maxErrorMeters: number;
	rmsErrorMeters: number;
	maxSelfCheckErrorMeters: number;
	errorLimitSource: MarkerCalibrationErrorLimitSource;
	maxError: number;
	rmsError: number;
	acceptedByThreshold: boolean;
	warnings: string[];
} {

	const errors: number[] = [];
	const points = args.correspondences.map( ( correspondence, index ) => {
		const predictedAr = correspondence.siteEnu.clone().applyMatrix4( args.solution.matrix );
		const error = predictedAr.distanceTo( correspondence.arPosition );
		errors.push( error );
		return {
			index,
			id: correspondence.id,
			enu: vector3ToObject( correspondence.siteEnu ),
			predictedAr: vector3ToObject( predictedAr ),
			actualAr: vector3ToObject( correspondence.arPosition ),
			error: Number( error.toFixed( 6 ) )
		};
	} );
	const maxErrorMeters = Math.max( ...errors, 0 );
	const rmsErrorMeters = Math.sqrt(
		errors.reduce( ( total, error ) => total + error * error, 0 )
		/ Math.max( errors.length, 1 )
	);
	const roundedMaxErrorMeters = Number( maxErrorMeters.toFixed( 6 ) );
	const roundedRmsErrorMeters = Number( rmsErrorMeters.toFixed( 6 ) );
	const acceptedByThreshold = maxErrorMeters <= args.errorLimit.meters;
	const warnings: string[] = [];
	if ( acceptedByThreshold === false ) {
		warnings.push( `max marker self-check error ${maxErrorMeters.toFixed( 3 )}m exceeds ${args.errorLimit.meters}m` );
	}
	return {
		points,
		maxErrorMeters: roundedMaxErrorMeters,
		rmsErrorMeters: roundedRmsErrorMeters,
		maxSelfCheckErrorMeters: args.errorLimit.meters,
		errorLimitSource: args.errorLimit.source,
		maxError: roundedMaxErrorMeters,
		rmsError: roundedRmsErrorMeters,
		acceptedByThreshold,
		warnings
	};

}

function normalizeMarkerCornerOrderValue(value: string): MarkerCornerOrderValue | null {

	switch ( value ) {
		case 'leftTop':
			return 'leftTop';
		case 'rightTop':
			return 'rightTop';
		case 'rightBottom':
			return 'rightBottom';
		case 'leftBottom':
			return 'leftBottom';
		default:
			return null;
	}

}

function formatVector3Text(vector: THREE.Vector3): string {

	return `${vector.x.toFixed( 3 )}, ${vector.y.toFixed( 3 )}, ${vector.z.toFixed( 3 )}`;

}

function vector3ToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: vector.x,
		y: vector.y,
		z: vector.z
	};

}
