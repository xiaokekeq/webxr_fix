import * as THREE from 'three';
import {
	createDefaultGpsBiasCorrectionState,
	createDefaultRegistrationMetricsState,
	createDefaultSavedMarkerLocalizationState,
	createDefaultSiteCalibrationBaselineState,
	type MarkerCalibrationState,
	type RegistrationStore
} from '@/localization/core/registration-store.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import { geodeticToEnu } from '@/localization/core/geodesy.js';
import {
	type GpsBiasGeolocationSample,
	geolocationSampleToGeodeticPosition,
	shouldAcceptGpsAccuracy
} from '@/localization/gps-bias/gps-bias-registration.js';
import {
	loadGpsBiasCorrection,
	type GpsBiasCorrection as StoredGpsBiasCorrection
} from '@/localization/gps-bias/gps-bias-storage.js';
import {
	loadLastStableMarkerLocalizationResult,
	type SavedMarkerLocalizationResult
} from '@/localization/marker/marker-localization-storage.js';
import type { MarkerPoseInEnu } from '@/localization/marker/marker-localization.js';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import { loadSiteCalibrationBaseline } from '@/features/ar/storage/site-calibration-baseline.js';
import type {
	ArWorkflowMode,
	GpsBiasCorrection as SiteBaselineGpsBiasCorrection,
	SiteCalibrationBaseline,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';
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
	getCurrentGpsBiasSolution(): ArFromEnuSolution | null;
	getLatestAcceptedGpsBiasSample(): GpsBiasGeolocationSample | null;
	getLatestGpsBiasSample(): GpsBiasGeolocationSample | null;
	clearGpsBiasSessionSolution(): void;
	getActiveSiteCalibrationBaseline(): SiteCalibrationBaseline | null;
	getActiveGpsBiasCorrection(): StoredGpsBiasCorrection | null;
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

			this.options.store.patch( {
				registrationMetrics: nextMetrics
			} );
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

		this.options.store.patch( {
			registrationMetrics: nextMetrics
		} );

	}

	syncRegistrationChainDebug(): void {

		this.syncRegistrationMetrics();
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

	refreshGpsBiasCorrectionState(options?: {
		silentStatus?: boolean;
	}): StoredGpsBiasCorrection | null {

		const demoModelConfig = this.options.getDemoModelConfig();
		const siteId = demoModelConfig?.modelId ?? null;
		const correction = siteId === null
			? null
			: this.resolvePersistedGpsBiasCorrection( siteId );
		const acceptedSample = this.options.getLatestAcceptedGpsBiasSample();
		const latestSample = this.options.getLatestGpsBiasSample();
		const currentSolution = this.options.getCurrentGpsBiasSolution();

		if ( correction === null ) {
			this.options.clearGpsBiasSessionSolution();
			this.options.store.patch( {
				gpsBiasCorrection: createDefaultGpsBiasCorrectionState()
			} );
			if ( options?.silentStatus !== true && siteId !== null ) {
				this.options.setStatus( '当前站点还没有记录 GPS 偏差补偿。' );
			}
			return null;
		}

		console.info( '[GpsBiasCorrectionLoaded]', {
			siteId: correction.siteId,
			sessionId: this.options.getCurrentSessionId(),
			accuracyMeters: correction.accuracyMeters ?? null,
			rawGpsEnu: acceptedSample === null
				? null
				: vector3ToObject(
					geodeticToEnu( geolocationSampleToGeodeticPosition( acceptedSample ), correction.origin )
				),
			deltaEnu: {
				x: correction.deltaEnu[ 0 ],
				y: correction.deltaEnu[ 1 ],
				z: correction.deltaEnu[ 2 ]
			},
			correctedDeviceEnu: acceptedSample === null
				? null
				: vector3ToObject(
					geodeticToEnu( geolocationSampleToGeodeticPosition( acceptedSample ), correction.origin )
						.add( new THREE.Vector3( correction.deltaEnu[ 0 ], correction.deltaEnu[ 1 ], correction.deltaEnu[ 2 ] ) )
				),
			source: correction.source,
			createdAt: correction.createdAt
		} );

		this.options.store.patch( {
			gpsBiasCorrection: {
				available: true,
				siteId: correction.siteId,
				source: formatGpsBiasCorrectionSourceLabel( correction.source ),
				statusText: latestSample !== null && shouldAcceptGpsAccuracy( latestSample.accuracyMeters ) === false
					? '当前定位精度较低，等待 GPS 稳定后再更新补偿定位。'
					: '该补偿仅用于粗定位增强，不代表精确配准。',
				originText: formatGeodetic(
					correction.origin.lat,
					correction.origin.lon,
					correction.origin.alt
				),
				deltaEnuText: `${correction.deltaEnu[ 0 ].toFixed( 3 )}, ${correction.deltaEnu[ 1 ].toFixed( 3 )}, ${correction.deltaEnu[ 2 ].toFixed( 3 )}`,
				accuracyText: formatAccuracyText( acceptedSample?.accuracyMeters ?? correction.accuracyMeters ),
				yawCorrectionText: typeof correction.yawCorrectionDeg === 'number'
					? `${correction.yawCorrectionDeg.toFixed( 3 )}deg`
					: '-',
				updatedAtText: formatTimestampText( correction.updatedAt ?? correction.createdAt ),
				usingInSession: this.options.getActiveArFromEnuSolution()?.source === 'gps-bias',
				sessionSolutionAvailable: currentSolution !== null,
				sessionId: currentSolution?.sessionId ?? this.options.getCurrentSessionId() ?? undefined,
				rawGpsEnuText: acceptedSample === null
					? '-'
					: formatVector3Text(
						geodeticToEnu( geolocationSampleToGeodeticPosition( acceptedSample ), correction.origin )
					),
				correctedDeviceEnuText: acceptedSample === null
					? '-'
					: formatVector3Text(
						geodeticToEnu( geolocationSampleToGeodeticPosition( acceptedSample ), correction.origin )
							.add( new THREE.Vector3( correction.deltaEnu[ 0 ], correction.deltaEnu[ 1 ], correction.deltaEnu[ 2 ] ) )
					),
				headingDegText: currentSolution === null
					? '-'
					: `${currentSolution.headingDeg.toFixed( 3 )}deg`
			}
		} );

		return correction;

	}

	refreshSiteCalibrationBaselineState(options?: {
		silentStatus?: boolean;
	}): SiteCalibrationBaseline | null {

		const siteId = this.options.getDemoModelConfig()?.modelId ?? null;
		const baseline = siteId === null ? null : loadSiteCalibrationBaseline( siteId );

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
				gpsBiasAvailable: baseline.gpsBiasCorrection !== undefined,
				updatedAtText: formatTimestampText( baseline.updatedAt ?? baseline.createdAt )
			}
		} );
		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			console.info( '[ArInspectionBaselineLoaded]', {
				mode: this.options.getWorkflowMode(),
				siteId: baseline.siteId,
				sessionId: this.options.getCurrentSessionId(),
				source: baseline.source,
				targetId: baseline.controlTargets[ 0 ]?.id ?? null,
				createdAt: baseline.updatedAt ?? baseline.createdAt,
				trackingState: 'baseline-loaded',
				stableFrameCount: 0,
				controlTargetCount: baseline.controlTargets.length
			} );
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
			gpsBiasCorrection: toSiteBaselineGpsBiasCorrection( this.options.getActiveGpsBiasCorrection() ),
			createdAt: existingCreatedAt ?? now,
			updatedAt: now,
			source: 'site-baseline-config'
		};

	}

	refreshSavedMarkerLocalizationResult(options?: {
		silentStatus?: boolean;
	}): void {

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

	private resolvePersistedGpsBiasCorrection(siteId: string): StoredGpsBiasCorrection | null {

		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			const activeSiteCalibrationBaseline = this.options.getActiveSiteCalibrationBaseline();
			const demoModelConfig = this.options.getDemoModelConfig();
			if (
				activeSiteCalibrationBaseline?.siteId !== siteId
				|| demoModelConfig === null
				|| activeSiteCalibrationBaseline.gpsBiasCorrection === undefined
			) {
				return null;
			}

			const baselineCorrection = activeSiteCalibrationBaseline.gpsBiasCorrection;
			return {
				siteId,
				origin: activeSiteCalibrationBaseline.siteOrigin ?? demoModelConfig.siteFrame.origin,
				deltaEnu: [ baselineCorrection.deltaEnu[ 0 ], baselineCorrection.deltaEnu[ 1 ], baselineCorrection.deltaEnu[ 2 ] ],
				yawCorrectionDeg: baselineCorrection.yawCorrectionDeg,
				createdAt: baselineCorrection.createdAt,
				updatedAt: activeSiteCalibrationBaseline.updatedAt ?? baselineCorrection.createdAt,
				source: baselineCorrection.source === 'manual-site-pose'
					? 'calibration-manual-site-pose'
					: baselineCorrection.source === 'debug'
						? 'debug'
						: 'calibration-marker'
			};
		}

		return loadGpsBiasCorrection( siteId );

	}

}

function formatVector3Text(vector: THREE.Vector3): string {

	return `${vector.x.toFixed( 3 )}, ${vector.y.toFixed( 3 )}, ${vector.z.toFixed( 3 )}`;

}

function formatAccuracyText(value: number | null | undefined): string {

	return typeof value === 'number' && Number.isFinite( value )
		? `${value.toFixed( 1 )}m`
		: '-';

}

function formatGpsBiasCorrectionSourceLabel(source: string): string {

	switch ( source ) {
		case 'admin-marker':
		case 'calibration-marker':
			return '模型配准页 Marker 校正';
		case 'manual-site-pose':
			return '手动场景定位';
		case 'admin-manual-site-pose':
		case 'calibration-manual-site-pose':
			return '模型配准页手动定位';
		case 'debug':
			return '调试';
		default:
			return source;
	}

}

function formatTimestampText(timestamp: number | undefined): string {

	if ( typeof timestamp !== 'number' || Number.isFinite( timestamp ) === false ) {
		return '-';
	}

	return new Date( timestamp ).toLocaleString( 'zh-CN', {
		hour12: false
	} );

}

function vector3ToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: vector.x,
		y: vector.y,
		z: vector.z
	};

}

function toSiteBaselineGpsBiasCorrection(
	correction: StoredGpsBiasCorrection | null
): SiteBaselineGpsBiasCorrection | undefined {

	if ( correction === null ) {
		return undefined;
	}

	return {
		deltaEnu: [ correction.deltaEnu[ 0 ], correction.deltaEnu[ 1 ], correction.deltaEnu[ 2 ] ],
		yawCorrectionDeg: correction.yawCorrectionDeg,
		createdAt: correction.updatedAt ?? correction.createdAt,
		source: correction.source === 'calibration-manual-site-pose'
			? 'manual-site-pose'
			: correction.source === 'debug'
				? 'debug'
				: 'admin-marker'
	};

}
