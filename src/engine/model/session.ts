import { arError } from '@/engine/debug/ar-logger.js';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import * as THREE from 'three';
import {
	createDefaultPlacementSummaryState,
	createDefaultModelScaleSummaryState,
	createDefaultPropertyPanelState,
	createDefaultRegistrationMetricsState,
	createDefaultModelRuntimeLoadStatus,
	type ModelRuntimeLoadStatus,
	type RegistrationStore
} from '@/localization/core/registration-store.js';
import {
	fetchModelCatalog,
	findModelCatalogItem,
	type ModelCatalogItem
} from '@/models/catalog/model-api.js';
import type { PlaceableTemplateReport } from '@/engine/core/model.js';
import type {
	EngineeringControlPoint
} from '@/localization/coarse/engineering-registration.js';
import type { SetStatus } from '@/features/ar/types/runtime-types.js';
import {
	disposeModelRuntimeBundle,
	loadModelRuntimeBundle,
	type LoadedModelRuntimeBundle,
	type ModelRuntimeLoadEvent,
	ModelRuntimeLoadError
} from './runtime.js';
import { createRegistrationMetricsState } from '@/engine/session/view-state.js';
import {
	activateRuntimeBundle,
	type ModelRuntimeActivationResult
} from './runtime-bundle-activation.js';
import type { ProjectRepositories } from '@/services/repository-factory.js';

interface CreateModelSessionOptions {
	repositories: Pick<ProjectRepositories, 'model' | 'siteConfig'>;
	store: RegistrationStore;
	setStatus: SetStatus;
	resetPlacement(): void;
	onRuntimeReset(nextModelId: string): void;
	onRuntimeBundleLoaded(bundle: LoadedModelRuntimeBundle, modelLoadRequestId: number): void;
	onRuntimeBundleReady(bundle: LoadedModelRuntimeBundle, modelLoadRequestId: number): void;
	onRuntimeLoadFailed(error: ModelRuntimeLoadError, modelLoadRequestId: number): void;
	onLoadManualRegistration(modelId: string): void;
	canRequestAutoPlacement(): boolean;
	requestAutoPlacement(): void;
}

export interface ModelSessionController {
	initializeCatalog(): Promise<void>;
	handleModelSelection(modelId: string): void;
	loadSelectedModelResources(modelDefinition: ModelCatalogItem): Promise<void>;
	getCurrentModelDefinition(): ModelCatalogItem | null;
}

export function createModelSession(options: CreateModelSessionOptions): ModelSessionController {

	const {
		repositories,
		store,
		setStatus,
		resetPlacement,
		onRuntimeReset,
		onRuntimeBundleLoaded,
		onRuntimeBundleReady,
		onRuntimeLoadFailed,
		onLoadManualRegistration,
		canRequestAutoPlacement,
		requestAutoPlacement
	} = options;

	let currentModelDefinition: ModelCatalogItem | null = null;
	let modelLoadRequestId = 0;

	async function loadSelectedModelResources(modelDefinition: ModelCatalogItem): Promise<void> {

		const requestId = ++modelLoadRequestId;

		resetPlacement();
		onRuntimeReset( modelDefinition.id );
		currentModelDefinition = null;

		store.patch( {
			selectedModelId: modelDefinition.id,
			modelUrl: modelDefinition.modelUrl,
			pipeList: [],
			propertyPanel: createDefaultPropertyPanelState(),
			registrationMetrics: createDefaultRegistrationMetricsState(),
			modelScaleSummary: createDefaultModelScaleSummaryState(),
			placementSummary: createDefaultPlacementSummaryState(),
			registrationStatusDetail: '\u72b6\u6001\uff1a\u6b63\u5728\u52a0\u8f7d\u6a21\u578b\u8d44\u6e90',
			modelRuntimeLoad: createLoadingRuntimeStatus( requestId )
		} );

		let bundle: LoadedModelRuntimeBundle;
		try {
			bundle = await loadModelRuntimeBundle( modelDefinition, setStatus, repositories, ( event ) => {
				if ( requestId === modelLoadRequestId ) patchRuntimeLoadEvent( store, requestId, event );
			} );
		} catch ( error ) {
			const failure = error instanceof ModelRuntimeLoadError
				? error
				: new ModelRuntimeLoadError( 'template-compose', modelDefinition.id, undefined, undefined, error );
			if ( requestId === modelLoadRequestId ) {
				patchRuntimeLoadFailure( store, requestId, failure );
				onRuntimeLoadFailed( failure, requestId );
				arError( '[ModelRuntimeLoadFailed]', { failure, cause: failure.cause } );
				setStatus( formatRuntimeLoadFailure( failure ) );
			}
			throw failure;
		}
		if ( requestId !== modelLoadRequestId ) {
			disposeModelRuntimeBundle( bundle );
			return;
		}

		const activationResult: ModelRuntimeActivationResult = activateRuntimeBundle(
			bundle,
			( runtimeBundle ) => onRuntimeBundleLoaded( runtimeBundle, requestId ),
			() => {
				store.patch( {
					modelRuntimeLoad: {
						...store.getState().modelRuntimeLoad,
						modelRuntimeLoadState: 'ready',
						modelRuntimeLoadStage: undefined,
						modelRuntimeLoadFailureReason: undefined,
						modelRuntimeLoadErrorMessage: undefined,
						runtimeBundleState: completeStage( store.getState().modelRuntimeLoad.runtimeBundleState ),
						modelTemplateRenderableCount: countRenderableMeshes( bundle.modelTemplate )
					}
				} );
				currentModelDefinition = bundle.modelDefinition;
			}
		);
		if ( activationResult.ok === false ) {
			const failure = new ModelRuntimeLoadError( 'runtime-activation', modelDefinition.id, undefined, undefined, activationResult.error );
			patchRuntimeLoadFailure( store, requestId, failure );
			onRuntimeLoadFailed( failure, requestId );
			arError( '[ModelRuntimeActivationFailed]', { failure, reason: activationResult.reason, cause: activationResult.error } );
			setStatus( formatRuntimeLoadFailure( failure ) );
			throw failure;
		}

		onRuntimeBundleReady( bundle, requestId );
		onLoadManualRegistration( bundle.demoModelConfig.modelId );

		store.patch( {
			modelUrl: modelDefinition.modelUrl,
			pipeList: Array.from( bundle.pipesByName.values() as Iterable<PipeRecord> ),
			registrationMetrics: createRegistrationMetricsState(
				bundle.demoModelConfig,
				bundle.registrationSolution
			),
			modelScaleSummary: createModelScaleSummaryState( bundle.modelPlacementReport )
		} );

		const controlPointDiagnostics = analyzeControlPointDiagnostics(
			bundle.modelTemplate,
			bundle.registrationSolution.controlPoints
		);

		store.patch( {
			registrationStatusDetail: controlPointDiagnostics.length > 0
				? '\u72b6\u6001\uff1a\u6a21\u578b\u5df2\u5c31\u7eea\uff0c\u4f46\u63a7\u5236\u70b9\u6570\u636e\u9700\u8981\u590d\u6838'
				: '\u72b6\u6001\uff1a\u6a21\u578b\u5df2\u5c31\u7eea\uff0c\u7b49\u5f85\u8bc6\u522b\u5e73\u9762'
		} );

		if ( canRequestAutoPlacement() ) {
			requestAutoPlacement();
		}

		setStatus(
			`\u5df2\u52a0\u8f7d ${modelDefinition.name}\uff0cRMS ${bundle.registrationSolution.modelToSite.rmsErrorMeters.toFixed( 3 )}m\u3002`
		);

	}

	return {
		async initializeCatalog() {

			const availableModels = await fetchModelCatalog( repositories.model );
			if ( availableModels.length === 0 ) {
				throw new Error( '\u5f53\u524d\u9879\u76ee\u6a21\u578b\u76ee\u5f55\u4e2d\u6ca1\u6709\u53ef\u7528\u6a21\u578b\u3002' );
			}

			store.patch( {
				availableModels,
				selectedModelId: availableModels[ 0 ].id
			} );

			await loadSelectedModelResources( availableModels[ 0 ] );

		},

		handleModelSelection(modelId) {

			if ( modelId.length === 0 ) {
				return;
			}

			const nextModel = findModelCatalogItem( store.getState().availableModels, modelId );
			if ( nextModel === null ) {
				setStatus( `\u672a\u8bc6\u522b\u7684\u6a21\u578b ID\uff1a${modelId}` );
				return;
			}

			if ( currentModelDefinition?.id === nextModel.id ) {
				return;
			}

			void loadSelectedModelResources( nextModel ).catch( () => {} );

		},

		loadSelectedModelResources,

		getCurrentModelDefinition() {

			return currentModelDefinition;

		},
	};

}

function createModelScaleSummaryState(report: PlaceableTemplateReport | null) {

	if ( report === null ) {
		return createDefaultModelScaleSummaryState();
	}

	return {
		modeText: report.calibrationMode,
		unitScaleText: report.unitScale.toFixed( 3 ),
		originalBoundsText: formatVector3AsMeters( report.originalSize ),
		finalBoundsText: formatVector3AsMeters( report.finalSize ),
		pivotOffsetText: formatVector3( report.pivotOffset )
	};

}

function analyzeControlPointDiagnostics(
	modelTemplate: THREE.Group,
	controlPoints: EngineeringControlPoint[]
): string[] {

	if ( controlPoints.length === 0 ) {
		return [];
	}

	const diagnostics: string[] = [];
	const bounds = new THREE.Box3().setFromObject( modelTemplate );
	if ( bounds.isEmpty() ) {
		return diagnostics;
	}

	const size = bounds.getSize( new THREE.Vector3() );
	const diagonal = size.length();
	const tolerance = Math.max( diagonal * 0.05, 0.15 );
	const expandedBounds = bounds.clone().expandByScalar( tolerance );
	const outsideIds = controlPoints
		.filter( ( point ) => expandedBounds.containsPoint( point.modelLocal ) === false )
		.map( ( point ) => point.id );

	if ( outsideIds.length > 0 ) {
		diagnostics.push( `\u4ee5\u4e0b\u63a7\u5236\u70b9\u843d\u5728\u6a21\u578b\u5305\u56f4\u76d2\u5916\uff1a${outsideIds.join( '\u3001' )}\u3002` );
	}

	let maxControlSpan = 0;
	for ( let i = 0; i < controlPoints.length; i += 1 ) {
		for ( let j = i + 1; j < controlPoints.length; j += 1 ) {
			maxControlSpan = Math.max(
				maxControlSpan,
				controlPoints[ i ].modelLocal.distanceTo( controlPoints[ j ].modelLocal )
			);
		}
	}

	if ( diagonal > 1e-6 && maxControlSpan > diagonal * 1.5 ) {
		diagnostics.push(
			`\u63a7\u5236\u70b9\u6700\u5927\u8de8\u5ea6 ${maxControlSpan.toFixed( 2 )}m\uff0c\u660e\u663e\u5927\u4e8e\u6a21\u578b\u5305\u56f4\u76d2\u5bf9\u89d2\u7ebf ${diagonal.toFixed( 2 )}m\u3002`
		);
	}

	if ( diagonal > 1e-6 && maxControlSpan > 0 && maxControlSpan < diagonal * 0.05 ) {
		diagnostics.push(
			`\u63a7\u5236\u70b9\u6700\u5927\u8de8\u5ea6\u4ec5 ${maxControlSpan.toFixed( 2 )}m\uff0c\u8fdc\u5c0f\u4e8e\u6a21\u578b\u5305\u56f4\u76d2\u5bf9\u89d2\u7ebf ${diagonal.toFixed( 2 )}m\uff0c\u53ef\u80fd\u4f1a\u628a\u6a21\u578b\u7f29\u5f97\u8fc7\u5c0f\u3002`
		);
	}

	return diagnostics;

}

function formatVector3AsMeters(vector: THREE.Vector3): string {

	return `${vector.x.toFixed( 3 )} x ${vector.y.toFixed( 3 )} x ${vector.z.toFixed( 3 )}m`;

}

function formatVector3(vector: THREE.Vector3): string {

	return `${vector.x.toFixed( 3 )}, ${vector.y.toFixed( 3 )}, ${vector.z.toFixed( 3 )}`;

}

function createLoadingRuntimeStatus(requestId: number): ModelRuntimeLoadStatus {

	const now = Date.now();
	const status = createDefaultModelRuntimeLoadStatus();
	return {
		...status,
		modelLoadRequestId: requestId,
		modelRuntimeLoadState: 'loading',
		modelCatalogState: { state: 'ready', startedAt: now, completedAt: now, durationMs: 0 },
		runtimeBundleState: { state: 'loading', startedAt: now }
	};

}

function patchRuntimeLoadEvent(
	store: RegistrationStore,
	requestId: number,
	event: ModelRuntimeLoadEvent
): void {

	const current = store.getState().modelRuntimeLoad;
	if ( current.modelLoadRequestId !== requestId ) return;
	const stageState = {
		state: event.state,
		startedAt: event.startedAt,
		completedAt: event.completedAt,
		durationMs: event.durationMs,
		failureReason: event.failureReason,
		errorName: event.errorName,
		errorMessage: event.errorMessage
	} as const;
	const next: ModelRuntimeLoadStatus = {
		...current,
		modelRuntimeLoadStage: event.state === 'loading' ? event.stage : current.modelRuntimeLoadStage,
		pipeRecordsState: event.stage === 'pipe-records' ? stageState : current.pipeRecordsState,
		siteConfigLoadState: event.stage === 'site-config' ? stageState : current.siteConfigLoadState,
		assetLoadState: event.stage.startsWith( 'asset-' ) ? stageState : current.assetLoadState,
		terrainAssetState: event.stage === 'asset-terrain' ? stageState : current.terrainAssetState,
		stakeMarkerAssetState: event.stage === 'asset-stake-marker' ? stageState : current.stakeMarkerAssetState,
		registrationSolveState: event.stage === 'registration' ? stageState : current.registrationSolveState,
		modelTemplateComposeState: event.stage === 'template-compose' ? stageState : current.modelTemplateComposeState,
		registrationControlPointCount: event.registrationControlPointCount ?? current.registrationControlPointCount,
		registrationRmsErrorMeters: event.registrationRmsErrorMeters ?? current.registrationRmsErrorMeters,
		registrationMatrixFinite: event.registrationMatrixFinite ?? current.registrationMatrixFinite,
		registrationMatrixInvertible: event.registrationMatrixInvertible ?? current.registrationMatrixInvertible,
		modelTemplateRenderableCount: event.modelTemplateRenderableCount ?? current.modelTemplateRenderableCount,
		assetStates: updateAssetState( current.assetStates, event, stageState )
	};
	store.patch( { modelRuntimeLoad: next } );

}

function patchRuntimeLoadFailure(store: RegistrationStore, requestId: number, error: ModelRuntimeLoadError): void {

	const current = store.getState().modelRuntimeLoad;
	if ( current.modelLoadRequestId !== requestId ) return;
	store.patch( {
		modelRuntimeLoad: {
			...current,
			modelRuntimeLoadState: 'failed',
			modelRuntimeLoadStage: error.stage,
			modelRuntimeLoadFailureReason: error.stage,
			modelRuntimeLoadErrorMessage: error.message,
			modelRuntimeLoadFailedAssetId: error.assetId,
			modelRuntimeLoadFailedUrl: error.resourceUrl,
			runtimeBundleState: {
				state: 'failed',
				startedAt: current.runtimeBundleState.startedAt ?? Date.now(),
				completedAt: Date.now(),
				failureReason: error.stage,
				errorName: error.cause instanceof Error ? error.cause.name : error.name,
				errorMessage: error.message
			}
		}
	} );

}

function updateAssetState(
	assets: ModelRuntimeLoadStatus['assetStates'],
	event: ModelRuntimeLoadEvent,
	stageState: ModelRuntimeLoadStatus['assetLoadState']
): ModelRuntimeLoadStatus['assetStates'] {

	if ( event.assetId === undefined || event.assetUrl === undefined ) return assets;
	const next = {
		assetId: event.assetId,
		assetUrl: event.assetUrl,
		materialUrl: event.materialUrl,
		...stageState
	};
	return [ ...assets.filter( ( asset ) => asset.assetId !== event.assetId ), next ];

}

function completeStage(stage: ModelRuntimeLoadStatus['runtimeBundleState']): ModelRuntimeLoadStatus['runtimeBundleState'] {

	const completedAt = Date.now();
	return {
		state: 'ready',
		startedAt: stage.startedAt ?? completedAt,
		completedAt,
		durationMs: completedAt - ( stage.startedAt ?? completedAt )
	};

}

function countRenderableMeshes(root: THREE.Object3D): number {

	let count = 0;
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh && object.geometry.getAttribute( 'position' ) !== undefined ) count += 1;
	} );
	return count;

}

function formatRuntimeLoadFailure(error: ModelRuntimeLoadError): string {

	const asset = error.assetId === undefined ? '' : `（${error.assetId}）`;
	return `模型运行时加载失败：${error.stage}${asset}。${error.message}`;

}


