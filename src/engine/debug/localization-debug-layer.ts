import * as THREE from 'three';
import type { VisualControlTarget } from '@/features/ar/types/workflow.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';

export interface LocalizationDebugLayerOptions {
	showMarkerExpected: boolean;
	showMarkerCaptured: boolean;
	showModelActualControlPoints: boolean;
	showModelBoundingBox: boolean;
}

interface ActualModelControlPoints {
	engineering: THREE.Vector3[];
	current: THREE.Vector3[];
	target: THREE.Vector3[];
	boundingBox: THREE.Box3 | null;
}

export interface LocalizationDebugSnapshot {
	arFromEnuSolution: ArFromEnuSolution | null;
	controlTarget: VisualControlTarget | null;
	registrationSolution: EngineeringRegistrationSolution | null;
	capturedCornersAr: THREE.Vector3[];
	actualModelControlPoints: ActualModelControlPoints | null;
	showCurrentModelControlPoints: boolean;
	showSiteOriginDetail: boolean;
	layers: LocalizationDebugLayerOptions;
}

export interface LocalizationDebugSyncResult {
	engineeringOriginSphereExists: boolean;
	markerReferenceSphereExists: boolean;
	yellowControlPointCount: number;
}

const QUAD_POINT_RADIUS_METERS = 0.035;
const DEBUG_POINT_RADIUS_METERS = 0.045;
const SITE_ORIGIN_RADIUS_METERS = 0.055;

export class LocalizationDebugLayer {

	readonly root = new THREE.Group();

	constructor() {

		this.root.name = '__registration-debug-root';

	}

	sync(snapshot: LocalizationDebugSnapshot): LocalizationDebugSyncResult {

		this.clear();
		const { arFromEnuSolution, controlTarget, registrationSolution } = snapshot;
		const markerCornersEnu = ( controlTarget?.cornersEnu ?? [] ).map( tupleToVector3 );
		let markerCenterAr: THREE.Vector3 | null = null;

		if ( arFromEnuSolution !== null ) {
			this.addSiteOriginReferenceMarker( arFromEnuSolution, snapshot.showSiteOriginDetail );
			if ( snapshot.layers.showMarkerExpected && markerCornersEnu.length === 4 ) {
				this.addQuad( {
					name: 'marker-expected',
					points: markerCornersEnu.map( ( point ) => point.clone().applyMatrix4( arFromEnuSolution.matrix ) ),
					labels: [ 'leftTop', 'rightTop', 'rightBottom', 'leftBottom' ],
					color: 0x00d4ff
				} );
			}
			if ( markerCornersEnu.length === 4 ) {
				markerCenterAr = averageVectors( markerCornersEnu ).applyMatrix4( arFromEnuSolution.matrix );
				this.addPoint( 'marker-center', markerCenterAr, 0x00d4ff );
			}
		}

		if ( snapshot.layers.showMarkerCaptured && snapshot.capturedCornersAr.length === 4 ) {
			this.addQuad( {
				name: 'marker-captured',
				points: snapshot.capturedCornersAr,
				labels: [ 'captured-LT', 'captured-RT', 'captured-RB', 'captured-LB' ],
				color: 0x32ff8f
			} );
		}

		if ( arFromEnuSolution !== null && registrationSolution !== null ) {
			const controlPoints = registrationSolution.controlPoints.slice( 0, 4 );
			const footprintCornersAr = controlPoints.map( ( point ) => (
				point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix )
			) );
			this.addQuad( {
				name: 'footprint-enu',
				points: footprintCornersAr,
				labels: controlPoints.map( ( point ) => point.id ),
				color: 0xffd84d
			} );
			if ( markerCenterAr !== null && controlPoints.length === 4 ) {
				const footprintCenterAr = averageVectors( controlPoints.map( ( point ) => point.worldEnu ) )
					.applyMatrix4( arFromEnuSolution.matrix );
				this.addPoint( 'footprint-center', footprintCenterAr, 0xffd84d );
				this.addLine( 'marker-to-footprint-center', [ markerCenterAr, footprintCenterAr ], 0xffd84d );
			}
		}

		const actual = snapshot.actualModelControlPoints;
		if ( actual !== null && registrationSolution !== null ) {
			const controlPoints = registrationSolution.controlPoints.slice( 0, 4 );
			if ( snapshot.layers.showModelActualControlPoints ) {
				this.addQuad( {
					name: 'model-cp-actual-engineering',
					points: actual.engineering,
					labels: controlPoints.map( ( point ) => `actual-${point.id}-engineering` ),
					color: 0xff4dff
				} );
				for ( let index = 0; index < Math.min( actual.target.length, actual.engineering.length ); index += 1 ) {
					this.addLine( `residual-${controlPoints[ index ].id}`, [ actual.target[ index ], actual.engineering[ index ] ], 0xffffff );
				}
				if ( snapshot.showCurrentModelControlPoints ) {
					this.addQuad( {
						name: 'model-cp-current-runtime',
						points: actual.current,
						labels: controlPoints.map( ( point ) => `current-${point.id}` ),
						color: 0xf97316
					} );
				}
			}
			if ( snapshot.layers.showModelBoundingBox && actual.boundingBox?.isEmpty() === false ) {
				const helper = new THREE.Box3Helper( actual.boundingBox, 0xffffff );
				helper.name = 'model-bbox';
				this.root.add( helper );
			}
		}

		const debugMeshes = this.root.children.filter( ( child ) => child instanceof THREE.Mesh );
		return {
			engineeringOriginSphereExists: debugMeshes.some( ( child ) => child.name === 'site-origin-reference-point' ),
			markerReferenceSphereExists: debugMeshes.some( ( child ) => child.name === 'marker-center' ),
			yellowControlPointCount: debugMeshes.filter( ( child ) => child.name.startsWith( 'footprint-enu-' ) ).length
		};

	}

	containsSiteOriginReference(object: THREE.Object3D): boolean {

		let current: THREE.Object3D | null = object;
		while ( current !== null ) {
			if ( current.userData.__siteOriginReference === true ) {
				return true;
			}
			current = current.parent;
		}
		return false;

	}

	clear(): void {

		while ( this.root.children.length > 0 ) {
			const child = this.root.children[ 0 ];
			this.root.remove( child );
			disposeDebugObject( child );
		}

	}

	dispose(): void {

		this.clear();
		this.root.removeFromParent();

	}

	private addQuad(args: {
		name: string;
		points: THREE.Vector3[];
		labels: string[];
		color: number;
	}): void {

		if ( args.points.length !== 4 ) {
			return;
		}

		const geometry = new THREE.BufferGeometry().setFromPoints( [ ...args.points, args.points[ 0 ] ] );
		const line = new THREE.Line( geometry, createOverlayLineMaterial( args.color ) );
		line.name = `${args.name}-quad`;
		this.root.add( line );

		for ( let index = 0; index < args.points.length; index += 1 ) {
			const sphere = new THREE.Mesh(
				new THREE.SphereGeometry( QUAD_POINT_RADIUS_METERS, 12, 8 ),
				createOverlayPointMaterial( args.color )
			);
			sphere.position.copy( args.points[ index ] );
			sphere.name = `${args.name}-${args.labels[ index ]}`;
			this.root.add( sphere );

			const label = createDebugTextSprite( args.labels[ index ], args.color );
			label.position.copy( args.points[ index ] ).add( new THREE.Vector3( 0, 0.08, 0 ) );
			this.root.add( label );
		}

	}

	private addPoint(labelText: string, position: THREE.Vector3, color: number): void {

		const sphere = new THREE.Mesh(
			new THREE.SphereGeometry( DEBUG_POINT_RADIUS_METERS, 12, 8 ),
			createOverlayPointMaterial( color )
		);
		sphere.name = labelText;
		sphere.position.copy( position );
		this.root.add( sphere );

		const label = createDebugTextSprite( labelText, color );
		label.position.copy( position ).add( new THREE.Vector3( 0, 0.1, 0 ) );
		this.root.add( label );

	}

	private addLine(name: string, points: THREE.Vector3[], color: number): void {

		const geometry = new THREE.BufferGeometry().setFromPoints( points );
		const line = new THREE.Line( geometry, createOverlayLineMaterial( color ) );
		line.name = name;
		this.root.add( line );

	}

	private addSiteOriginReferenceMarker(
		arFromEnuSolution: ArFromEnuSolution,
		showDetail: boolean
	): void {

		const originAr = new THREE.Vector3().applyMatrix4( arFromEnuSolution.matrix );
		const labelPosition = originAr.clone().add( new THREE.Vector3( 0.22, 0.42, 0 ) );
		const point = new THREE.Mesh(
			new THREE.SphereGeometry( SITE_ORIGIN_RADIUS_METERS, 16, 10 ),
			createOverlayPointMaterial( 0x38bdf8 )
		);
		point.name = 'site-origin-reference-point';
		point.position.copy( originAr );
		markSiteOriginReferenceObject( point );
		this.root.add( point );

		this.addLine( 'site-origin-reference-line', [ originAr, labelPosition ], 0x38bdf8 );
		const label = createCanvasPanelSprite( {
			title: '参考原点',
			subtitle: 'siteOrigin / ENU (0,0,0)',
			width: 0.72,
			color: '#38bdf8'
		} );
		label.name = 'site-origin-reference-label';
		label.position.copy( labelPosition );
		markSiteOriginReferenceObject( label );
		this.root.add( label );

		if ( showDetail ) {
			const detail = createCanvasPanelSprite( {
				title: '工程参考原点',
				subtitle: `AR ${originAr.x.toFixed( 2 )}, ${originAr.y.toFixed( 2 )}, ${originAr.z.toFixed( 2 )}`,
				body: '这是 ENU 坐标系原点映射到当前 WebXR AR local 的参考点。再次点击关闭。',
				width: 1.08,
				color: '#facc15'
			} );
			detail.name = 'site-origin-reference-detail';
			detail.position.copy( labelPosition ).add( new THREE.Vector3( 0, 0.34, 0 ) );
			markSiteOriginReferenceObject( detail );
			this.root.add( detail );
		}

	}

}

function createOverlayPointMaterial(color: number): THREE.MeshBasicMaterial {

	return new THREE.MeshBasicMaterial( {
		color,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	} );

}

function createOverlayLineMaterial(color: number): THREE.LineBasicMaterial {

	return new THREE.LineBasicMaterial( {
		color,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	} );

}

function createDebugTextSprite(text: string, color: number): THREE.Sprite {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 256;
	canvas.height = 96;
	const context = canvas.getContext( '2d' );
	if ( context !== null ) {
		context.font = 'bold 28px sans-serif';
		context.fillStyle = 'rgba(0,0,0,0.72)';
		context.fillRect( 0, 0, canvas.width, canvas.height );
		context.fillStyle = `#${color.toString( 16 ).padStart( 6, '0' )}`;
		context.fillText( text, 16, 58 );
	}
	const texture = new THREE.CanvasTexture( canvas );
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	const sprite = new THREE.Sprite( new THREE.SpriteMaterial( {
		map: texture,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		transparent: true
	} ) );
	sprite.scale.set( 0.38, 0.14, 1 );
	sprite.name = `corner-debug-label-${text}`;
	return sprite;

}

function createCanvasPanelSprite(args: {
	title: string;
	subtitle: string;
	body?: string;
	width: number;
	color: string;
}): THREE.Sprite {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 768;
	canvas.height = args.body === undefined ? 256 : 448;
	const context = canvas.getContext( '2d' );
	if ( context !== null ) {
		context.clearRect( 0, 0, canvas.width, canvas.height );
		context.fillStyle = 'rgba(12, 18, 32, 0.88)';
		context.fillRect( 0, 0, canvas.width, canvas.height );
		context.strokeStyle = args.color;
		context.lineWidth = 8;
		context.strokeRect( 12, 12, canvas.width - 24, canvas.height - 24 );
		context.fillStyle = '#ffffff';
		context.font = 'bold 72px "Microsoft YaHei", sans-serif';
		context.fillText( args.title, 44, 104 );
		context.fillStyle = 'rgba(226, 232, 240, 0.96)';
		context.font = '42px "Microsoft YaHei", sans-serif';
		context.fillText( args.subtitle, 44, 170 );
		if ( args.body !== undefined ) {
			context.fillStyle = 'rgba(250, 204, 21, 0.96)';
			context.font = '38px "Microsoft YaHei", sans-serif';
			wrapCanvasText( context, args.body, 44, 250, canvas.width - 88, 52, 3 );
		}
	}
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	const sprite = new THREE.Sprite( new THREE.SpriteMaterial( {
		map: texture,
		depthTest: false,
		depthWrite: false,
		transparent: true,
		toneMapped: false
	} ) );
	sprite.raycast = THREE.Sprite.prototype.raycast;
	sprite.scale.set( args.width, args.width / ( canvas.width / canvas.height ), 1 );
	return sprite;

}

function wrapCanvasText(
	context: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxWidth: number,
	lineHeight: number,
	maxLines: number
): void {

	let line = '';
	let lineCount = 0;
	for ( const char of text ) {
		const nextLine = line + char;
		if ( context.measureText( nextLine ).width > maxWidth && line.length > 0 ) {
			context.fillText( line, x, y + lineCount * lineHeight );
			line = char;
			lineCount += 1;
			if ( lineCount >= maxLines ) {
				return;
			}
			continue;
		}
		line = nextLine;
	}
	if ( line.length > 0 && lineCount < maxLines ) {
		context.fillText( line, x, y + lineCount * lineHeight );
	}

}

function tupleToVector3(tuple: [ number, number, number ]): THREE.Vector3 {

	return new THREE.Vector3( tuple[ 0 ], tuple[ 1 ], tuple[ 2 ] );

}

function averageVectors(points: THREE.Vector3[]): THREE.Vector3 {

	const average = new THREE.Vector3();
	for ( const point of points ) {
		average.add( point );
	}
	return points.length === 0 ? average : average.multiplyScalar( 1 / points.length );

}

function markSiteOriginReferenceObject(object: THREE.Object3D): void {

	object.userData.__siteOriginReference = true;
	object.userData.__excludeFromLayerIndex = true;
	object.userData.__visualizationHelper = true;

}

function disposeDebugObject(object: THREE.Object3D): void {

	object.traverse( ( child ) => {
		if ( child instanceof THREE.Mesh || child instanceof THREE.Line ) {
			child.geometry.dispose();
			disposeMaterial( child.material );
		}
		if ( child instanceof THREE.Sprite ) {
			disposeMaterial( child.material );
		}
	} );

}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {

	if ( Array.isArray( material ) ) {
		material.forEach( disposeMaterial );
		return;
	}
	const maybeTextured = material as THREE.Material & { map?: THREE.Texture };
	maybeTextured.map?.dispose();
	material.dispose();

}
