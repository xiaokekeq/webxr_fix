import * as THREE from 'three';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import type { DemoModelAttachment, DemoModelConfig } from '@/models/config/demo-model-config.js';
import type { ModelCatalogAssetItem, ModelCatalogItem } from '@/models/catalog/model-api.js';
import {
	attachModelSourceMetadata,
	readModelSourceMetadata,
	type ModelSourceMetadata
} from '@/models/config/model-source-metadata.js';
import {
	solveEngineeringRegistration,
	transformSiteEnuToModelLocal,
	type EngineeringRegistrationSolution
} from '@/localization/coarse/engineering-registration.js';
import { geodeticToEnu } from '@/localization/core/geodesy.js';
import type { SetStatus } from '@/features/ar/types/runtime-types.js';
import { attachInfoBoardToAttachment } from '@/engine/core/attachment-info-board.js';
import {
	loadModelTemplate,
	readPlaceableTemplateReport,
	readPlaceableTemplateTransform
} from '@/engine/core/model.js';
import type { ProjectRepositories } from '@/services/repository-factory.js';

export type ModelRuntimeLoadStage =
	| 'pipe-records'
	| 'site-config'
	| 'asset-terrain'
	| 'asset-stake-marker'
	| 'registration'
	| 'template-compose'
	| 'resource-ownership'
	| 'runtime-activation';

export type ModelRuntimeLoadState = 'loading' | 'ready' | 'failed';

export interface ModelRuntimeLoadEvent {
	stage: ModelRuntimeLoadStage;
	state: ModelRuntimeLoadState;
	startedAt: number;
	completedAt?: number;
	durationMs?: number;
	failureReason?: string;
	errorName?: string;
	errorMessage?: string;
	assetId?: string;
	assetUrl?: string;
	materialUrl?: string;
	registrationControlPointCount?: number;
	registrationRmsErrorMeters?: number;
	registrationMatrixFinite?: boolean;
	registrationMatrixInvertible?: boolean;
	modelTemplateRenderableCount?: number;
}

export class ModelRuntimeLoadError extends Error {

	readonly name = 'ModelRuntimeLoadError';

	constructor(
		readonly stage: ModelRuntimeLoadStage,
		readonly modelId: string,
		readonly assetId?: string,
		readonly resourceUrl?: string,
		readonly cause?: unknown
	) {
		super( `${stage} failed for ${modelId}: ${getErrorMessage( cause )}` );
	}

}

export interface LoadedModelRuntimeBundle {
	pipesByName: Map<string, PipeRecord>;
	demoModelConfig: DemoModelConfig;
	modelTemplate: Awaited<ReturnType<typeof loadModelTemplate>>;
	modelSourceMetadata: ModelSourceMetadata | null;
	modelPlacementReport: ReturnType<typeof readPlaceableTemplateReport>;
	registrationSolution: EngineeringRegistrationSolution;
	modelDefinition: ModelCatalogItem;
	ownedGeometries: Set<THREE.BufferGeometry>;
	ownedMaterials: Set<THREE.Material>;
	ownedTextures: Set<THREE.Texture>;
}

const TEXTURE_KEYS = [ 'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap' ] as const;

export function disposeModelRuntimeBundle(bundle: LoadedModelRuntimeBundle): void {

	bundle.ownedMaterials.forEach( ( material ) => material.dispose() );
	bundle.ownedGeometries.forEach( ( geometry ) => geometry.dispose() );
	bundle.ownedTextures.forEach( ( texture ) => texture.dispose() );
	bundle.ownedMaterials.clear();
	bundle.ownedGeometries.clear();
	bundle.ownedTextures.clear();
	bundle.modelTemplate.removeFromParent();

}

function collectOwnedModelResources(modelTemplate: THREE.Object3D): Pick<LoadedModelRuntimeBundle, 'ownedGeometries' | 'ownedMaterials' | 'ownedTextures'> {

	const ownedGeometries = new Set<THREE.BufferGeometry>();
	const ownedMaterials = new Set<THREE.Material>();
	const ownedTextures = new Set<THREE.Texture>();
	modelTemplate.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false ) return;
		ownedGeometries.add( object.geometry );
		( Array.isArray( object.material ) ? object.material : [ object.material ] ).forEach( ( material ) => ownedMaterials.add( material ) );
	} );
	ownedMaterials.forEach( ( material ) => collectMaterialTextures( material, ownedTextures ) );
	return { ownedGeometries, ownedMaterials, ownedTextures };

}

function collectMaterialTextures(material: THREE.Material, target: Set<THREE.Texture>): void {

	const textured = material as THREE.Material & Record<string, unknown>;
	TEXTURE_KEYS.forEach( ( key ) => {
		const texture = textured[ key ];
		if ( texture instanceof THREE.Texture ) target.add( texture );
	} );

}

async function loadRuntimeStage<T>(
	stage: ModelRuntimeLoadStage,
	modelDefinition: ModelCatalogItem,
	report: ((event: ModelRuntimeLoadEvent) => void) | undefined,
	load: () => T | Promise<T>,
	onReady?: (result: T) => Partial<ModelRuntimeLoadEvent>,
	asset?: { id: string; modelUrl: string; materialUrl?: string }
): Promise<T> {

	const startedAt = Date.now();
	const base = {
		stage,
		startedAt,
		assetId: asset?.id,
		assetUrl: asset?.modelUrl,
		materialUrl: asset?.materialUrl
	};
	report?.( { ...base, state: 'loading' } );
	try {
		const result = await load();
		const completedAt = Date.now();
		report?.( {
			...base,
			state: 'ready',
			completedAt,
			durationMs: completedAt - startedAt,
			...( onReady?.( result ) ?? {} )
		} );
		return result;
	} catch ( error ) {
		const completedAt = Date.now();
		const wrapped = error instanceof ModelRuntimeLoadError
			? error
			: new ModelRuntimeLoadError( stage, modelDefinition.id, asset?.id, asset?.modelUrl ?? asset?.materialUrl, error );
		report?.( {
			...base,
			state: 'failed',
			completedAt,
			durationMs: completedAt - startedAt,
			failureReason: wrapped.stage,
			errorName: error instanceof Error ? error.name : 'UnknownError',
			errorMessage: getErrorMessage( error )
		} );
		throw wrapped;
	}

}

function getAssetStage(assetId: string): ModelRuntimeLoadStage {

	// Visual model pieces share the terrain stage; positioned marker assets keep their dedicated stage.
	return assetId === 'stake-marker' ? 'asset-stake-marker' : 'asset-terrain';

}

function countRenderableMeshes(root: THREE.Object3D): number {

	let count = 0;
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh && object.geometry.getAttribute( 'position' ) !== undefined ) count += 1;
	} );
	return count;

}

function getErrorMessage(error: unknown): string {

	return error instanceof Error ? error.message : String( error );

}

export async function loadModelRuntimeBundle(
	modelDefinition: ModelCatalogItem,
	setStatus: SetStatus,
	repositories: Pick<ProjectRepositories, 'model' | 'siteConfig'>,
	report?: (event: ModelRuntimeLoadEvent) => void
): Promise<LoadedModelRuntimeBundle> {

	try {
		const [ pipesByName, demoModelConfig, loadedAssetTemplates ] = await Promise.all( [
			loadRuntimeStage( 'pipe-records', modelDefinition, report, () => repositories.model.loadPipeRecords( modelDefinition.id ) ),
			loadRuntimeStage( 'site-config', modelDefinition, report, () => repositories.siteConfig.getSiteConfig( modelDefinition.id ) ),
			loadCatalogAssetTemplates( modelDefinition, setStatus, report )
		] );
		const primaryTemplate = loadedAssetTemplates.get( modelDefinition.primaryAssetId );
		if ( primaryTemplate === undefined ) {
			throw new ModelRuntimeLoadError( 'template-compose', modelDefinition.id, modelDefinition.primaryAssetId );
		}

		const primaryTemplateTransform = readPlaceableTemplateTransform( primaryTemplate );
		const registrationSolution = await loadRuntimeStage( 'registration', modelDefinition, report, () => solveEngineeringRegistration( demoModelConfig, {
			modelPivotOffset: primaryTemplateTransform?.pivotOffset,
			modelUnitScale: primaryTemplateTransform?.unitScale
		} ), ( solution ) => ( {
			registrationControlPointCount: solution.controlPoints.length,
			registrationRmsErrorMeters: solution.modelToSite.rmsErrorMeters,
			registrationMatrixFinite: solution.modelToSite.matrix.elements.every( Number.isFinite ),
			registrationMatrixInvertible: Math.abs( solution.modelToSite.matrix.determinant() ) > 1e-9
		} ) );
		const modelTemplate = await loadRuntimeStage( 'template-compose', modelDefinition, report, () => composeModelTemplate( {
			modelDefinition,
			demoModelConfig,
			registrationSolution,
			loadedAssetTemplates
		} ), ( template ) => ( { modelTemplateRenderableCount: countRenderableMeshes( template ) } ) );
		const modelPlacementReport = readPlaceableTemplateReport( modelTemplate ) ?? readPlaceableTemplateReport( primaryTemplate );
		const ownership = await loadRuntimeStage( 'resource-ownership', modelDefinition, report, () => collectOwnedModelResources( modelTemplate ) );

		return {
			pipesByName,
			demoModelConfig,
			modelTemplate,
			modelSourceMetadata: readModelSourceMetadata( modelTemplate ),
			modelPlacementReport,
			registrationSolution,
			modelDefinition,
			...ownership
		};
	} catch ( error ) {
		throw error instanceof ModelRuntimeLoadError
			? error
			: new ModelRuntimeLoadError( 'template-compose', modelDefinition.id, undefined, undefined, error );
	}

}

async function loadCatalogAssetTemplates(
	modelDefinition: ModelCatalogItem,
	setStatus: SetStatus,
	report?: (event: ModelRuntimeLoadEvent) => void
): Promise<Map<string, THREE.Group>> {

	const assetEntries = await Promise.all(
		modelDefinition.assets.map( async ( asset ) => ( {
			id: asset.id,
			template: await loadRuntimeStage( getAssetStage( asset.id ), modelDefinition, report, () => loadModelTemplate(
				asset.modelUrl,
				setStatus,
				1,
				asset.materialUrl,
				asset.assetTransform,
				shouldSplitAssetIntoBusinessLayers( asset )
			), undefined, asset )
		} ) )
	);

	return new Map( assetEntries.map( ( entry ) => [ entry.id, entry.template ] ) );

}

export function shouldSplitAssetIntoBusinessLayers(asset: Pick<ModelCatalogAssetItem, 'role'>): boolean {

	return asset.role !== 'context';

}

function composeModelTemplate(options: {
	modelDefinition: ModelCatalogItem;
	demoModelConfig: DemoModelConfig;
	registrationSolution: EngineeringRegistrationSolution;
	loadedAssetTemplates: Map<string, THREE.Group>;
}): THREE.Group {

	const {
		modelDefinition,
		demoModelConfig,
		registrationSolution,
		loadedAssetTemplates
	} = options;
	const primaryTemplate = loadedAssetTemplates.get( modelDefinition.primaryAssetId );
	if ( primaryTemplate === undefined ) {
		throw new Error( `Primary asset template is missing: ${modelDefinition.primaryAssetId}` );
	}

	if ( demoModelConfig.attachments.length === 0 && loadedAssetTemplates.size === 1 ) {
		return primaryTemplate;
	}

	const compositeRoot = new THREE.Group();
	compositeRoot.name = `${modelDefinition.id}-composite-root`;
	compositeRoot.add( primaryTemplate );
	const primaryMetadata = readModelSourceMetadata( primaryTemplate );
	if ( primaryMetadata !== null ) {
		attachModelSourceMetadata( compositeRoot, primaryMetadata );
	}
	const primaryPlacementReport = readPlaceableTemplateReport( primaryTemplate );
	if ( primaryPlacementReport !== null ) {
		compositeRoot.userData.__placeableTemplateReport = primaryTemplate.userData.__placeableTemplateReport;
		compositeRoot.userData.__placeableTemplateTransform = primaryTemplate.userData.__placeableTemplateTransform;
	}

	clipSideSurfacesToOwners( modelDefinition, loadedAssetTemplates );

	for ( const asset of modelDefinition.assets ) {
		if ( asset.role !== 'context' ) continue;
		const contextTemplate = loadedAssetTemplates.get( asset.id );
		if ( contextTemplate === undefined ) {
			throw new ModelRuntimeLoadError( 'template-compose', modelDefinition.id, asset.id );
		}

		alignSharedCoordinateTemplate( primaryTemplate, contextTemplate );
		compositeRoot.add( contextTemplate );
	}

	for ( const attachment of demoModelConfig.attachments ) {
		const attachmentTemplate = loadedAssetTemplates.get( attachment.assetId );
		if ( attachmentTemplate === undefined ) {
			throw new ModelRuntimeLoadError( 'template-compose', modelDefinition.id, attachment.assetId );
		}

		positionAttachmentTemplate( attachmentTemplate, attachment, registrationSolution );
		if ( attachment.info !== undefined ) {
			attachInfoBoardToAttachment( attachmentTemplate, attachment.info );
		}
		compositeRoot.add( attachmentTemplate );
	}

	return compositeRoot;

}

function clipSideSurfacesToOwners(
	modelDefinition: ModelCatalogItem,
	loadedAssetTemplates: Map<string, THREE.Group>
): void {

	for ( const asset of modelDefinition.assets ) {
		if ( asset.role !== 'context' || asset.id.endsWith( '-surface' ) === false ) continue;
		const owner = loadedAssetTemplates.get( asset.id.slice( 0, - '-surface'.length ) );
		const surface = loadedAssetTemplates.get( asset.id );
		if ( owner !== undefined && surface !== undefined ) {
			clipSharedCoordinateSurfaceToOwnerFootprint( owner, surface );
		}
	}

}

export function clipSharedCoordinateSurfaceToOwnerFootprint(
	ownerTemplate: THREE.Group,
	surfaceTemplate: THREE.Group
): void {

	const root = new THREE.Group();
	root.add( ownerTemplate, surfaceTemplate );
	alignSharedCoordinateTemplate( ownerTemplate, surfaceTemplate );
	root.updateMatrixWorld( true );
	const footprint = new THREE.Box3().setFromObject( ownerTemplate );
	const aPosition = new THREE.Vector3();
	const bPosition = new THREE.Vector3();
	const cPosition = new THREE.Vector3();
	const center = new THREE.Vector3();

	surfaceTemplate.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false ) return;
		const geometry = object.geometry;
		const positions = geometry.getAttribute( 'position' );
		const sourceIndex = geometry.getIndex();
		const groups = geometry.groups.length > 0
			? geometry.groups
			: [ { start: 0, count: sourceIndex?.count ?? positions.count, materialIndex: 0 } ];
		const keptIndices: number[] = [];
		const keptGroups: THREE.BufferGeometry['groups'] = [];

		for ( const group of groups ) {
			const start = keptIndices.length;
			const end = group.start + group.count;
			for ( let offset = group.start; offset + 2 < end; offset += 3 ) {
				const a = sourceIndex?.getX( offset ) ?? offset;
				const b = sourceIndex?.getX( offset + 1 ) ?? offset + 1;
				const c = sourceIndex?.getX( offset + 2 ) ?? offset + 2;
				center
					.copy( aPosition.fromBufferAttribute( positions, a ) )
					.add( bPosition.fromBufferAttribute( positions, b ) )
					.add( cPosition.fromBufferAttribute( positions, c ) )
					.multiplyScalar( 1 / 3 )
					.applyMatrix4( object.matrixWorld );
				if ( center.x < footprint.min.x || center.x > footprint.max.x
					|| center.z < footprint.min.z || center.z > footprint.max.z ) continue;
				keptIndices.push( a, b, c );
			}
			if ( keptIndices.length > start ) {
				keptGroups.push( {
					start,
					count: keptIndices.length - start,
					materialIndex: group.materialIndex
				} );
			}
		}

		geometry.setIndex( keptIndices );
		geometry.clearGroups();
		for ( const group of keptGroups ) geometry.addGroup( group.start, group.count, group.materialIndex );
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
	} );

	root.remove( ownerTemplate, surfaceTemplate );
	surfaceTemplate.position.set( 0, 0, 0 );

}

export function alignSharedCoordinateTemplate(
	primaryTemplate: THREE.Group,
	contextTemplate: THREE.Group
): void {

	const primaryTransform = readPlaceableTemplateTransform( primaryTemplate );
	const contextTransform = readPlaceableTemplateTransform( contextTemplate );
	if ( primaryTransform === null || contextTransform === null ) {
		throw new Error( 'Shared-coordinate assets require placeable template transforms.' );
	}
	if ( Math.abs( primaryTransform.unitScale - contextTransform.unitScale ) > 1e-9 ) {
		throw new Error( 'Shared-coordinate assets must use the same unitScale.' );
	}

	contextTemplate.position
		.copy( primaryTransform.pivotOffset )
		.sub( contextTransform.pivotOffset )
		.multiplyScalar( primaryTransform.unitScale );
	contextTemplate.traverse( ( object ) => {
		object.userData.__excludeFromPicking = true;
		object.userData.__excludeFromLayerIndex = true;
	} );

}

function positionAttachmentTemplate(
	template: THREE.Group,
	attachment: DemoModelAttachment,
	registrationSolution: EngineeringRegistrationSolution
): void {

	const worldEnu = geodeticToEnu( attachment.world, registrationSolution.siteEnuFrame );
	const modelLocal = transformSiteEnuToModelLocal( worldEnu, registrationSolution );
	const yawRad = THREE.MathUtils.degToRad( attachment.yawDeg );

	template.rotation.set( 0, yawRad, 0 );
	template.scale.multiplyScalar( attachment.scaleMultiplier );
	template.updateMatrixWorld( true );
	const anchorOffset = getAttachmentAnchorOffset( template, attachment.anchorMode );
	template.position.copy( modelLocal ).sub( anchorOffset );
	template.updateMatrixWorld( true );

}

function getAttachmentAnchorOffset(
	template: THREE.Group,
	anchorMode: DemoModelAttachment['anchorMode']
): THREE.Vector3 {

	if ( anchorMode === 'base-center' ) {
		return new THREE.Vector3();
	}

	const bounds = new THREE.Box3().setFromObject( template );
	if ( bounds.isEmpty() ) {
		return new THREE.Vector3();
	}

	return bounds.getCenter( new THREE.Vector3() );

}







