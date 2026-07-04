import * as THREE from 'three';
import {
	createDefaultEngineeringConfigStatusState,
	createDefaultRegistrationMetricsState,
	createDefaultSavedMarkerLocalizationState,
	createDefaultSiteCalibrationBaselineState,
	type MarkerCalibrationState,
	type RegistrationStore
} from '@/localization/core/registration-store.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import {
	loadLastStableMarkerLocalizationResult,
	type SavedMarkerLocalizationResult
} from '@/localization/marker/marker-localization-storage.js';
import type { MarkerPoseInEnu } from '@/localization/marker/marker-localization.js';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import type {
	ArWorkflowMode,
	SiteCalibrationBaseline,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';
import { getControlTargetImageUrl, isPattFileUrl } from '@/localization/baseline/site-calibration-baseline.js';
import { formatGeodetic } from '@/features/ar/utils/formatters.js';

interface RegistrationStateRuntimeOptions {
	store: RegistrationStore;
	getWorkflowMode(): ArWorkflowMode;
	getCurrentSessionId(): string | null;
	getDemoModelConfig(): DemoModelConfig | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getResolvedMarkerPosesInEnu(): MarkerPoseInEnu[];
	getActiveMarkerLocalizationResult(): SavedMarkerLocalizationResult | null;
	getActiveMarkerArFromEnuSolutionForCurrentSession(): ArFromEnuSolution | null;
	getActiveArFromEnuSolution(): ArFromEnuSolution | null;
	getActiveSiteCalibrationBaseline(): SiteCalibrationBaseline | null;
	getActiveManualSitePose():
		| {
			rootSiteEnu: THREE.Vector3;
		}
		| null;
	hasActiveManualSitePose(): boolean;
	hasRestoredManualSitePose(): boolean;
	resolveBaselineControlTargets(): VisualControlTarget[];
	syncMarkerCalibrationState(override?: Partial<MarkerCalibrationState>): void;
	setStatus(message: string): void;
}

export class RegistrationStateRuntime {

	constructor(private readonly options: RegistrationStateRuntimeOptions) {}

	syncRegistrationMetrics(): void {

		const currentMetrics = this.options.store.getState().registrationMetrics;
		const demoModelConfig = this.options.getDemoModelConfig();
		const registrationSolution = this.options.getRegistrationSolution();
		if ( demoModelConfig === null || registrationSolution === null ) {
			const nextMetrics = createDefaultRegistrationMetricsState();
			if (
				currentMetrics.gpsText === nextMetrics.gpsText
				&& currentMetrics.enuText === nextMetrics.enuText
				&& currentMetrics.rmsText === nextMetrics.rmsText
				&& currentMetrics.rmsErrorMeters === nextMetrics.rmsErrorMeters
				&& currentMetrics.rmsSource === nextMetrics.rmsSource
			) {
				return;
			}

			this.options.store.patch( { registrationMetrics: nextMetrics } );
			return;
		}

		const activeMarkerSolution = this.options.getActiveMarkerArFromEnuSolutionForCurrentSession();
		const activeMarkerLocalizationResult = this.options.getActiveMarkerLocalizationResult();
		const markerRmsErrorMeters = (
			activeMarkerSolution !== null
			&& typeof activeMarkerLocalizationResult?.rmsErrorMeters === 'number'
			&& Number.isFinite( activeMarkerLocalizationResult.rmsErrorMeters )
		)
			? activeMarkerLocalizationResult.rmsErrorMeters
			: null;
		const currentRmsErrorMeters = markerRmsErrorMeters ?? registrationSolution.modelToSite.rmsErrorMeters;
		const rmsSource: 'engineering' | 'marker' = markerRmsErrorMeters === null ? 'engineering' : 'marker';
		const nextMetrics = {
			gpsText: formatGeodetic(
				demoModelConfig.anchor.lat,
				demoModelConfig.anchor.lon,
				demoModelConfig.anchor.alt
			),
			enuText: formatGeodetic(
				registrationSolution.siteOrigin.lat,
				registrationSolution.siteOrigin.lon,
				registrationSolution.siteOrigin.alt
			),
			rmsText: `${currentRmsErrorMeters.toFixed( 3 )} m`,
			rmsErrorMeters: currentRmsErrorMeters,
			rmsSource
		};

		if (
			currentMetrics.gpsText === nextMetrics.gpsText
			&& currentMetrics.enuText === nextMetrics.enuText
			&& currentMetrics.rmsText === nextMetrics.rmsText
			&& currentMetrics.rmsErrorMeters === nextMetrics.rmsErrorMeters
			&& currentMetrics.rmsSource === nextMetrics.rmsSource
		) {
			return;
		}

		this.options.store.patch( { registrationMetrics: nextMetrics } );

	}

	syncRegistrationChainDebug(): void {

		this.syncRegistrationMetrics();
		this.syncEngineeringConfigStatus();
		const registrationSolution = this.options.getRegistrationSolution();
		const arFromEnuSolution = this.options.getActiveArFromEnuSolution();
		const demoModelConfig = this.options.getDemoModelConfig();
		const resolvedMarkerPosesInEnu = this.options.getResolvedMarkerPosesInEnu();
		const activeManualSitePose = this.options.getActiveManualSitePose();

		this.options.store.patch( {
			registrationChainDebug: {
				engineeringControlRegistration: {
					available: registrationSolution !== null,
					controlPointCount: registrationSolution?.controlPoints.length ?? 0,
					rmsText: registrationSolution === null
						? '-'
						: `${registrationSolution.modelToSite.rmsErrorMeters.toFixed( 3 )}m`,
					usesUnitScaleAndPivotOffset: registrationSolution !== null
				},
				arSessionLocalization: {
					available: arFromEnuSolution !== null,
					source: arFromEnuSolution?.source ?? 'unknown',
					siteOriginArPositionText: arFromEnuSolution === null
						? '-'
						: formatVector3Text( arFromEnuSolution.siteOriginArPosition ),
					headingDegText: arFromEnuSolution === null
						? '-'
						: `${arFromEnuSolution.headingDeg.toFixed( 3 )}deg`
				},
				manualArSitePose: {
					exists: this.options.hasActiveManualSitePose(),
					rootSiteEnuText: activeManualSitePose === null
						? '-'
						: formatVector3Text( activeManualSitePose.rootSiteEnu ),
					restored: this.options.hasRestoredManualSitePose()
				},
				heightPolicy: {
					hitTestGroundYEnabled: true,
					enuGpsVerticalOffsetEnabled: false
				},
				markerEngineering: {
					markerCount: demoModelConfig?.markers.length ?? 0,
					markers: ( demoModelConfig?.markers ?? [] ).map( ( marker ) => ( {
						markerId: marker.id,
						bindControlPointId: marker.bindControlPointId ?? '-',
						sizeMetersText: `${marker.sizeMeters.toFixed( 3 )}m`,
						resolved: resolvedMarkerPosesInEnu.some( ( pose ) => pose.markerId === marker.id )
					} ) )
				}
			}
		} );

	}

	private syncEngineeringConfigStatus(): void {

		const demoModelConfig = this.options.getDemoModelConfig();
		const registrationSolution = this.options.getRegistrationSolution();
		if ( demoModelConfig === null ) {
			this.options.store.patch( {
				engineeringConfigStatus: createDefaultEngineeringConfigStatusState()
			} );
			return;
		}

		const baseline = this.options.getActiveSiteCalibrationBaseline();
		const siteConfigTargets = this.options.resolveBaselineControlTargets();
		const useBaselineTargets = this.options.getWorkflowMode() === 'ar-inspection'
			&& baseline !== null
			&& baseline.controlTargets.length > 0;
		const activeTargets = useBaselineTargets ? baseline.controlTargets : siteConfigTargets;
		const firstTarget = activeTargets[ 0 ];
		const firstImageUrl = firstTarget === undefined ? null : getControlTargetImageUrl( firstTarget );
		const baselineMismatch = baseline !== null
			&& siteConfigTargets.length > 0
			&& areControlTargetsEquivalent( baseline.controlTargets, siteConfigTargets ) === false;
		const controlTargetSource = activeTargets.length === 0
			? 'none'
			: useBaselineTargets ? 'baseline' : 'site-config';
		const controlTargetSourceText = controlTargetSource === 'baseline'
			? '已保存现场基准'
			: controlTargetSource === 'site-config'
				? '模型配置 JSON / 后端配置'
				: '未加载控制标志';

		this.options.store.patch( {
			engineeringConfigStatus: {
				hasSiteOrigin: true,
				hasModelLocalToEnu: registrationSolution !== null,
				hasRtkSurveyDataset: demoModelConfig.rtkSurveyDataset !== undefined
					&& demoModelConfig.rtkSurveyDataset.points.length > 0,
				hasControlTargets: activeTargets.length > 0,
				hasPlacementAnchor: demoModelConfig.placementAnchorEnu !== undefined,
				controlTargetCount: activeTargets.length,
				activeControlTargetId: firstTarget?.id,
				controlTargetSource,
				controlTargetSourceText,
				baselineMismatch,
				rtkPointCount: demoModelConfig.rtkSurveyDataset?.points.length ?? 0,
				undergroundObjectCount: demoModelConfig.undergroundObjects?.length ?? 0,
				sensorCount: demoModelConfig.sensors?.length ?? 0,
				riskPointCount: demoModelConfig.riskPoints?.length ?? 0,
				markerImageReady: firstImageUrl !== null,
				markerImageIssue: resolveMarkerImageIssue( firstTarget ),
				siteOriginText: formatGeodetic(
					demoModelConfig.siteFrame.origin.lat,
					demoModelConfig.siteFrame.origin.lon,
					demoModelConfig.siteFrame.origin.alt
				),
				placementAnchorText: demoModelConfig.placementAnchorEnu === undefined
					? '-'
					: formatTupleText( demoModelConfig.placementAnchorEnu ),
				controlTargetSummaries: activeTargets.map( ( target ) => ( {
					id: target.id,
					name: target.name ?? target.markerId ?? target.id,
					imageUrl: target.imageUrl ?? target.patternUrl ?? '-',
					centerEnuText: formatTupleText( target.centerEnu ),
					cornersEnuText: target.cornersEnu === undefined
						? '未配置，将尝试由 centerEnu + yawDeg + sizeMeters 推算'
						: target.cornersEnu.map( formatTupleText ).join( ' / ' ),
					yawDegText: typeof target.yawDeg === 'number' ? `${target.yawDeg.toFixed( 2 )}deg` : '未配置',
					sizeMetersText: typeof target.sizeMeters === 'number' ? `${target.sizeMeters.toFixed( 3 )}m` : '未配置',
					trackingWidthMetersText: typeof target.trackingWidthMeters === 'number'
						? `${target.trackingWidthMeters.toFixed( 3 )}m`
						: '未配置',
					planeText: target.plane === 'vertical' ? '竖直' : '水平'
				} ) )
			}
		} );

		const eventName = controlTargetSource === 'baseline'
			? 'SiteBaselineControlTargetsUsed'
			: controlTargetSource === 'site-config'
				? 'SiteConfigControlTargetsUsed'
				: 'ArUiConfigStatusResolved';
		console.info( `[${eventName}]`, this.createUiLogPayload( {
			currentStep: 'load-config',
			localizationSource: this.options.getActiveArFromEnuSolution()?.source ?? 'unknown',
			targetId: firstTarget?.id ?? null,
			message: `控制标志来源：${controlTargetSourceText}`
		} ) );

		if ( baselineMismatch ) {
			console.warn( '[SiteBaselineControlTargetsMismatchWarning]', this.createUiLogPayload( {
				currentStep: 'load-config',
				localizationSource: this.options.getActiveArFromEnuSolution()?.source ?? 'unknown',
				targetId: firstTarget?.id ?? null,
				message: '当前已保存现场基准与模型配置可能不一致，请确认是否更新基准配置。'
			} ) );
		}

		console.info( '[ArUiConfigStatusResolved]', this.createUiLogPayload( {
			currentStep: 'load-config',
			localizationSource: this.options.getActiveArFromEnuSolution()?.source ?? 'unknown',
			targetId: firstTarget?.id ?? null,
			message: '工程真值配置状态已解析'
		} ) );

	}

	applySiteCalibrationBaselineState(
		baseline: SiteCalibrationBaseline | null,
		options?: {
			silentStatus?: boolean;
		}
	): SiteCalibrationBaseline | null {

		const siteId = this.options.getDemoModelConfig()?.modelId ?? null;
		if ( baseline === null ) {
			this.options.store.patch( {
				siteCalibrationBaseline: {
					...createDefaultSiteCalibrationBaselineState(),
					statusText: this.options.getWorkflowMode() === 'ar-inspection'
						? '当前站点未加载现场基准'
						: '当前站点还没有保存现场基准'
				}
			} );
			if ( options?.silentStatus !== true && siteId !== null ) {
				this.options.setStatus(
					this.options.getWorkflowMode() === 'ar-inspection'
						? '正在加载现场基准，当前站点尚未保存基准配置。'
						: '当前站点还没有保存现场基准。'
				);
			}
			return null;
		}

		this.options.store.patch( {
			siteCalibrationBaseline: {
				available: true,
				siteId: baseline.siteId,
				source: baseline.source,
				statusText: this.options.getWorkflowMode() === 'ar-inspection'
					? '现场基准已加载'
					: '当前站点已有现场基准',
				controlTargetCount: baseline.controlTargets.length,
				updatedAtText: formatTimestampText( baseline.updatedAt ?? baseline.createdAt )
			}
		} );

		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			for ( const target of baseline.controlTargets ) {
				const imageUrl = getControlTargetImageUrl( target );
				if ( imageUrl === null ) {
					console.warn( '[MarkerImageUrlMissing]', {
						mode: this.options.getWorkflowMode(),
						siteId: baseline.siteId,
						sessionId: this.options.getCurrentSessionId(),
						targetId: target.id,
						imageUrl: target.imageUrl ?? null,
						patternUrl: target.patternUrl ?? null,
						createdAt: Date.now()
					} );
					continue;
				}

				console.info( '[ArSessionUsingBaselineControlTargets]', {
					mode: this.options.getWorkflowMode(),
					siteId: baseline.siteId,
					sessionId: this.options.getCurrentSessionId(),
					targetId: target.id,
					imageUrl,
					patternUrl: target.patternUrl ?? null,
					trackedImagesCount: baseline.controlTargets.length,
					createdAt: Date.now(),
					source: baseline.source,
					invalidPatt: isPattFileUrl( imageUrl )
				} );
			}
		}

		if ( options?.silentStatus !== true && this.options.getWorkflowMode() === 'ar-inspection' ) {
			this.options.setStatus( '正在加载现场基准。' );
		}

		return baseline;

	}

	buildSiteCalibrationBaseline(existingCreatedAt?: number): SiteCalibrationBaseline {

		const demoModelConfig = this.options.getDemoModelConfig();
		if ( demoModelConfig === null ) {
			throw new Error( 'Site config is unavailable.' );
		}

		const now = Date.now();
		return {
			siteId: demoModelConfig.modelId,
			siteOrigin: { ...demoModelConfig.siteFrame.origin },
			modelLocalToEnuVersion: 'engineering-registration-v1',
			controlTargets: this.options.resolveBaselineControlTargets(),
			rtkSurveyDataset: demoModelConfig.rtkSurveyDataset,
			placementAnchorEnu: demoModelConfig.placementAnchorEnu,
			placementAnchorMeaning: demoModelConfig.placementAnchorMeaning,
			undergroundObjects: demoModelConfig.undergroundObjects,
			sensors: demoModelConfig.sensors,
			riskPoints: demoModelConfig.riskPoints,
			createdAt: existingCreatedAt ?? now,
			updatedAt: now,
			source: 'site-baseline-config'
		};

	}

	private createUiLogPayload(args: {
		currentStep: string;
		localizationSource: string;
		targetId: string | null;
		message: string;
	}): {
		mode: ArWorkflowMode;
		siteId: string | null;
		modelId: string | null;
		sessionId: string | null;
		currentStep: string;
		localizationSource: string;
		targetId: string | null;
		message: string;
		createdAt: number;
	} {

		const modelId = this.options.getDemoModelConfig()?.modelId ?? null;
		return {
			mode: this.options.getWorkflowMode(),
			siteId: modelId,
			modelId,
			sessionId: this.options.getCurrentSessionId(),
			currentStep: args.currentStep,
			localizationSource: args.localizationSource,
			targetId: args.targetId,
			message: args.message,
			createdAt: Date.now()
		};

	}

	refreshSavedMarkerLocalizationResult(options?: { silentStatus?: boolean }): void {

		const saved = loadLastStableMarkerLocalizationResult();
		if ( saved === null ) {
			this.options.store.patch( {
				savedMarkerLocalization: createDefaultSavedMarkerLocalizationState()
			} );
			this.options.syncMarkerCalibrationState( {
				debugOnlySavedResultAvailable: false
			} );
			if ( options?.silentStatus !== true ) {
				this.options.setStatus( 'No saved marker localization result found.' );
			}
			return;
		}

		const stability = (
			typeof saved.stabilityReport === 'object'
			&& saved.stabilityReport !== null
			&& 'stable' in saved.stabilityReport
			&& typeof ( saved.stabilityReport as { stable?: unknown } ).stable === 'boolean'
		)
			? ( saved.stabilityReport as { stable: boolean } ).stable
			: undefined;

		this.options.store.patch( {
			savedMarkerLocalization: {
				available: true,
				markerId: saved.markerId,
				markerConfigId: saved.markerConfigId,
				timestamp: saved.timestamp,
				ageSeconds: Math.max( 0, Math.round( ( Date.now() - saved.timestamp ) / 1000 ) ),
				rmsErrorMeters: saved.rmsErrorMeters,
				sampleCount: saved.sampleCount,
				headingDeg: saved.headingDeg,
				siteOriginArPosition: saved.siteOriginArPosition,
				stable: stability
			}
		} );
		this.options.syncMarkerCalibrationState( {
			debugOnlySavedResultAvailable: true
		} );

		if ( options?.silentStatus !== true ) {
			this.options.setStatus( 'Saved marker localization result refreshed.' );
		}

	}

}

function formatVector3Text(vector: THREE.Vector3): string {

	return `${vector.x.toFixed( 3 )}, ${vector.y.toFixed( 3 )}, ${vector.z.toFixed( 3 )}`;

}

function formatTupleText(tuple: [ number, number, number ]): string {

	return `${tuple[ 0 ].toFixed( 3 )}, ${tuple[ 1 ].toFixed( 3 )}, ${tuple[ 2 ].toFixed( 3 )}`;

}

function areControlTargetsEquivalent(
	left: VisualControlTarget[],
	right: VisualControlTarget[]
): boolean {

	if ( left.length !== right.length ) {
		return false;
	}

	return left.every( ( target, index ) => {
		const other = right[ index ];
		if ( other === undefined ) {
			return false;
		}

		return target.id === other.id
			&& ( target.imageUrl ?? target.patternUrl ?? '' ) === ( other.imageUrl ?? other.patternUrl ?? '' )
			&& areEnuTuplesEqual( target.centerEnu, other.centerEnu );
	} );

}

function areEnuTuplesEqual(
	left: [ number, number, number ],
	right: [ number, number, number ]
): boolean {

	return Math.abs( left[ 0 ] - right[ 0 ] ) <= 1e-6
		&& Math.abs( left[ 1 ] - right[ 1 ] ) <= 1e-6
		&& Math.abs( left[ 2 ] - right[ 2 ] ) <= 1e-6;

}

function resolveMarkerImageIssue(target: VisualControlTarget | undefined): string | undefined {

	if ( target === undefined ) {
		return '未配置控制标志';
	}

	const imageUrl = target.imageUrl ?? target.patternUrl;
	if ( typeof imageUrl !== 'string' || imageUrl.trim().length === 0 ) {
		return '当前控制标志未配置可识别图片';
	}

	if ( isPattFileUrl( imageUrl ) ) {
		return '.patt 不能用于 WebXR Image Tracking，请配置 PNG/JPG/WebP 图片';
	}

	if ( getControlTargetImageUrl( target ) === null ) {
		return '控制标志图片格式无效，请配置 PNG/JPG/WebP 图片';
	}

	return undefined;

}

function formatTimestampText(timestamp: number | undefined): string {

	if ( typeof timestamp !== 'number' || Number.isFinite( timestamp ) === false ) {
		return '-';
	}

	return new Date( timestamp ).toLocaleString( 'zh-CN', {
		hour12: false
	} );

}
