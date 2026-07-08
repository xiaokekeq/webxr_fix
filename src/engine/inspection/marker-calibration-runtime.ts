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
	type MarkerLocalizationSolution,
	type MarkerPoseInEnu
} from '@/localization/marker/marker-localization.js';
import {
	computeQuadDiagnostics,
	createMarkerCalibrationCorrespondencePayload
} from '@/localization/core/corner-order-diagnostics.js';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import type {
	ArWorkflowMode,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';

export const MARKER_CORNER_SEQUENCE = [
	{ id: 'top-left', cornerOrderValue: 'leftTop', label: 'leftTop 左上角', pointLabel: 'leftTop', shortPointLabel: 'LT' },
	{ id: 'top-right', cornerOrderValue: 'rightTop', label: 'rightTop 右上角', pointLabel: 'rightTop', shortPointLabel: 'RT' },
	{ id: 'bottom-right', cornerOrderValue: 'rightBottom', label: 'rightBottom 右下角', pointLabel: 'rightBottom', shortPointLabel: 'RB' },
	{ id: 'bottom-left', cornerOrderValue: 'leftBottom', label: 'leftBottom 左下角', pointLabel: 'leftBottom', shortPointLabel: 'LB' }
] as const;

export type MarkerCornerSequenceId = ( typeof MARKER_CORNER_SEQUENCE )[ number ][ 'id' ];
type MarkerCornerOrderValue = ( typeof MARKER_CORNER_SEQUENCE )[ number ][ 'cornerOrderValue' ];

const MARKER_CALIBRATION_MODE = 'marker-corners-4';
const EXPECTED_MARKER_CORNER_ORDER = MARKER_CORNER_SEQUENCE.map( ( item ) => item.cornerOrderValue );

interface MarkerCalibrationRuntimeOptions {
	store: RegistrationStore;
	getWorkflowMode(): ArWorkflowMode;
	getSiteId(): string | null;
	getConfigUrl(): string | null;
	getCurrentSessionId(): string | null;
	isPresenting(): boolean;
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
			source?: 'marker';
			capturedCornersAr?: THREE.Vector3[];
		}
	): boolean;
	setStatus(message: string): void;
}

const tempMarkerCapturePosition = new THREE.Vector3();
const MARKER_CAPTURE_HEIGHT_WARNING_METERS = 0.08;
const MARKER_SELF_CHECK_MAX_ERROR_METERS = 0.12;

export class MarkerCalibrationRuntime {

	private currentSessionMarkerCornerCaptures: Array<{
		id: MarkerCornerSequenceId;
		label: string;
		arPosition: THREE.Vector3;
	}> = [];
	private currentSessionMarkerSolution: MarkerLocalizationSolution | null = null;

	constructor(private readonly options: MarkerCalibrationRuntimeOptions) {}

	resetRuntimeState(): void {

		this.resetCurrentSessionCalibrationState();

	}

	syncState(override?: Partial<MarkerCalibrationState>): void {

		const currentState = this.options.store.getState().markerCalibration;
		const markerId = override?.markerId
			?? currentState.markerId
			?? this.options.getPrimaryConfiguredMarkerPose()?.markerId
			?? null;
		const capturedCornerCount = override?.capturedCornerCount ?? this.currentSessionMarkerCornerCaptures.length;
		const expectedCornerCount = override?.expectedCornerCount ?? MARKER_CORNER_SEQUENCE.length;
		const nextCornerLabel = override?.nextCornerLabel
			?? MARKER_CORNER_SEQUENCE[ Math.min( capturedCornerCount, MARKER_CORNER_SEQUENCE.length - 1 ) ]?.label
			?? '';
		const solved = override?.solved ?? ( this.currentSessionMarkerSolution !== null );
		const applied = override?.applied ?? this.options.hasAppliedMarkerSolutionForCurrentSession();

		this.options.store.patch( {
			markerCalibration: {
				currentSessionId: override?.currentSessionId ?? this.options.getCurrentSessionId(),
				debugOnlySavedResultAvailable: override?.debugOnlySavedResultAvailable
					?? this.options.store.getState().savedMarkerLocalization.available,
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
				lastUpdatedAt: override?.lastUpdatedAt ?? Date.now()
			}
		} );

	}

	startCurrentSessionCalibration(): void {

		if ( this.options.isPresenting() === false ) {
			this.options.setStatus( '请先进入当前 AR 会话，再开始 Marker 校正。' );
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

		this.options.markManualCalibrationStarted();
		this.currentSessionMarkerCornerCaptures = [];
		this.currentSessionMarkerSolution = null;
		this.syncState( {
			currentSessionId,
			markerId: markerPose.markerId,
			markerConfigId: markerPose.markerId,
			active: true,
			capturedCornerCount: 0,
			expectedCornerCount: MARKER_CORNER_SEQUENCE.length,
			nextCornerLabel: MARKER_CORNER_SEQUENCE[ 0 ].label,
			corners: [],
			canCapture: true,
			canSolve: false,
			solved: false,
			applied: this.options.hasAppliedMarkerSolutionForCurrentSession(),
			rmsErrorMeters: undefined,
			headingDeg: undefined,
			lastUpdatedAt: Date.now()
		} );

		const message = this.options.getWorkflowMode() === 'ar-inspection'
			? '请按顺序采集控制标志四个角点：leftTop 左上角 -> rightTop 右上角 -> rightBottom 右下角 -> leftBottom 左下角。'
			: `Marker 校正已开始，请依次采集 ${MARKER_CORNER_SEQUENCE.map( ( item ) => item.label ).join( '、' )}。`;
		this.options.setStatus( message );
		this.logManualCornerStep( 'manual-corners-started', markerPose.markerId, message );

		console.info(
			this.options.getWorkflowMode() === 'ar-inspection'
				? '[ArInspectionMarkerManualStarted]'
				: '[SiteBaselineConfigTargetObserved]',
			{
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: currentSessionId,
				source: 'marker',
				targetId: markerPose.markerId,
				createdAt: Date.now(),
				trackingState: 'manual-corners-started',
				stableFrameCount: 0
			}
		);

		console.info( '[MarkerSessionCalibrationStarted]', {
			mode: MARKER_CALIBRATION_MODE,
			sessionId: currentSessionId,
			markerId: markerPose.markerId
		} );
		console.info( '[ManualMarkerCalibrationStarted]', this.createLogPayload( {
			targetId: markerPose.markerId,
			currentCorner: MARKER_CORNER_SEQUENCE[ 0 ].label,
			capturedPointCount: 0
		} ) );
		console.info( '[CurrentSessionMarkerCalibrationStarted]', this.createLogPayload( {
			targetId: markerPose.markerId,
			currentCorner: MARKER_CORNER_SEQUENCE[ 0 ].label,
			capturedPointCount: 0,
			pointLabel: MARKER_CORNER_SEQUENCE[ 0 ].pointLabel
		} ) );
		console.info( '[ManualMarkerCornerCaptureStarted]', this.createLogPayload( {
			targetId: markerPose.markerId,
			currentCorner: MARKER_CORNER_SEQUENCE[ 0 ].label,
			capturedPointCount: 0,
			pointLabel: MARKER_CORNER_SEQUENCE[ 0 ].pointLabel
		} ) );

	}

	captureCurrentSessionMarkerCorner(): void {

		if ( this.options.isPresenting() === false ) {
			this.options.setStatus( '请先进入当前 AR 会话，再采集 Marker 角点。' );
			return;
		}

		const markerState = this.options.store.getState().markerCalibration;
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

		if ( this.currentSessionMarkerCornerCaptures.length >= MARKER_CORNER_SEQUENCE.length ) {
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

		const cornerMeta = MARKER_CORNER_SEQUENCE[ this.currentSessionMarkerCornerCaptures.length ];
		this.currentSessionMarkerCornerCaptures.push( {
			id: cornerMeta.id,
			label: cornerMeta.label,
			arPosition: arPosition.clone()
		} );
		this.currentSessionMarkerSolution = null;
		this.syncState();

		console.info( '[MarkerSessionCornerCaptured]', {
			mode: MARKER_CALIBRATION_MODE,
			sessionId: currentSessionId,
			markerId: markerState.markerId,
			cornerId: cornerMeta.id,
			cornerLabel: cornerMeta.label,
			pointLabel: cornerMeta.pointLabel,
			shortPointLabel: cornerMeta.shortPointLabel,
			arLocalPosition: vector3ToObject( arPosition ),
			arPosition: vector3ToObject( arPosition ),
			hitTestReady: this.options.hasGroundHit()
		} );
		const capturedIndex = this.currentSessionMarkerCornerCaptures.length - 1;
		const captureTarget = this.options.getControlTargets()
			.find( ( target ) => target.id === markerState.markerId || target.markerId === markerState.markerId );
		console.info( '[MarkerCornerCaptured]', {
			controlTargetId: captureTarget?.id ?? markerState.markerId,
			capturedIndex,
			expectedCornerName: cornerMeta.cornerOrderValue,
			expectedCornerEnu: captureTarget?.cornersEnu?.[ capturedIndex ] ?? null,
			capturedArPosition: vector3ToObject( arPosition ),
			capturedCount: this.currentSessionMarkerCornerCaptures.length,
			expectedCount: MARKER_CORNER_SEQUENCE.length,
			cornerOrder: captureTarget?.cornerOrder ?? null
		} );
		console.info( '[MarkerCornerCaptureHitTestCheck]', createMarkerCornerCaptureHitTestPayload( {
			capturedIndex,
			expectedCornerName: cornerMeta.cornerOrderValue,
			hitPosition: arPosition,
			capturedCornersAr: this.currentSessionMarkerCornerCaptures.map( ( item ) => item.arPosition )
		} ) );
		console.info( '[MarkerCornersArCaptured]', {
			mode: MARKER_CALIBRATION_MODE,
			workflowMode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			sessionId: currentSessionId,
			targetId: markerState.markerId,
			cornerId: cornerMeta.id,
			pointLabel: cornerMeta.pointLabel,
			shortPointLabel: cornerMeta.shortPointLabel,
			capturedCornerCount: this.currentSessionMarkerCornerCaptures.length,
			expectedCornerCount: MARKER_CORNER_SEQUENCE.length,
			arLocalPosition: vector3ToObject( arPosition ),
			arPosition: vector3ToObject( arPosition ),
			hitTestReady: this.options.hasGroundHit(),
			createdAt: Date.now()
		} );
		console.info( '[ManualMarkerCornerCaptured]', this.createLogPayload( {
			targetId: markerState.markerId,
			currentCorner: cornerMeta.label,
			capturedPointCount: this.currentSessionMarkerCornerCaptures.length,
			pointLabel: cornerMeta.pointLabel,
			arLocalPosition: arPosition
		} ) );

		const nextCorner = MARKER_CORNER_SEQUENCE[ this.currentSessionMarkerCornerCaptures.length ];
		const message = nextCorner !== undefined
			? `已采集 ${cornerMeta.label}，请采集控制标志 ${nextCorner.label}。`
			: '四角点已采集完成，请点击完成空间校正。';
		if ( nextCorner === undefined ) {
			console.info( '[ManualMarkerCornersReady]', this.createLogPayload( {
				targetId: markerState.markerId,
				currentCorner: cornerMeta.label,
				capturedPointCount: this.currentSessionMarkerCornerCaptures.length,
				pointLabel: cornerMeta.pointLabel,
				arLocalPosition: arPosition
			} ) );
		}
		this.options.setStatus( message );
		this.logManualCornerStep( cornerMeta.id, markerState.markerId, message );

	}

	resetCurrentSessionCalibration(): void {

		this.resetCurrentSessionCalibrationState();
		this.options.setStatus( '当前会话 Marker 角点采集已重置。' );

	}

	solveAndApplyCurrentSessionCalibration(): boolean {

		if ( this.options.isPresenting() === false ) {
			this.options.setStatus( '请先进入当前 AR 会话，再应用 Marker 校正。' );
			return false;
		}

		const demoModelConfig = this.options.getDemoModelConfig();
		if ( demoModelConfig === null ) {
			this.options.setStatus( '模型配置尚未准备完成，无法执行 Marker 校正。' );
			return false;
		}

		const currentSessionId = this.options.getCurrentSessionId();
		if ( currentSessionId === null ) {
			this.options.setStatus( '当前 AR Session 尚未准备完成，请重新开始。' );
			return false;
		}

		const markerState = this.options.store.getState().markerCalibration;
		const markerId = markerState.markerId ?? this.options.getPrimaryConfiguredMarkerPose()?.markerId ?? null;
		if ( markerId === null ) {
			this.options.setStatus( '当前模型没有可用于 Marker 校正的控制标志配置。' );
			return false;
		}

		if ( markerState.currentSessionId !== currentSessionId ) {
			this.options.setStatus( '当前 Marker 角点采集属于旧会话，请重新开始。' );
			this.resetCurrentSessionCalibrationState();
			return false;
		}

		if ( this.currentSessionMarkerCornerCaptures.length !== MARKER_CORNER_SEQUENCE.length ) {
			this.options.setStatus( '四角点数量不足，无法求解空间校正。' );
			return false;
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
			if ( expectedCorners.length !== MARKER_CORNER_SEQUENCE.length ) {
				throw new Error( '当前控制标志四角点工程坐标数量不是 4，无法完成四角点校正。' );
			}
			console.info( '[MarkerCornersEnuResolved]', {
				mode: MARKER_CALIBRATION_MODE,
				workflowMode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				modelId: demoModelConfig.modelId,
				sessionId: currentSessionId,
				targetId: markerId,
				controlTargetId: markerControlTarget.id,
				cornerOrder: markerControlTarget.cornerOrder,
				cornerCount: expectedCorners.length,
				cornersEnu: markerControlTarget.cornersEnu,
				corners: expectedCorners.map( ( item ) => ( {
					id: item.id,
					position: vector3ToObject( item.position )
				} ) ),
				capturedCornersAr: this.currentSessionMarkerCornerCaptures.map( ( item ) => ( {
					id: item.id,
					label: item.label,
					position: vector3ToObject( item.arPosition )
				} ) ),
				solveStatus: 'ready',
				createdAt: Date.now()
			} );

			const correspondences = MARKER_CORNER_SEQUENCE.map( ( cornerMeta ) => {
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
			console.info( '[ManualMarkerLocalizationSolving]', this.createLogPayload( {
				targetId: markerId,
				currentCorner: MARKER_CORNER_SEQUENCE[ MARKER_CORNER_SEQUENCE.length - 1 ].label,
				capturedPointCount: correspondences.length,
				cornersEnu: markerControlTarget.cornersEnu
			} ) );
			console.info( '[MarkerCalibrationCorrespondenceCheck]', createMarkerCalibrationCorrespondencePayload( {
				controlTarget: markerControlTarget,
				capturedArPoints: this.currentSessionMarkerCornerCaptures.map( ( item ) => item.arPosition )
			} ) );

			const solution = solveMarkerLocalization( {
				correspondences,
				sessionId: currentSessionId,
				timestamp: Date.now()
			} );
			this.currentSessionMarkerSolution = solution;
			const selfCheck = createArFromEnuSelfCheckPayload( {
				correspondences,
				solution
			} );
			console.info( '[ArFromEnuSelfCheck]', selfCheck );
			const calibrationPayload = createArFromEnuCalibrationSolvedPayload( {
				modelId: demoModelConfig.modelId,
				configUrl: this.options.getConfigUrl(),
				siteOrigin: demoModelConfig.siteFrame.origin,
				controlTarget: markerControlTarget,
				capturedCornersAr: this.currentSessionMarkerCornerCaptures.map( ( item ) => item.arPosition ),
				correspondences,
				solution,
				selfCheck
			} );
			console.info( '[ArFromEnuCalibrationSolved]', calibrationPayload );
			if ( selfCheck.maxErrorMeters > MARKER_SELF_CHECK_MAX_ERROR_METERS ) {
				throw new Error(
					`Marker 自检误差 ${selfCheck.maxErrorMeters.toFixed( 3 )}m 超过 ${MARKER_SELF_CHECK_MAX_ERROR_METERS.toFixed( 2 )}m，请重新采集三角桶底座落地点四角。`
				);
			}

			console.info( '[MarkerSessionCalibrationSolved]', {
				mode: MARKER_CALIBRATION_MODE,
				workflowMode: this.options.getWorkflowMode(),
				sessionId: currentSessionId,
				markerId,
				controlTargetId: markerControlTarget.id,
				cornerOrder: markerControlTarget.cornerOrder,
				cornersEnu: markerControlTarget.cornersEnu,
				capturedCornersAr: this.currentSessionMarkerCornerCaptures.map( ( item ) => ( {
					id: item.id,
					label: item.label,
					position: vector3ToObject( item.arPosition )
				} ) ),
				solveStatus: 'solved',
				correspondenceCount: solution.correspondenceCount,
				rmsErrorMeters: solution.rmsErrorMeters,
				residualMeters: solution.rmsErrorMeters,
				maxErrorMeters: null,
				scale: 1,
				headingDeg: solution.headingDeg,
				rotation: solution.orientation.toArray(),
				siteOriginArPosition: vector3ToObject( solution.siteOriginArPosition ),
				matrix: solution.matrix.toArray()
			} );

			this.syncState( {
				solved: true,
				applied: false,
				rmsErrorMeters: solution.rmsErrorMeters,
				headingDeg: solution.headingDeg,
				lastUpdatedAt: Date.now()
			} );

			const applied = this.options.applyCurrentSessionMarkerSolution( solution, {
				markerId,
				markerConfigId: markerId,
				capturedCornersAr: this.currentSessionMarkerCornerCaptures.map( ( item ) => item.arPosition.clone() )
			} );
			if ( applied ) {
				console.info( '[MarkerLocalizationApplied]', {
					mode: this.options.getWorkflowMode(),
					calibrationMode: MARKER_CALIBRATION_MODE,
					siteId: this.options.getSiteId(),
					sessionId: currentSessionId,
					targetId: markerId,
					source: solution.arFromEnuSolution.source,
					rmsErrorMeters: solution.rmsErrorMeters,
					headingDeg: solution.headingDeg,
					createdAt: Date.now()
				} );
				console.info( '[ManualMarkerLocalizationApplied]', this.createLogPayload( {
					targetId: markerId,
					currentCorner: null,
					capturedPointCount: this.currentSessionMarkerCornerCaptures.length,
					localizationReady: true,
					cornersEnu: markerControlTarget.cornersEnu
				} ) );
				this.syncState( {
					active: false,
					solved: true,
					applied: true,
					canCapture: false,
					canSolve: false,
					rmsErrorMeters: solution.rmsErrorMeters,
					headingDeg: solution.headingDeg,
					lastUpdatedAt: Date.now()
				} );
			}

			return applied;
		} catch ( error ) {
			console.error( '[MarkerSessionCalibrationSolveFailed]', {
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
			return false;
		}

	}

	private resetCurrentSessionCalibrationState(): void {

		this.currentSessionMarkerCornerCaptures = [];
		this.currentSessionMarkerSolution = null;
		this.options.store.patch( {
			markerCalibration: {
				...createDefaultMarkerCalibrationState(),
				currentSessionId: this.options.getCurrentSessionId(),
				debugOnlySavedResultAvailable: this.options.store.getState().savedMarkerLocalization.available,
				markerId: this.options.getPrimaryConfiguredMarkerPose()?.markerId ?? null,
				markerConfigId: this.options.getPrimaryConfiguredMarkerPose()?.markerId ?? null
			}
		} );

	}

	private logManualCornerStep(currentStep: string, targetId: string | null, message: string): void {

		console.info( '[ArUiManualCornerStepChanged]', {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			modelId: this.options.getDemoModelConfig()?.modelId ?? null,
			sessionId: this.options.getCurrentSessionId(),
			currentStep,
			localizationSource: 'marker',
			targetId,
			message,
			createdAt: Date.now()
		} );

	}

	private createLogPayload(args: {
		targetId: string | null;
		currentCorner: string | null;
		capturedPointCount: number;
		localizationReady?: boolean;
		pointLabel?: string | null;
		arLocalPosition?: THREE.Vector3 | null;
		cornersEnu?: VisualControlTarget['cornersEnu'] | null;
	}): Record<string, unknown> {

		const config = this.options.getDemoModelConfig();
		const target = this.options.getControlTargets()
			.find( ( item ) => item.id === args.targetId || item.markerId === args.targetId );
		return {
			mode: MARKER_CALIBRATION_MODE,
			workflowMode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			modelId: config?.modelId ?? null,
			sessionId: this.options.getCurrentSessionId(),
			targetId: args.targetId,
			currentCorner: args.currentCorner,
			pointLabel: args.pointLabel ?? null,
			capturedPointCount: args.capturedPointCount,
			arLocalPosition: args.arLocalPosition === undefined || args.arLocalPosition === null
				? null
				: vector3ToObject( args.arLocalPosition ),
			cornersEnu: args.cornersEnu ?? target?.cornersEnu ?? null,
			source: 'marker',
			hasSiteOrigin: config !== null,
			hasModelLocalToEnu: config !== null,
			modelLocalToEnuSource: config === null
				? 'missing'
				: config.configCompleteness.hasExplicitModelLocalToEnu ? 'explicit' : 'control-points',
			hasCornersEnu: target?.cornersEnu !== undefined,
			hasRtkSurveyDataset: ( config?.rtkSurveyDataset?.points.length ?? 0 ) > 0,
			hitTestReady: this.options.hasGroundHit(),
			localizationReady: args.localizationReady ?? this.options.hasAppliedMarkerSolutionForCurrentSession(),
			modelPlaced: this.options.hasAppliedMarkerSolutionForCurrentSession(),
			createdAt: Date.now()
		};

	}

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
		if (
			normalizedOrder.length !== EXPECTED_MARKER_CORNER_ORDER.length
			|| normalizedOrder.some( ( value, index ) => value !== EXPECTED_MARKER_CORNER_ORDER[ index ] )
		) {
			return '控制标志 cornerOrder 必须为 leftTop、rightTop、rightBottom、leftBottom，且与采集顺序一致。';
		}
	}

	return null;

}

function createMarkerCornerCaptureHitTestPayload(args: {
	capturedIndex: number;
	expectedCornerName: string;
	hitPosition: THREE.Vector3;
	capturedCornersAr: THREE.Vector3[];
}): Record<string, unknown> {

	const firstY = args.capturedCornersAr[ 0 ]?.y ?? args.hitPosition.y;
	const averageY = args.capturedCornersAr.reduce( ( total, point ) => total + point.y, 0 )
		/ Math.max( args.capturedCornersAr.length, 1 );
	const maxHeightDelta = args.capturedCornersAr.reduce(
		(max, point) => Math.max( max, Math.abs( point.y - firstY ) ),
		0
	);
	const warnings: string[] = [];
	if ( maxHeightDelta > MARKER_CAPTURE_HEIGHT_WARNING_METERS ) {
		warnings.push( `captured corner height delta ${maxHeightDelta.toFixed( 3 )}m exceeds ${MARKER_CAPTURE_HEIGHT_WARNING_METERS}m` );
	}
	if ( args.capturedCornersAr.length < MARKER_CORNER_SEQUENCE.length ) {
		warnings.push( 'partial capture; height check is provisional' );
	}

	return {
		capturedIndex: args.capturedIndex,
		expectedCornerName: args.expectedCornerName,
		hitPosition: vector3ToObject( args.hitPosition ),
		hitNormal: null,
		hitDistanceToCamera: null,
		heightRelativeToFirstCorner: Number( ( args.hitPosition.y - firstY ).toFixed( 6 ) ),
		heightRelativeToAverage: Number( ( args.hitPosition.y - averageY ).toFixed( 6 ) ),
		maxHeightDeltaMeters: Number( maxHeightDelta.toFixed( 6 ) ),
		isGroundLike: maxHeightDelta <= MARKER_CAPTURE_HEIGHT_WARNING_METERS,
		captureHint: '请采集三角桶底座落地点四角，不要点桶身或视觉边缘。',
		warnings
	};

}

function createArFromEnuSelfCheckPayload(args: {
	correspondences: Array<{
		id: string;
		siteEnu: THREE.Vector3;
		arPosition: THREE.Vector3;
	}>;
	solution: MarkerLocalizationSolution;
}): {
	points: Array<Record<string, unknown>>;
	maxErrorMeters: number;
	rmsErrorMeters: number;
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
	const warnings: string[] = [];
	if ( maxErrorMeters > MARKER_SELF_CHECK_MAX_ERROR_METERS ) {
		warnings.push( `max marker self-check error ${maxErrorMeters.toFixed( 3 )}m exceeds ${MARKER_SELF_CHECK_MAX_ERROR_METERS}m` );
	}
	return {
		points,
		maxErrorMeters: Number( maxErrorMeters.toFixed( 6 ) ),
		rmsErrorMeters: Number( rmsErrorMeters.toFixed( 6 ) ),
		warnings
	};

}

function createArFromEnuCalibrationSolvedPayload(args: {
	modelId: string;
	configUrl: string | null;
	siteOrigin: unknown;
	controlTarget: VisualControlTarget;
	capturedCornersAr: THREE.Vector3[];
	correspondences: Array<{
		id: string;
		siteEnu: THREE.Vector3;
		arPosition: THREE.Vector3;
	}>;
	solution: MarkerLocalizationSolution;
	selfCheck: {
		points: Array<Record<string, unknown>>;
		maxErrorMeters: number;
		rmsErrorMeters: number;
		warnings: string[];
	};
}): Record<string, unknown> {

	const cornersEnu = args.controlTarget.cornersEnu ?? [];
	const enuQuad = computeQuadDiagnostics( cornersEnu );
	const arQuad = computeQuadDiagnostics( args.capturedCornersAr );
	const arHeightValues = args.capturedCornersAr.map( ( point ) => point.y );
	const arHeightDelta = arHeightValues.length === 0
		? 0
		: Math.max( ...arHeightValues ) - Math.min( ...arHeightValues );
	const scaleRatio = average( arQuad.sideLengths ) / Math.max( average( enuQuad.sideLengths ), 1e-9 );
	const warnings = [
		...enuQuad.warnings.map( ( warning ) => `enu: ${warning}` ),
		...arQuad.warnings.map( ( warning ) => `ar: ${warning}` ),
		...args.selfCheck.warnings
	];
	if ( arHeightDelta > MARKER_CAPTURE_HEIGHT_WARNING_METERS ) {
		warnings.push( `captured AR corner height delta ${arHeightDelta.toFixed( 3 )}m exceeds ${MARKER_CAPTURE_HEIGHT_WARNING_METERS}m` );
	}
	if ( Math.abs( scaleRatio - 1 ) > 0.25 ) {
		warnings.push( `marker ENU/AR side length scale ratio ${scaleRatio.toFixed( 3 )} differs from rigid expectation` );
	}

	return {
		modelId: args.modelId,
		configUrl: args.configUrl,
		siteOrigin: args.siteOrigin,
		controlTargetId: args.controlTarget.id,
		controlTarget: {
			id: args.controlTarget.id,
			centerEnu: args.controlTarget.centerEnu ?? null,
			cornersEnu: args.controlTarget.cornersEnu ?? null,
			order: args.controlTarget.cornerOrder ?? null
		},
		cornerOrder: args.controlTarget.cornerOrder ?? null,
		capturedCornersAr: args.capturedCornersAr.map( vector3ToObject ),
		correspondences: args.correspondences.map( ( correspondence, index ) => ( {
			index,
			id: correspondence.id,
			siteEnu: vector3ToObject( correspondence.siteEnu ),
			arPosition: vector3ToObject( correspondence.arPosition )
		} ) ),
		solution: {
			position: vector3ToObject( args.solution.siteOriginArPosition ),
			siteOriginArPosition: vector3ToObject( args.solution.siteOriginArPosition ),
			orientation: args.solution.orientation.toArray(),
			matrix: args.solution.matrix.toArray()
		},
		residuals: args.selfCheck.points,
		rmsError: args.selfCheck.rmsErrorMeters,
		maxError: args.selfCheck.maxErrorMeters,
		sideLengthsEnu: enuQuad.sideLengths,
		sideLengthsAr: arQuad.sideLengths,
		diagonalLengthsEnu: enuQuad.diagonalLengths,
		diagonalLengthsAr: arQuad.diagonalLengths,
		enuArea: enuQuad.area,
		arArea: arQuad.area,
		scaleRatio: Number( scaleRatio.toFixed( 6 ) ),
		usedRigidOrSimilarity: 'rigid',
		warnings
	};

}

function average(values: number[]): number {

	if ( values.length === 0 ) {
		return 0;
	}
	return values.reduce( ( total, value ) => total + value, 0 ) / values.length;

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
