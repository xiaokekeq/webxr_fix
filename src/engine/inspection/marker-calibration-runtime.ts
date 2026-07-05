import * as THREE from 'three';
import type {
	MarkerCalibrationState,
	RegistrationStore
} from '@/localization/core/registration-store.js';
import {
	createDefaultMarkerCalibrationState
} from '@/localization/core/registration-store.js';
import {
	createMarkerPoseInEnuFromControlTarget,
	resolveMarkerCornersInEnuFromControlTarget,
	solveMarkerLocalization,
	type MarkerLocalizationSolution,
	type MarkerPoseInEnu
} from '@/localization/marker/marker-localization.js';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import type { XrImageTrackingObservation } from '@/features/ar/types/runtime-types.js';
import type {
	ArWorkflowMode,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';

export const MARKER_CORNER_SEQUENCE = [
	{ id: 'top-left', label: 'leftTop 左上角' },
	{ id: 'top-right', label: 'rightTop 右上角' },
	{ id: 'bottom-right', label: 'rightBottom 右下角' },
	{ id: 'bottom-left', label: 'leftBottom 左下角' }
] as const;

export type MarkerCornerSequenceId = ( typeof MARKER_CORNER_SEQUENCE )[ number ][ 'id' ];

interface MarkerCalibrationRuntimeOptions {
	store: RegistrationStore;
	getWorkflowMode(): ArWorkflowMode;
	getSiteId(): string | null;
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
			source?: 'marker' | 'marker-auto-image';
		}
	): boolean;
	setStatus(message: string): void;
}

const tempMarkerCapturePosition = new THREE.Vector3();
const tempAutoMarkerArPosition = new THREE.Vector3();
const tempAutoMarkerArQuaternion = new THREE.Quaternion();
const tempAutoMarkerArScale = new THREE.Vector3();

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
			sessionId: currentSessionId,
			markerId: markerPose.markerId
		} );

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
			this.options.setStatus( '当前未检测到平面，请先扫描地面或控制标志所在平面。' );
			return;
		}

		const arPosition = this.options.getHitPosition( tempMarkerCapturePosition );
		if ( arPosition === null ) {
			this.options.setStatus( '当前没有可用的 hit-test 位置，请保持控制标志平面处于视野中。' );
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
			sessionId: currentSessionId,
			markerId: markerState.markerId,
			cornerId: cornerMeta.id,
			cornerLabel: cornerMeta.label,
			arPosition: vector3ToObject( arPosition )
		} );
		console.info( '[MarkerCornersArCaptured]', {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			sessionId: currentSessionId,
			targetId: markerState.markerId,
			cornerId: cornerMeta.id,
			capturedCornerCount: this.currentSessionMarkerCornerCaptures.length,
			expectedCornerCount: MARKER_CORNER_SEQUENCE.length,
			arPosition: vector3ToObject( arPosition ),
			createdAt: Date.now()
		} );
		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			console.info( '[ArInspectionMarkerCornerCaptured]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: currentSessionId,
				targetId: markerState.markerId,
				source: 'marker',
				trackingState: cornerMeta.id,
				stableFrameCount: this.currentSessionMarkerCornerCaptures.length,
				hasHitTest: true,
				createdAt: Date.now()
			} );
		}

		const nextCorner = MARKER_CORNER_SEQUENCE[ this.currentSessionMarkerCornerCaptures.length ];
		const message = nextCorner !== undefined
			? `已采集 ${cornerMeta.label}，请采集控制标志 ${nextCorner.label}。`
			: '四角点已采集完成，请点击完成空间校正。';
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
			if ( controlTarget === undefined ) {
				throw new Error( '未找到控制标志配置。' );
			}

			const expectedCorners = resolveMarkerCornersInEnuFromControlTarget( controlTarget );
			console.info( '[MarkerCornersEnuResolved]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				modelId: demoModelConfig.modelId,
				sessionId: currentSessionId,
				targetId: markerId,
				cornerCount: expectedCorners.length,
				corners: expectedCorners.map( ( item ) => ( {
					id: item.id,
					position: vector3ToObject( item.position )
				} ) ),
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

			const solution = solveMarkerLocalization( {
				correspondences,
				sessionId: currentSessionId,
				timestamp: Date.now()
			} );
			this.currentSessionMarkerSolution = solution;

			if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
				console.info( '[ArInspectionMarkerSolved]', {
					mode: this.options.getWorkflowMode(),
					siteId: this.options.getSiteId(),
					sessionId: currentSessionId,
					targetId: markerId,
					source: 'marker',
					trackingState: 'solved',
					stableFrameCount: MARKER_CORNER_SEQUENCE.length,
					hasHitTest: this.options.hasGroundHit(),
					createdAt: Date.now()
				} );
			}

			console.info( '[MarkerSessionCalibrationSolved]', {
				sessionId: currentSessionId,
				markerId,
				correspondenceCount: solution.correspondenceCount,
				rmsErrorMeters: solution.rmsErrorMeters,
				headingDeg: solution.headingDeg,
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
				markerConfigId: markerId
			} );
			if ( applied ) {
				console.info( '[MarkerLocalizationApplied]', {
					mode: this.options.getWorkflowMode(),
					siteId: this.options.getSiteId(),
					sessionId: currentSessionId,
					targetId: markerId,
					source: solution.arFromEnuSolution.source,
					rmsErrorMeters: solution.rmsErrorMeters,
					headingDeg: solution.headingDeg,
					createdAt: Date.now()
				} );
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
			console.error( 'Current-session marker calibration solve failed:', error );
			this.options.setStatus(
				error instanceof Error
					? error.message
					: '空间校正失败，请重新采集控制标志四角。'
			);
			return false;
		}

	}

	solveAndApplyAutoImageCalibration(
		targetId: string,
		observation: XrImageTrackingObservation,
		stableFrameCount: number
	): boolean {

		const currentSessionId = this.options.getCurrentSessionId();
		if ( currentSessionId === null ) {
			return false;
		}

		const controlTarget = this.options.getControlTargets()
			.find( ( item ) => item.id === targetId );
		if ( controlTarget === undefined ) {
			this.startCurrentSessionCalibration();
			this.options.setStatus( '未找到控制标志配置，已切换为手动四角点校正。' );
			return false;
		}

		const markerPoseInEnu = createMarkerPoseInEnuFromControlTarget( controlTarget );

		const markerPoseInAr = {
			markerId: targetId,
			matrix: new THREE.Matrix4().compose(
				tempAutoMarkerArPosition.set(
					observation.position[ 0 ],
					observation.position[ 1 ],
					observation.position[ 2 ]
				),
				tempAutoMarkerArQuaternion.set(
					observation.rotation[ 0 ],
					observation.rotation[ 1 ],
					observation.rotation[ 2 ],
					observation.rotation[ 3 ]
				),
				tempAutoMarkerArScale.set( 1, 1, 1 )
			),
			timestamp: observation.timestamp
		};
		console.info( '[MarkerAutoImagePoseResolved]', {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			modelId: this.options.getDemoModelConfig()?.modelId ?? null,
			sessionId: currentSessionId,
			targetId,
			imageUrl: controlTarget.imageUrl ?? controlTarget.patternUrl ?? null,
			trackingWidthMeters: controlTarget.trackingWidthMeters ?? controlTarget.sizeMeters ?? null,
			measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
			trackingState: observation.trackingState,
			stableFrameCount,
			reason: 'webxr-image-space-pose',
			position: {
				x: observation.position[ 0 ],
				y: observation.position[ 1 ],
				z: observation.position[ 2 ]
			},
			createdAt: observation.timestamp
		} );
		const solution = solveMarkerLocalization( {
			markerId: targetId,
			markerPoseInEnu,
			markerPoseInAr,
			source: 'marker-auto-image',
			sessionId: currentSessionId,
			timestamp: observation.timestamp
		} );
		this.currentSessionMarkerSolution = solution;

		console.info( '[AutoMarkerSolved]', {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			sessionId: currentSessionId,
			targetId,
			source: 'marker-auto-image',
			trackingState: 'solved',
			stableFrameCount,
			hasHitTest: this.options.hasGroundHit(),
			createdAt: observation.timestamp
		} );

		this.syncState( {
			solved: true,
			applied: false,
			rmsErrorMeters: solution.rmsErrorMeters,
			headingDeg: solution.headingDeg,
			lastUpdatedAt: Date.now()
		} );

		const applied = this.options.applyCurrentSessionMarkerSolution( solution, {
			markerId: targetId,
			markerConfigId: targetId,
			source: 'marker-auto-image'
		} );
		if ( applied ) {
			console.info( '[MarkerLocalizationApplied]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: currentSessionId,
				targetId,
				source: solution.arFromEnuSolution.source,
				rmsErrorMeters: solution.rmsErrorMeters,
				headingDeg: solution.headingDeg,
				createdAt: Date.now()
			} );
			console.info( '[MarkerAutoImageLocalizationApplied]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				modelId: this.options.getDemoModelConfig()?.modelId ?? null,
				sessionId: currentSessionId,
				targetId,
				imageUrl: controlTarget.imageUrl ?? controlTarget.patternUrl ?? null,
				trackingWidthMeters: controlTarget.trackingWidthMeters ?? controlTarget.sizeMeters ?? null,
				measuredWidthInMeters: observation.measuredWidthInMeters ?? null,
				trackingState: observation.trackingState,
				stableFrameCount,
				reason: 'localization-applied',
				rmsErrorMeters: solution.rmsErrorMeters,
				headingDeg: solution.headingDeg,
				createdAt: Date.now()
			} );
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
