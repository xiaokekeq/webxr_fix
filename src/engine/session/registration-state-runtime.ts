import * as THREE from 'three';
import {
	createDefaultEngineeringConfigStatusState,
	createDefaultRegistrationMetricsState,
	createDefaultSiteCalibrationBaselineState,
	type MarkerCalibrationState,
	type RegistrationStore
} from '@/localization/core/registration-store.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { MarkerLocalizationResult, MarkerPoseInEnu } from '@/localization/marker/marker-localization.js';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import type {
	ArWorkflowMode,
	SiteCalibrationBaseline,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';
import { formatGeodetic } from '@/features/ar/utils/formatters.js';
import { arWarn } from '@/engine/debug/ar-logger.js';

interface RegistrationStateRuntimeOptions {
	store: RegistrationStore;
	getWorkflowMode(): ArWorkflowMode;
	getCurrentSessionId(): string | null;
	getRepositoryDataSource(): 'local' | 'api';
	getSessionSiteConfig(): DemoModelConfig | null;
	getActiveRuntimeConfig(): DemoModelConfig | null;
	getActiveModelTemplate(): THREE.Object3D | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getResolvedMarkerPosesInEnu(): MarkerPoseInEnu[];
	getActiveMarkerLocalizationResult(): MarkerLocalizationResult | null;
	getActiveMarkerArFromEnuSolutionForCurrentSession(): ArFromEnuSolution | null;
	getActiveArFromEnuSolution(): ArFromEnuSolution | null;
	getActiveSiteCalibrationBaseline(): SiteCalibrationBaseline | null;
	resolveBaselineControlTargets(): VisualControlTarget[];
	syncMarkerCalibrationState(override?: Partial<MarkerCalibrationState>): void;
	setStatus(message: string): void;
}

export class RegistrationStateRuntime {

	private lastEngineeringConfigLogSignature = '';

	constructor(private readonly options: RegistrationStateRuntimeOptions) {}

	syncRegistrationMetrics(): void {

		const currentMetrics = this.options.store.getState().registrationMetrics;
		const demoModelConfig = this.options.getActiveRuntimeConfig();
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
		const demoModelConfig = this.options.getSessionSiteConfig();
		const resolvedMarkerPosesInEnu = this.options.getResolvedMarkerPosesInEnu();

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

		const demoModelConfig = this.options.getSessionSiteConfig();
		const activeRuntimeConfig = this.options.getActiveRuntimeConfig();
		const modelTemplate = this.options.getActiveModelTemplate();
		const registrationSolution = this.options.getRegistrationSolution();
		if ( demoModelConfig === null ) {
			this.options.store.patch( {
				engineeringConfigStatus: createDefaultEngineeringConfigStatusState()
			} );
			return;
		}

		const baseline = this.options.getActiveSiteCalibrationBaseline();
		const siteConfigTargets = this.options.resolveBaselineControlTargets();
		const baselineMatchesSiteConfig = baseline !== null
			&& siteConfigTargets.length > 0
			&& areControlTargetsEquivalent( baseline.controlTargets, siteConfigTargets );
		const useBaselineTargets = this.options.getWorkflowMode() === 'ar-inspection'
			&& baseline !== null
			&& baseline.controlTargets.length > 0
			&& ( siteConfigTargets.length === 0 || baselineMatchesSiteConfig );
		const activeTargets = useBaselineTargets ? baseline.controlTargets : siteConfigTargets;
		const firstTarget = activeTargets[ 0 ];
		const baselineMismatch = baseline !== null
			&& siteConfigTargets.length > 0
			&& baseline.controlTargets.length > 0
			&& areControlTargetsEquivalent( baseline.controlTargets, siteConfigTargets ) === false;
		const controlTargetSource = activeTargets.length === 0
			? 'none'
			: useBaselineTargets ? 'baseline' : 'site-config';
		const controlTargetSourceText = controlTargetSource === 'baseline'
			? 'saved site baseline'
			: controlTargetSource === 'site-config'
				? 'model config JSON'
				: 'no control target loaded';
		const engineeringDataSourceText = resolveEngineeringDataSourceText(
			controlTargetSource,
			this.options.getRepositoryDataSource()
		);
		const hasMockEngineeringData = hasMockEngineeringDataInConfig(
			demoModelConfig,
			activeTargets
		);
		const activeControlTargetHasCornersEnu = firstTarget?.cornersEnu !== undefined;
		const runtimeLoadState = this.options.store.getState().modelRuntimeLoad.modelRuntimeLoadState;
		const modelLocalToEnuSource = demoModelConfig.configCompleteness.hasExplicitModelLocalToEnu
			? 'explicit'
			: registrationSolution !== null ? 'control-points'
				: runtimeLoadState === 'failed' ? 'failed'
					: runtimeLoadState === 'loading' ? 'waiting-runtime' : 'missing';
		const recommendedFieldHints = resolveRecommendedFieldHints( demoModelConfig );
		const missingRequiredFields = resolveMissingFormalInspectionFields( {
			hasSiteOrigin: true,
			hasModelLocalToEnu: registrationSolution !== null,
			hasRtkSurveyDataset: demoModelConfig.rtkSurveyDataset !== undefined
				&& demoModelConfig.rtkSurveyDataset.points.length > 0,
			hasControlTargets: activeTargets.length > 0,
			hasPlacementAnchor: demoModelConfig.placementAnchorEnu !== undefined,
			activeControlTargetHasCornersEnu
		} );

		this.options.store.patch( {
			engineeringConfigStatus: {
				configSource: activeRuntimeConfig !== null ? 'active-runtime' : 'session-context',
				activeRuntimeConfigReady: activeRuntimeConfig !== null,
				sessionContextConfigReady: true,
				registrationSolutionReady: registrationSolution !== null,
				modelTemplateReady: modelTemplate !== null,
				rtkDataAvailable: demoModelConfig.rtkSurveyDataset !== undefined && demoModelConfig.rtkSurveyDataset.points.length > 0,
				rtkRequiredForCurrentWorkflow: false,
				rawModelControlPointCount: demoModelConfig.modelControlTargetDiagnostics.rawModelControlPointCount,
				normalizedModelControlTargetCount: demoModelConfig.modelControlTargetDiagnostics.normalizedModelControlTargetCount,
				requiredModelControlTargetCount: demoModelConfig.modelControlTargetDiagnostics.requiredModelControlTargetCount,
				modelControlTargetIds: demoModelConfig.modelControlTargetDiagnostics.modelControlTargetIds,
				modelControlTargetValidationState: demoModelConfig.modelControlTargetDiagnostics.modelControlTargetValidationState,
				modelControlTargetFailureReason: demoModelConfig.modelControlTargetDiagnostics.modelControlTargetFailureReason,
				hasSiteOrigin: true,
				hasModelLocalToEnu: registrationSolution !== null,
				hasRtkSurveyDataset: demoModelConfig.rtkSurveyDataset !== undefined
					&& demoModelConfig.rtkSurveyDataset.points.length > 0,
				hasControlTargets: activeTargets.length > 0,
				hasPlacementAnchor: demoModelConfig.placementAnchorEnu !== undefined,
				activeControlTargetHasCornersEnu,
				hasMockEngineeringData,
				modelLocalToEnuSource,
				modelLocalToEnuText: formatModelLocalToEnuSource( modelLocalToEnuSource ),
				controlTargetCount: activeTargets.length,
				activeControlTargetId: firstTarget?.id,
				activeControlTargetName: firstTarget?.name ?? firstTarget?.markerId ?? firstTarget?.id,
				controlTargetSource,
				controlTargetSourceText,
				engineeringDataSourceText,
				mockWarningText: hasMockEngineeringData
					? '当前为示例工程坐标，请替换为 RTK 实测数据。'
					: '',
				rtkCoordinateSystemText: demoModelConfig.rtkSurveyDataset?.coordinateSystem ?? '-',
				mockRtkPointIds: resolveMockRtkPointIds( demoModelConfig ),
				recommendedFieldHints,
				registrationModeText: demoModelConfig.registration.mode,
				modelToSiteScaleText: registrationSolution === null
					? '-'
					: registrationSolution.modelToSite.scale.toFixed( 6 ),
				baselineMismatch,
				rtkPointCount: demoModelConfig.rtkSurveyDataset?.points.length ?? 0,
				undergroundObjectCount: demoModelConfig.undergroundObjects?.length ?? 0,
				sensorCount: demoModelConfig.sensors?.length ?? 0,
				riskPointCount: demoModelConfig.riskPoints?.length ?? 0,
				annotationCount: demoModelConfig.annotations.length,
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
					centerEnuText: formatTupleText( target.centerEnu ),
					cornersEnuText: target.cornersEnu === undefined
						? 'not configured, will use centerEnu + yawDeg + sizeMeters'
						: target.cornersEnu.map( formatTupleText ).join( ' / ' ),
					cornerOrderText: Array.isArray( target.cornerOrder ) && target.cornerOrder.length > 0
						? target.cornerOrder.join( ' -> ' )
						: 'leftTop -> rightTop -> rightBottom -> leftBottom',
					yawDegText: typeof target.yawDeg === 'number' ? `${target.yawDeg.toFixed( 2 )}deg` : 'not configured',
					sizeMetersText: typeof target.sizeMeters === 'number' ? `${target.sizeMeters.toFixed( 3 )}m` : 'not configured',
					planeText: target.plane === 'vertical' ? 'vertical' : 'horizontal'
				} ) )
			}
		} );

		const eventName = controlTargetSource === 'baseline'
			? 'SiteBaselineControlTargetsUsed'
			: controlTargetSource === 'site-config'
				? 'SiteConfigControlTargetsUsed'
				: 'ArUiConfigStatusResolved';

		if ( baselineMismatch ) {
			arWarn( 'SiteBaselineControlTargetsMismatchWarning', this.createUiLogPayload( {
				currentStep: 'load-config',
				localizationSource: this.options.getActiveArFromEnuSolution()?.source ?? 'unknown',
				targetId: firstTarget?.id ?? null,
				message: 'Saved site baseline control targets may differ from model config targets.'
			} ) );
		}

		this.logEngineeringCalibrationConfigStatus( {
			demoModelConfig,
			firstTarget,
			missingRequiredFields,
			hasMockEngineeringData,
			hasModelLocalToEnu: registrationSolution !== null,
			hasRtkSurveyDataset: demoModelConfig.rtkSurveyDataset !== undefined
				&& demoModelConfig.rtkSurveyDataset.points.length > 0,
			modelLocalToEnuSource,
			hitTestReady: this.options.store.getState().arSessionPhase !== 'scanning',
			localizationReady: this.options.getActiveArFromEnuSolution() !== null
		} );

	}

	private logEngineeringCalibrationConfigStatus(args: {
		demoModelConfig: DemoModelConfig;
		firstTarget: VisualControlTarget | undefined;
		missingRequiredFields: string[];
		hasMockEngineeringData: boolean;
		hasModelLocalToEnu: boolean;
		hasRtkSurveyDataset: boolean;
		modelLocalToEnuSource: 'explicit' | 'control-points' | 'waiting-runtime' | 'failed' | 'missing';
		hitTestReady: boolean;
		localizationReady: boolean;
	}): void {

		const signature = [
			args.demoModelConfig.modelId,
			args.firstTarget?.id ?? 'none',
			args.missingRequiredFields.join( ',' ),
			args.hasMockEngineeringData ? 'mock' : 'formal',
			args.hasModelLocalToEnu ? 'm2e' : 'no-m2e',
			args.modelLocalToEnuSource,
			args.hasRtkSurveyDataset ? 'rtk' : 'no-rtk'
		].join( '|' );
		if ( signature === this.lastEngineeringConfigLogSignature ) {
			return;
		}

		this.lastEngineeringConfigLogSignature = signature;
		const payload = {
			siteId: args.demoModelConfig.siteId,
			modelId: args.demoModelConfig.modelId,
			sessionId: this.options.getCurrentSessionId(),
			targetId: args.firstTarget?.id ?? null,
			currentCorner: null,
			capturedPointCount: this.options.store.getState().markerCalibration.capturedCornerCount,
			source: args.hasMockEngineeringData ? 'mock' : this.options.getRepositoryDataSource() === 'api' ? 'backend' : 'json',
			hasSiteOrigin: true,
			hasModelLocalToEnu: args.hasModelLocalToEnu,
			modelLocalToEnuSource: args.modelLocalToEnuSource,
			hasCornersEnu: args.firstTarget?.cornersEnu !== undefined,
			hasRtkSurveyDataset: args.hasRtkSurveyDataset,
			hitTestReady: args.hitTestReady,
			localizationReady: args.localizationReady,
			modelPlaced: this.options.store.getState().placementSummary.positionText !== '-',
			missingRequiredFields: args.missingRequiredFields,
			hasMockEngineeringData: args.hasMockEngineeringData,
			createdAt: Date.now()
		};

		if ( args.missingRequiredFields.length === 0 && args.hasMockEngineeringData === false ) {
			return;
		}

		arWarn( 'EngineeringCalibrationConfigInvalid', payload );

	}

	applySiteCalibrationBaselineState(
		baseline: SiteCalibrationBaseline | null,
		options?: {
			silentStatus?: boolean;
		}
	): SiteCalibrationBaseline | null {

		const siteId = this.options.getSessionSiteConfig()?.siteId ?? null;
		if ( baseline === null ) {
			this.options.store.patch( {
				siteCalibrationBaseline: {
					...createDefaultSiteCalibrationBaselineState(),
					statusText: this.options.getWorkflowMode() === 'ar-inspection'
						? 'No saved site baseline loaded for this site.'
						: 'No saved site baseline for this site.'
				}
			} );
			if ( options?.silentStatus !== true && siteId !== null ) {
				this.options.setStatus(
					this.options.getWorkflowMode() === 'ar-inspection'
						? 'No saved site baseline for this site. Please align manually.'
						: 'No saved site baseline for this site.'
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
					? 'Site baseline loaded.'
					: 'Site baseline available.',
				controlTargetCount: baseline.controlTargets.length,
				updatedAtText: formatTimestampText( baseline.updatedAt ?? baseline.createdAt )
			}
		} );

		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			for ( const target of baseline.controlTargets ) {
			}
		}

		if ( options?.silentStatus !== true && this.options.getWorkflowMode() === 'ar-inspection' ) {
			this.options.setStatus( 'Loading site baseline.' );
		}

		return baseline;

	}

	buildSiteCalibrationBaseline(existingCreatedAt?: number): SiteCalibrationBaseline {

		const demoModelConfig = this.options.getSessionSiteConfig();
		if ( demoModelConfig === null ) {
			throw new Error( 'Site config is unavailable.' );
		}

		const now = Date.now();
		return {
			siteId: demoModelConfig.siteId,
			siteOrigin: { ...demoModelConfig.siteFrame.origin },
			modelLocalToEnuVersion: 'rigid-ground-plane-model-local-to-enu-v1',
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

		const config = this.options.getSessionSiteConfig();
		const modelId = config?.modelId ?? null;
		return {
			mode: this.options.getWorkflowMode(),
			siteId: config?.siteId ?? null,
			modelId,
			sessionId: this.options.getCurrentSessionId(),
			currentStep: args.currentStep,
			localizationSource: args.localizationSource,
			targetId: args.targetId,
			message: args.message,
			createdAt: Date.now()
		};

	}

}

function formatVector3Text(vector: THREE.Vector3): string {

	return `${vector.x.toFixed( 3 )}, ${vector.y.toFixed( 3 )}, ${vector.z.toFixed( 3 )}`;

}

function formatTupleText(tuple: [ number, number, number ]): string {

	return `${tuple[ 0 ].toFixed( 3 )}, ${tuple[ 1 ].toFixed( 3 )}, ${tuple[ 2 ].toFixed( 3 )}`;

}

function resolveEngineeringDataSourceText(
	controlTargetSource: 'site-config' | 'baseline' | 'none',
	repositoryDataSource: 'local' | 'api'
): string {

	if ( controlTargetSource === 'baseline' ) {
		return repositoryDataSource === 'api' ? 'backend' : 'localStorage';
	}

	if ( controlTargetSource === 'site-config' ) {
		return 'json';
	}

	return 'none';

}

function formatModelLocalToEnuSource(
	source: 'explicit' | 'control-points' | 'waiting-runtime' | 'failed' | 'missing'
): string {

	switch ( source ) {
		case 'explicit':
			return '显式配置';
		case 'control-points':
			return '由 controlPoints 求解';
		case 'waiting-runtime':
			return '等待模型运行时';
		case 'failed':
			return '模型运行时加载失败';
		case 'missing':
			return '缺失';
	}

}

export function hasMockEngineeringDataInConfig(
	config: DemoModelConfig,
	controlTargets: VisualControlTarget[]
): boolean {

	const reasons = resolveMockEngineeringDataReasons( config, controlTargets );
	const hasMock = reasons.length > 0;
	return hasMock;

}

export function canApplyMockEngineeringCalibration(): boolean {

	return import.meta.env.DEV === true || import.meta.env.VITE_ALLOW_MOCK_CALIBRATION === 'true';

}

function resolveMockEngineeringDataReasons(
	config: DemoModelConfig,
	controlTargets: VisualControlTarget[]
): string[] {

	const candidates = [
		{ label: 'modelId', value: config.modelId },
		...( config.rtkSurveyDataset?.points ?? [] ).map( ( point ) => ( {
			label: `rtk:${point.id}`,
			value: point.note ?? ''
		} ) ),
		...controlTargets.map( ( target ) => {
			const maybeNote = ( target as VisualControlTarget & { note?: unknown } ).note;
			return {
				label: `controlTarget:${target.id}`,
				value: typeof maybeNote === 'string' ? maybeNote : ''
			};
		} )
	];

	return candidates
		.filter( ( item ) => /mock|demo|placeholder|debug/i.test( item.value ) )
		.map( ( item ) => `${item.label}=${item.value}` );

}

function resolveMockRtkPointIds(config: DemoModelConfig): string[] {

	return ( config.rtkSurveyDataset?.points ?? [] )
		.filter( ( point ) => /mock|demo|placeholder|debug/i.test( point.note ?? '' ) )
		.map( ( point ) => point.id );

}

function resolveRecommendedFieldHints(config: DemoModelConfig): string[] {

	const hints: string[] = [];
	if ( config.configCompleteness.hasExplicitSiteId === false ) {
		hints.push( '建议补充 siteId' );
	}
	if ( config.configCompleteness.hasSiteName === false ) {
		hints.push( '建议补充 siteName' );
	}
	if ( config.configCompleteness.controlPointsUseWorld === false ) {
		hints.push( '建议补充 controlPoints[].world' );
	}

	return hints;

}

function resolveMissingFormalInspectionFields(args: {
	hasSiteOrigin: boolean;
	hasModelLocalToEnu: boolean;
	hasRtkSurveyDataset: boolean;
	hasControlTargets: boolean;
	hasPlacementAnchor: boolean;
	activeControlTargetHasCornersEnu: boolean;
}): string[] {

	const missing: string[] = [];
	if ( args.hasSiteOrigin === false ) {
		missing.push( 'siteOrigin' );
	}
	if ( args.hasModelLocalToEnu === false ) {
		missing.push( 'modelLocalToEnu' );
	}
	if ( args.hasControlTargets === false ) {
		missing.push( 'controlTargets' );
	}
	if ( args.activeControlTargetHasCornersEnu === false ) {
		missing.push( 'controlTargets[].cornersEnu' );
	}
	if ( args.hasPlacementAnchor === false ) {
		missing.push( 'placementAnchorEnu' );
	}

	return missing;

}

export function areControlTargetsEquivalent(
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
			&& target.markerId === other.markerId
			&& target.plane === other.plane
			&& areOptionalNumbersEqual( target.sizeMeters, other.sizeMeters )
			&& areOptionalNumbersEqual( target.yawDeg, other.yawDeg )
			&& areStringArraysEqual( target.cornerOrder, other.cornerOrder )
			&& areEnuTuplesEqual( target.centerEnu, other.centerEnu )
			&& areCornersEnuEqual( target.cornersEnu, other.cornersEnu );
	} );

}

function areCornersEnuEqual(
	left: VisualControlTarget['cornersEnu'],
	right: VisualControlTarget['cornersEnu']
): boolean {

	if ( left === undefined || right === undefined ) {
		return left === right;
	}

	return left.length === right.length
		&& left.every( ( corner, index ) => areEnuTuplesEqual( corner, right[ index ] ) );

}

function areStringArraysEqual(
	left: string[] | undefined,
	right: string[] | undefined
): boolean {

	if ( left === undefined || right === undefined ) {
		return left === right;
	}

	return left.length === right.length
		&& left.every( ( item, index ) => item === right[ index ] );

}

function areOptionalNumbersEqual(
	left: number | undefined,
	right: number | undefined
): boolean {

	if ( left === undefined || right === undefined ) {
		return left === right;
	}

	return Math.abs( left - right ) <= 1e-6;

}

function areEnuTuplesEqual(
	left: [ number, number, number ],
	right: [ number, number, number ]
): boolean {

	return Math.abs( left[ 0 ] - right[ 0 ] ) <= 1e-6
		&& Math.abs( left[ 1 ] - right[ 1 ] ) <= 1e-6
		&& Math.abs( left[ 2 ] - right[ 2 ] ) <= 1e-6;

}

function formatTimestampText(timestamp: number | undefined): string {

	if ( typeof timestamp !== 'number' || Number.isFinite( timestamp ) === false ) {
		return '-';
	}

	return new Date( timestamp ).toLocaleString( 'zh-CN', {
		hour12: false
	} );

}
