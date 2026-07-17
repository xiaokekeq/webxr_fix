import * as THREE from 'three';
import type { ArCoordinateService } from '@/engine/coordinates/ar-coordinate-service.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import {
	resolveAnnotationStyle,
	type AnnotationStyleRule,
	type EngineeringAnnotation,
	type EnuPoint,
	type ResolvedAnnotationStyle
} from './annotation-types.js';

interface AnnotationEntry {
	annotation: EngineeringAnnotation;
	objects: THREE.Object3D[];
	texture: THREE.CanvasTexture;
	materials: THREE.Material[];
	geometry: THREE.BufferGeometry;
	lineGeometry: THREE.BufferGeometry;
}

const DEFAULT_LABEL_OFFSET: EnuPoint = { east: 0.3, north: 0.3, up: 0.5 };
const tempAnchorAr = new THREE.Vector3();
const tempLabelAr = new THREE.Vector3();

export class AnnotationLayer {

	readonly group = new THREE.Group();

	private annotations: EngineeringAnnotation[] = [];
	private styleRules: AnnotationStyleRule[] = [];
	private entries: AnnotationEntry[] = [];
	private selectedAnnotationId: string | null = null;
	private coordinates: ArCoordinateService | null = null;
	private placedModel: THREE.Group | null = null;
	private registrationSolution: EngineeringRegistrationSolution | null = null;

	constructor() {

		this.group.name = '__annotation-layer';
		this.group.userData.kind = 'annotation-layer';
		this.group.userData.layerId = 'annotations';

	}

	setAnnotations(annotations: EngineeringAnnotation[], styleRules: AnnotationStyleRule[] = []): void {

		this.annotations = annotations;
		this.styleRules = styleRules;
		this.clear();

	}

	updateFromCalibration(coordinates: ArCoordinateService): void {

		this.coordinates = coordinates;
		this.rebuild();

	}

	updateFromModelPlacement(
		placedModel: THREE.Group | null,
		registrationSolution: EngineeringRegistrationSolution | null
	): void {

		this.placedModel = placedModel;
		this.registrationSolution = registrationSolution;
		this.rebuild();

	}

	clearModelPlacement(): void {

		this.placedModel = null;
		this.registrationSolution = null;
		this.clear();
	}

	clear(): void {

		for ( const entry of this.entries ) {
			for ( const object of entry.objects ) {
				object.removeFromParent();
			}
			for ( const material of entry.materials ) {
				material.dispose();
			}
			entry.texture.dispose();
			entry.geometry.dispose();
			entry.lineGeometry.dispose();
		}
		this.entries = [];

	}

	dispose(): void {

		this.clear();

	}

	getPickableObjects(): THREE.Object3D[] {

		return this.entries.flatMap( ( entry ) => entry.objects.filter( ( object ) => object.userData.clickable === true ) );

	}

	getAnnotationById(id: string): EngineeringAnnotation | null {

		return this.annotations.find( ( annotation ) => annotation.id === id ) ?? null;

	}

	getAnnotationByObject(object: THREE.Object3D): EngineeringAnnotation | null {

		let current: THREE.Object3D | null = object;
		while ( current !== null ) {
			const annotationId = current.userData.annotationId;
			if ( typeof annotationId === 'string' ) {
				return this.getAnnotationById( annotationId );
			}
			current = current.parent;
		}
		return null;

	}

	setSelected(annotationId: string | null): void {

		this.selectedAnnotationId = annotationId;

	}

	private rebuild(): void {

		this.clear();
		for ( const annotation of this.annotations ) {
			if ( annotation.visible === false ) {
				continue;
			}

			const positions = annotation.placement === undefined
				? this.resolveEnuPositions( annotation )
				: this.resolveModelLocalPositions( annotation );
			if ( positions === null ) {
				continue;
			}

			this.entries.push( this.createEntry( annotation, positions.anchor, positions.label ) );
		}

	}

	private resolveEnuPositions(annotation: EngineeringAnnotation): { anchor: THREE.Vector3; label: THREE.Vector3 } | null {

		if ( this.coordinates === null || this.coordinates.hasCalibration() === false || annotation.anchorEnu === undefined ) {
			return null;
		}
		const anchor = this.coordinates.enuToAr( annotation.anchorEnu, tempAnchorAr );
		const label = this.coordinates.enuToAr( resolveLabelEnu( annotation ), tempLabelAr );
		return anchor === null || label === null
			? null
			: { anchor: anchor.clone(), label: label.clone() };

	}

	private resolveModelLocalPositions(annotation: EngineeringAnnotation): { anchor: THREE.Vector3; label: THREE.Vector3 } | null {

		if ( this.placedModel === null || this.registrationSolution === null || annotation.placement === undefined ) {
			return null;
		}
		const { modelLocalPosition } = annotation.placement;
		const anchor = new THREE.Vector3( modelLocalPosition.x, modelLocalPosition.y, modelLocalPosition.z )
			.add( this.registrationSolution.modelPivotOffset )
			.multiplyScalar( this.registrationSolution.modelUnitScale );
		this.placedModel.localToWorld( anchor );
		this.group.worldToLocal( anchor );
		const label = anchor.clone();
		label.y += annotation.leaderHeightMeters ?? 0.9;
		return { anchor, label };

	}

	private createEntry(
		annotation: EngineeringAnnotation,
		anchorAr: THREE.Vector3,
		labelAr: THREE.Vector3
	): AnnotationEntry {

		const style = resolveAnnotationStyle( annotation, this.styleRules );
		const geometry = new THREE.SphereGeometry( 0.08, 16, 12 );
		const pointMaterial = new THREE.MeshBasicMaterial( {
			color: style.pointColor,
			depthWrite: false,
			toneMapped: false
		} );
		const point = new THREE.Mesh( geometry, pointMaterial );
		point.name = `annotation-point-${annotation.id}`;
		point.position.copy( anchorAr );
		point.renderOrder = 230;
		applyAnnotationUserData( point, annotation, 'annotation', true );

		const lineGeometry = new THREE.BufferGeometry().setFromPoints( [ anchorAr, labelAr ] );
		const lineMaterial = new THREE.LineBasicMaterial( {
			color: style.lineColor,
			depthWrite: false,
			toneMapped: false
		} );
		const line = new THREE.Line( lineGeometry, lineMaterial );
		line.name = `annotation-line-${annotation.id}`;
		line.renderOrder = 229;
		applyAnnotationUserData( line, annotation, 'annotation-line', false );

		const labelResult = createLabelSprite( annotation, style );
		labelResult.sprite.position.copy( labelAr );
		applyAnnotationUserData( labelResult.sprite, annotation, 'annotation-label', true );

		this.group.add( line, point, labelResult.sprite );
		return {
			annotation,
			objects: [ point, line, labelResult.sprite ],
			texture: labelResult.texture,
			materials: [ pointMaterial, lineMaterial, labelResult.material ],
			geometry,
			lineGeometry
		};

	}

}

function resolveLabelEnu(annotation: EngineeringAnnotation): EnuPoint {

	if ( annotation.anchorEnu === undefined ) {
		return { east: 0, north: 0, up: 0 };
	}

	if ( annotation.label?.mode === 'absolute' && annotation.label.labelEnu !== undefined ) {
		return annotation.label.labelEnu;
	}

	const offset = annotation.label?.mode === 'offset'
		? annotation.label.offsetMeters ?? DEFAULT_LABEL_OFFSET
		: DEFAULT_LABEL_OFFSET;
	return {
		east: annotation.anchorEnu.east + offset.east,
		north: annotation.anchorEnu.north + offset.north,
		up: annotation.anchorEnu.up + offset.up
	};

}

function createLabelSprite(annotation: EngineeringAnnotation, style: ResolvedAnnotationStyle): {
	sprite: THREE.Sprite;
	texture: THREE.CanvasTexture;
	material: THREE.SpriteMaterial;
} {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 768;
	canvas.height = 220;
	const context = canvas.getContext( '2d' );
	if ( context === null ) {
		throw new Error( 'Failed to create annotation label canvas context.' );
	}

	context.clearRect( 0, 0, canvas.width, canvas.height );
	context.fillStyle = 'rgba(8, 15, 30, 0.92)';
	drawRoundRect( context, 18, 18, canvas.width - 36, canvas.height - 36, 36 );
	context.fill();
	context.strokeStyle = style.labelColor;
	context.lineWidth = 5;
	context.stroke();
	context.fillStyle = '#ffffff';
	context.font = 'bold 56px "Microsoft YaHei", sans-serif';
	context.fillText( annotation.title, 52, 100 );
	context.fillStyle = style.labelColor;
	context.font = '38px "Microsoft YaHei", sans-serif';
	context.fillText( `${annotation.type} / ${annotation.severity}`, 52, 158 );

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;

	const material = new THREE.SpriteMaterial( {
		map: texture,
		transparent: true,
		depthWrite: false,
		toneMapped: false
	} );
	const sprite = new THREE.Sprite( material );
	sprite.name = `annotation-label-${annotation.id}`;
	sprite.scale.set( 0.72, 0.206, 1 );
	sprite.renderOrder = 231;
	sprite.raycast = THREE.Sprite.prototype.raycast;

	return {
		sprite,
		texture,
		material
	};

}

function applyAnnotationUserData(
	object: THREE.Object3D,
	annotation: EngineeringAnnotation,
	kind: 'annotation' | 'annotation-line' | 'annotation-label',
	clickable: boolean
): void {

	object.userData.kind = kind;
	object.userData.entityType = 'annotation';
	object.userData.entityId = annotation.id;
	object.userData.annotationId = annotation.id;
	object.userData.layerId = annotation.layerId;
	object.userData.clickable = clickable;
	object.userData.severity = annotation.severity;
	object.userData.__nonSelectableHelper = true;
	object.userData.__excludeFromLayerIndex = true;

}

function drawRoundRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number
): void {

	context.beginPath();
	context.moveTo( x + radius, y );
	context.lineTo( x + width - radius, y );
	context.quadraticCurveTo( x + width, y, x + width, y + radius );
	context.lineTo( x + width, y + height - radius );
	context.quadraticCurveTo( x + width, y + height, x + width - radius, y + height );
	context.lineTo( x + radius, y + height );
	context.quadraticCurveTo( x, y + height, x, y + height - radius );
	context.lineTo( x, y + radius );
	context.quadraticCurveTo( x, y, x + radius, y );
	context.closePath();

}
