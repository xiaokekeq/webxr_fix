import * as THREE from 'three';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import type { DemoModelAttachment, DemoModelConfig } from '@/models/config/demo-model-config.js';
import {
	type ModelCatalogItem
} from '@/models/catalog/model-api.js';
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
import { createEnuFrame, geodeticToEnu } from '@/localization/core/geodesy.js';
import type { SetStatus } from '@/features/ar/types/runtime-types.js';
import { attachInfoBoardToAttachment } from '@/engine/core/attachment-info-board.js';
import {
	loadModelTemplate,
	readPlaceableTemplateReport,
	readPlaceableTemplateTransform
} from '@/engine/core/model.js';
import { repositories } from '@/services/repository-factory.js';

export interface LoadedModelRuntimeBundle {
	pipesByName: Map<string, PipeRecord>;
	demoModelConfig: DemoModelConfig;
	modelTemplate: Awaited<ReturnType<typeof loadModelTemplate>>;
	modelSourceMetadata: ModelSourceMetadata | null;
	modelPlacementReport: ReturnType<typeof readPlaceableTemplateReport>;
	registrationSolution: EngineeringRegistrationSolution;
	modelDefinition: ModelCatalogItem;
}

export async function loadModelRuntimeBundle(
	modelDefinition: ModelCatalogItem,
	setStatus: SetStatus
): Promise<LoadedModelRuntimeBundle> {

	const [ pipesByName, demoModelConfig, loadedAssetTemplates ] = await Promise.all( [
		repositories.model.loadPipeRecords( modelDefinition.id ),
		repositories.siteConfig.getSiteConfig( modelDefinition.id ),
		loadCatalogAssetTemplates( modelDefinition, setStatus )
	] );
	const primaryTemplate = loadedAssetTemplates.get( modelDefinition.primaryAssetId );
	if ( primaryTemplate === undefined ) {
		throw new Error( `Primary asset template is missing: ${modelDefinition.primaryAssetId}` );
	}

	const primaryTemplateTransform = readPlaceableTemplateTransform( primaryTemplate );
	const registrationConfig = resolveRegistrationConfig( demoModelConfig, primaryTemplate );
	const registrationSolution = solveEngineeringRegistration( registrationConfig, {
		modelPivotOffset: primaryTemplateTransform?.pivotOffset,
		modelUnitScale: primaryTemplateTransform?.unitScale
	} );
	const modelTemplate = composeModelTemplate( {
		modelDefinition,
		demoModelConfig,
		registrationSolution,
		loadedAssetTemplates
	} );
	const modelPlacementReport = readPlaceableTemplateReport( modelTemplate ) ?? readPlaceableTemplateReport( primaryTemplate );

	return {
		pipesByName,
		demoModelConfig,
		modelTemplate,
		modelSourceMetadata: readModelSourceMetadata( modelTemplate ),
		modelPlacementReport,
		registrationSolution,
		modelDefinition
	};

}

function resolveRegistrationConfig(
	config: DemoModelConfig,
	primaryTemplate: THREE.Group
): DemoModelConfig {

	if ( import.meta.env.VITE_USE_MODEL_BBOX_FOOTPRINT_CONTROL_POINTS !== 'true' ) {
		return config;
	}

	const controlPointIds = Object.keys( config.controlPoints ).slice( 0, 4 );
	const bounds = new THREE.Box3().setFromObject( primaryTemplate );
	if ( controlPointIds.length < 4 || bounds.isEmpty() ) {
		return config;
	}

	const y = bounds.min.y;
	const bboxCorners = [
		new THREE.Vector3( bounds.min.x, y, bounds.max.z ),
		new THREE.Vector3( bounds.max.x, y, bounds.max.z ),
		new THREE.Vector3( bounds.max.x, y, bounds.min.z ),
		new THREE.Vector3( bounds.min.x, y, bounds.min.z )
	];
	const siteEnuFrame = createEnuFrame( config.siteFrame.origin );
	console.warn( '[UsingModelBoundingBoxFootprintControlPoints]', {
		modelId: config.modelId,
		controlPointIds,
		oldModelLocalPoints: controlPointIds.map( ( id ) => config.controlPoints[ id ].modelLocal ),
		bboxFootprintPoints: bboxCorners.map( vectorToModelLocal ),
		targetEnuPoints: controlPointIds.map( ( id ) => vectorToModelLocal( geodeticToEnu( config.controlPoints[ id ].world, siteEnuFrame ) ) ),
		reason: 'temporary dev option; using model bbox footprint, not surveyed control points'
	} );

	return {
		...config,
		controlPoints: {
			...config.controlPoints,
			...Object.fromEntries( controlPointIds.map( ( id, index ) => [
				id,
				{
					...config.controlPoints[ id ],
					modelLocal: vectorToModelLocal( bboxCorners[ index ] )
				}
			] ) )
		}
	};

}

function vectorToModelLocal(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: vector.x,
		y: vector.y,
		z: vector.z
	};

}

async function loadCatalogAssetTemplates(
	modelDefinition: ModelCatalogItem,
	setStatus: SetStatus
): Promise<Map<string, THREE.Group>> {

	const assetEntries = await Promise.all(
		modelDefinition.assets.map( async ( asset ) => ( {
			id: asset.id,
			template: await loadModelTemplate(
				asset.modelUrl,
				setStatus,
				1,
				asset.materialUrl,
				asset.assetTransform
			)
		} ) )
	);

	return new Map( assetEntries.map( ( entry ) => [ entry.id, entry.template ] ) );

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

	for ( const attachment of demoModelConfig.attachments ) {
		const attachmentTemplate = loadedAssetTemplates.get( attachment.assetId );
		if ( attachmentTemplate === undefined ) {
			console.warn( '[Model Runtime] Missing attachment asset:', attachment.assetId );
			continue;
		}

		positionAttachmentTemplate( attachmentTemplate, attachment, registrationSolution );
		if ( attachment.info !== undefined ) {
			attachInfoBoardToAttachment( attachmentTemplate, attachment.info );
		}
		compositeRoot.add( attachmentTemplate );
	}

	return compositeRoot;

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







