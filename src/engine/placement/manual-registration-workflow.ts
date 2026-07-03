import * as THREE from 'three';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ManualPlacementBase, ManualRegistrationState, ManualTranslationAxis } from '@/localization/manual/manual-registration.js';
import {
	createManualArSitePoseFromPlacedModel,
	deriveManualRegistrationStateFromArSitePose,
	deserializeManualArSitePose,
	type ManualArSitePose
} from '@/localization/manual/manual-registration-site-pose.js';
import {
	clearManualRegistrationState,
	loadResolvedManualRegistrationState
} from '@/localization/manual/manual-registration-storage.js';
import type { PlacementSession } from './session.js';

interface ManualRegistrationControllerLike {
	setState(
		nextState: ManualRegistrationState,
		options?: { silent?: boolean; statusMessage?: string }
	): ManualRegistrationState;
	adjustTranslation(axis: ManualTranslationAxis, direction: 1 | -1): ManualRegistrationState;
	adjustYaw(direction: 1 | -1): ManualRegistrationState;
	adjustScale(direction: 1 | -1): ManualRegistrationState;
	reset(): ManualRegistrationState;
	hasAdjustments(): boolean;
	applyToPlacement(
		base: ManualPlacementBase,
		targetPosition: THREE.Vector3,
		targetOrientation: THREE.Quaternion
	): { position: THREE.Vector3; orientation: THREE.Quaternion; scale: number };
}

interface ManualRegistrationWorkflowOptions {
	placementSession: PlacementSession;
	manualRegistration: ManualRegistrationControllerLike;
	getWorkflowMode(): ArWorkflowMode;
	getCurrentSessionId(): string | null;
	getSiteId(): string | null;
	getModelTemplate(): THREE.Group | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getManualPositionTarget(): THREE.Vector3;
	getManualOrientationTarget(): THREE.Quaternion;
	isPresenting(): boolean;
	setStatus(message: string): void;
	syncRegistrationChainDebug(): void;
	applyModelLayerVisibility(): void;
	syncArSessionPhase(): void;
	syncSceneHost(): void;
	emit(): void;
	markPlacementCommitted(committed?: boolean): void;
}

export class ManualRegistrationWorkflow {

	private activeSitePose: ManualArSitePose | null = null;
	private hasRestoredSitePoseFlag = false;

	constructor(private readonly options: ManualRegistrationWorkflowOptions) {}

	resetRuntimeState(): void {

		this.activeSitePose = null;
		this.hasRestoredSitePoseFlag = false;
		this.options.manualRegistration.setState( createDefaultManualRegistrationState(), { silent: true } );
		this.options.syncRegistrationChainDebug();

	}

	loadManualRegistration(modelId: string): void {

		const savedState = loadResolvedManualRegistrationState( modelId );
		if ( savedState !== null ) {
			const rejectedSitePose = deserializeManualArSitePose( savedState );
			console.warn( '[CrossSessionSolutionRejected]', {
				mode: this.options.getWorkflowMode(),
				siteId: modelId,
				sessionId: this.options.getCurrentSessionId(),
				source: 'manual-site-pose',
				targetId: null,
				createdAt: rejectedSitePose.updatedAt,
				trackingState: 'legacy-storage',
				stableFrameCount: 0
			} );
			if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
				console.info( '[ArInspectionSkippedOldArLocalSolution]', {
					mode: this.options.getWorkflowMode(),
					siteId: modelId,
					sessionId: this.options.getCurrentSessionId(),
					source: 'manual-site-pose',
					targetId: null,
					createdAt: rejectedSitePose.updatedAt,
					trackingState: 'legacy-storage',
					stableFrameCount: 0
				} );
			}
		}

		this.resetRuntimeState();

	}

	syncForHeading(headingDeg: number): void {

		const registrationSolution = this.options.getRegistrationSolution();
		if ( registrationSolution === null || this.activeSitePose === null ) {
			return;
		}

		this.options.manualRegistration.setState(
			deriveManualRegistrationStateFromArSitePose( {
				sitePose: this.activeSitePose,
				registrationSolution,
				placementHeadingDeg: headingDeg
			} ),
			{ silent: true }
		);

	}

	refreshActiveSitePose(): void {

		const registrationSolution = this.options.getRegistrationSolution();
		if ( registrationSolution === null ) {
			return;
		}

		const placedModel = this.options.placementSession.getPlacedModel();
		const placementBase = this.options.placementSession.getPlacementBase();
		if ( placedModel === null || placementBase === null ) {
			return;
		}

		const sitePose = createManualArSitePoseFromPlacedModel( {
			placedModel,
			placementBase,
			registrationSolution
		} );
		if ( sitePose === null ) {
			this.options.syncRegistrationChainDebug();
			return;
		}

		this.activeSitePose = cloneManualArSitePose( sitePose );
		this.options.syncRegistrationChainDebug();

	}

	clearActiveSitePose(): void {

		this.activeSitePose = null;
		this.hasRestoredSitePoseFlag = false;
		this.options.syncRegistrationChainDebug();

	}

	canUseManualRegistration(): boolean {

		return this.options.placementSession.getPlacedModel() !== null;

	}

	hasActiveSitePose(): boolean {

		return this.activeSitePose !== null;

	}

	getActiveSitePose(): ManualArSitePose | null {

		return this.activeSitePose;

	}

	hasRestoredSitePose(): boolean {

		return this.hasRestoredSitePoseFlag;

	}

	adjustTranslation(axis: ManualTranslationAxis, direction: 1 | -1): void {

		if ( this.canUseManualRegistration() === false ) {
			this.options.setStatus( '请先完成模型放置，再进行手动微调。' );
			return;
		}

		this.options.manualRegistration.adjustTranslation( axis, direction );
		this.reapplyPlacement();

	}

	adjustYaw(direction: 1 | -1): void {

		if ( this.canUseManualRegistration() === false ) {
			this.options.setStatus( '请先完成模型放置，再进行手动微调。' );
			return;
		}

		this.options.manualRegistration.adjustYaw( direction );
		this.reapplyPlacement();

	}

	adjustScale(direction: 1 | -1): void {

		if ( this.canUseManualRegistration() === false ) {
			this.options.setStatus( '请先完成模型放置，再进行手动微调。' );
			return;
		}

		this.options.manualRegistration.adjustScale( direction );
		this.reapplyPlacement();

	}

	saveCurrentRegistration(): void {

		if ( this.canUseManualRegistration() === false ) {
			this.options.setStatus( '请先完成模型放置，再保存手动微调。' );
			return;
		}

		this.refreshActiveSitePose();
		const sitePose = this.activeSitePose;
		if ( sitePose === null ) {
			this.options.setStatus( '当前配准结果缺少现场定位基础，暂时无法保存。' );
			return;
		}

		this.activeSitePose = cloneManualArSitePose( sitePose );
		this.hasRestoredSitePoseFlag = false;
		this.options.setStatus( '当前会话手动场景定位已更新，仅对本次 AR 会话有效，不会写入现场基准。' );
		this.options.syncRegistrationChainDebug();

	}

	resetManualRegistration(): void {

		if ( this.canUseManualRegistration() === false ) {
			this.options.setStatus( '当前还没有可用的微调结果。' );
			return;
		}

		const siteId = this.options.getSiteId();
		if ( siteId !== null ) {
			clearManualRegistrationState( siteId );
		}

		this.activeSitePose = null;
		this.hasRestoredSitePoseFlag = false;
		this.options.manualRegistration.reset();
		this.reapplyPlacement();
		this.options.setStatus( '手动微调已重置。' );

	}

	clearSavedRegistration(): boolean {

		const siteId = this.options.getSiteId();
		if ( siteId === null ) {
			this.options.setStatus( '模型元数据尚未准备完成。' );
			return false;
		}

		clearManualRegistrationState( siteId );
		this.activeSitePose = null;
		this.hasRestoredSitePoseFlag = false;
		this.options.manualRegistration.reset();
		this.reapplyPlacement();
		this.options.setStatus( '已清除保存的配准结果。' );
		return true;

	}

	reapplyPlacement(): void {

		this.options.placementSession.reapplyManualRegistration( {
			modelTemplate: this.options.getModelTemplate(),
			registrationSolution: this.options.getRegistrationSolution(),
			manualApplyToPlacement: this.options.manualRegistration.applyToPlacement,
			manualPositionTarget: this.options.getManualPositionTarget(),
			manualOrientationTarget: this.options.getManualOrientationTarget()
		} );
		this.refreshActiveSitePose();
		this.options.applyModelLayerVisibility();

		if ( this.options.isPresenting() && this.options.placementSession.getPlacedModel() !== null ) {
			this.options.markPlacementCommitted( true );
		}

		this.options.syncArSessionPhase();
		this.options.syncSceneHost();
		this.options.emit();

	}

}

function createDefaultManualRegistrationState(): ManualRegistrationState {

	return {
		offset: new THREE.Vector3(),
		yawDeg: 0,
		scaleMultiplier: 1
	};

}

function cloneManualArSitePose(
	sitePose: ManualArSitePose
): ManualArSitePose {

	return {
		rootSiteEnu: sitePose.rootSiteEnu.clone(),
		rootWorldGeodetic: { ...sitePose.rootWorldGeodetic },
		rootYawDeg: sitePose.rootYawDeg,
		scaleMultiplier: sitePose.scaleMultiplier,
		updatedAt: sitePose.updatedAt
	};

}
