import * as THREE from 'three';
import { mapXrayOpacityValue } from './adjustment-value-mappers.js';
import type { UndergroundMaterialMode } from './underground-display-state.js';

interface Segment { a: THREE.Vector3; b: THREE.Vector3; material: THREE.Material; length: number; }

interface SegmentCollection {
	segments: Segment[];
	sourceMeshCount: number;
	intersectedMeshCount: number;
}

interface LoopBuildResult {
	loops: THREE.Vector3[][];
	skippedOpenChainCount: number;
}

interface SectionCapMaterialState {
	mode: UndergroundMaterialMode;
	opacity: number;
}

export interface SectionCapDiagnostics {
	enabled: boolean;
	sourceMeshCount: number;
	intersectedMeshCount: number;
	segmentCount: number;
	loopCount: number;
	triangleCount: number;
	capMeshCount: number;
	skippedOpenChainCount: number;
	triangulationFailureCount: number;
	lastFailureReason?: 'no-closed-loops' | 'triangulation-failed';
}

export interface SectionCapSyncOptions {
	geometryDirty?: boolean;
	materialDirty?: boolean;
	sourceModelUuid?: string | null;
	materialMode?: UndergroundMaterialMode;
	opacity?: number;
}

/**
 * Three.js local clipping removes points with a negative plane distance. The cap
 * therefore faces the removed half-space so FrontSide is visible through the opening.
 */
export function getSectionCapFacingNormal(plane: THREE.Plane, target = new THREE.Vector3()): THREE.Vector3 {

	return target.copy( plane.normal ).negate();

}

export class SectionCapRuntime {

	private revision = 0;
	private rebuildCount = 0;
	private disposeCount = 0;
	private lastDisposeReason = 'none';
	private lastGeometrySignature = '';
	private lastMaterialSignature = '';
	private capRoot: THREE.Group | null = null;
	private capMaterial: THREE.MeshStandardMaterial | null = null;
	private sourceMaterial: THREE.Material | null = null;
	private sourceModelUuid: string | null = null;
	private diagnostics: SectionCapDiagnostics = createDiagnostics( false );

	sync(root: THREE.Object3D | null, plane: THREE.Plane | null, options: SectionCapSyncOptions = {}): void {

		if ( root === null || plane === null ) {
			this.hide();
			return;
		}

		root.updateWorldMatrix( true, true );
		const materialState = getMaterialState( options );
		const geometrySignature = getGeometrySignature( root, plane, options.sourceModelUuid );
		const geometryDirty = options.geometryDirty === true || geometrySignature !== this.lastGeometrySignature;
		const materialSignature = getMaterialSignature( materialState, this.sourceMaterial );

		this.diagnostics.enabled = true;
		if ( geometryDirty ) {
			this.lastGeometrySignature = geometrySignature;
			this.rebuild( root, plane, options.sourceModelUuid ?? root.uuid, materialState );
			return;
		}

		if ( this.capRoot === null || this.capMaterial === null ) return;
		this.capRoot.visible = true;
		if ( options.materialDirty === true || materialSignature !== this.lastMaterialSignature ) this.syncMaterial( materialState );

	}

	hide(): void {

		this.removeCap();
		this.lastGeometrySignature = '';
		this.lastMaterialSignature = '';
		this.diagnostics = createDiagnostics( false );

	}

	dispose(reason = 'dispose'): void {

		this.hide();
		this.disposeCount += 1;
		this.lastDisposeReason = reason;

	}

	getDiagnostics(): SectionCapDiagnostics {

		return { ...this.diagnostics };

	}

	getDebug() {

		return {
			sectionCapExists: this.capRoot !== null,
			sectionCapEnabled: this.capRoot !== null,
			sectionCapVisible: this.capRoot?.visible === true,
			sectionCapSourceModelUuid: this.sourceModelUuid,
			sectionCapDisposeCount: this.disposeCount,
			sectionCapLastDisposeReason: this.lastDisposeReason,
			sectionCapMeshCount: this.diagnostics.capMeshCount,
			sectionCapTriangleCount: this.diagnostics.triangleCount,
			sectionCapRevision: this.revision,
			sectionCapRebuildCount: this.rebuildCount,
			sectionCapDiagnostics: this.getDiagnostics()
		};

	}

	private rebuild(root: THREE.Object3D, plane: THREE.Plane, sourceModelUuid: string, materialState: SectionCapMaterialState): void {

		this.removeCap();
		this.diagnostics = createDiagnostics( true );
		const collection = collectSegments( root, plane );
		this.diagnostics.sourceMeshCount = collection.sourceMeshCount;
		this.diagnostics.intersectedMeshCount = collection.intersectedMeshCount;
		this.diagnostics.segmentCount = collection.segments.length;
		const loopResult = buildLoops( collection.segments );
		this.diagnostics.loopCount = loopResult.loops.length;
		this.diagnostics.skippedOpenChainCount = loopResult.skippedOpenChainCount;
		if ( loopResult.loops.length === 0 ) {
			this.diagnostics.lastFailureReason = 'no-closed-loops';
			return;
		}

		const geometry = triangulateLoops( loopResult.loops, plane, root.matrixWorld );
		if ( geometry === null ) {
			this.diagnostics.triangulationFailureCount += 1;
			this.diagnostics.lastFailureReason = 'triangulation-failed';
			return;
		}

		this.sourceMaterial = selectDominantMaterial( collection.segments );
		this.capMaterial = createSectionCapMaterial( this.sourceMaterial );
		this.syncMaterial( materialState );
		const cap = new THREE.Mesh( geometry, this.capMaterial );
		cap.name = '__section-cap';
		cap.userData.__sectionCap = true;
		cap.userData.__visualizationHelper = true;
		cap.userData.__nonSelectableHelper = true;
		this.capRoot = new THREE.Group();
		this.capRoot.name = '__section-cap-root';
		this.capRoot.userData.__sectionCap = true;
		this.capRoot.userData.__visualizationHelper = true;
		this.capRoot.add( cap );
		root.add( this.capRoot );
		this.sourceModelUuid = sourceModelUuid;
		this.diagnostics.triangleCount = geometry.getAttribute( 'position' ).count / 3;
		this.diagnostics.capMeshCount = 1;
		this.revision += 1;
		this.rebuildCount += 1;

	}

	private syncMaterial(state: SectionCapMaterialState): void {

		if ( this.capMaterial === null ) return;
		const material = this.capMaterial;
		const sourceColor = getMaterialColor( this.sourceMaterial );
		const xrayActive = state.mode === 'xray' && state.opacity < 100;
		const opacity = xrayActive ? mapXrayOpacityValue( state.opacity ) : 1;
		const needsUpdate = material.transparent !== xrayActive || material.depthWrite === xrayActive || material.side !== THREE.FrontSide;
		if ( sourceColor !== null ) material.color.copy( sourceColor );
		material.clippingPlanes = null;
		material.clipIntersection = false;
		material.clipShadows = false;
		material.depthTest = true;
		material.depthWrite = ! xrayActive;
		material.transparent = xrayActive;
		material.opacity = opacity;
		material.side = THREE.FrontSide;
		material.polygonOffset = true;
		material.polygonOffsetFactor = - 1;
		material.polygonOffsetUnits = - 1;
		if ( needsUpdate ) material.needsUpdate = true;
		this.lastMaterialSignature = getMaterialSignature( state, this.sourceMaterial );

	}

	private removeCap(): void {

		if ( this.capRoot !== null ) disposeCapObject( this.capRoot );
		this.capRoot = null;
		this.capMaterial = null;
		this.sourceMaterial = null;
		this.sourceModelUuid = null;

	}

}

function createDiagnostics(enabled: boolean): SectionCapDiagnostics {

	return {
		enabled,
		sourceMeshCount: 0,
		intersectedMeshCount: 0,
		segmentCount: 0,
		loopCount: 0,
		triangleCount: 0,
		capMeshCount: 0,
		skippedOpenChainCount: 0,
		triangulationFailureCount: 0
	};

}

function getMaterialState(options: SectionCapSyncOptions): SectionCapMaterialState {

	return {
		mode: options.materialMode ?? 'solid',
		opacity: THREE.MathUtils.clamp( options.opacity ?? 100, 0, 100 )
	};

}

function getGeometrySignature(root: THREE.Object3D, plane: THREE.Plane, sourceModelUuid: string | null | undefined): string {

	return [
		root.uuid,
		sourceModelUuid ?? '',
		...root.matrixWorld.elements.map( ( value ) => value.toFixed( 5 ) ),
		...plane.normal.toArray().map( ( value ) => value.toFixed( 5 ) ),
		plane.constant.toFixed( 5 )
	].join( ':' );

}

function getMaterialSignature(state: SectionCapMaterialState, source: THREE.Material | null): string {

	return `${state.mode}:${state.opacity}:${getMaterialColor( source )?.getHex() ?? 'default'}`;

}

function collectSegments(root: THREE.Object3D, plane: THREE.Plane): SegmentCollection {

	const result: SegmentCollection = { segments: [], sourceMeshCount: 0, intersectedMeshCount: 0 };
	const positionA = new THREE.Vector3();
	const positionB = new THREE.Vector3();
	const positionC = new THREE.Vector3();
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || object.userData.__sectionCap === true || object.userData.__enclosureShell === true || object.userData.__excludeFromSectionCap === true || object.userData.__visualizationHelper === true || isVisible( object ) === false ) return;
		const position = object.geometry.getAttribute( 'position' );
		if ( position === undefined ) return;
		result.sourceMeshCount += 1;
		const index = object.geometry.getIndex();
		const triangleCount = index === null ? Math.floor( position.count / 3 ) : Math.floor( index.count / 3 );
		let meshSegmentCount = 0;
		for ( let triangle = 0; triangle < triangleCount; triangle += 1 ) {
			const offset = triangle * 3;
			const a = index === null ? offset : index.getX( offset );
			const b = index === null ? offset + 1 : index.getX( offset + 1 );
			const c = index === null ? offset + 2 : index.getX( offset + 2 );
			positionA.fromBufferAttribute( position, a ).applyMatrix4( object.matrixWorld );
			positionB.fromBufferAttribute( position, b ).applyMatrix4( object.matrixWorld );
			positionC.fromBufferAttribute( position, c ).applyMatrix4( object.matrixWorld );
			const points = intersectionPoints( positionA, positionB, positionC, plane );
			if ( points.length !== 2 || points[ 0 ].distanceToSquared( points[ 1 ] ) < 1e-10 ) continue;
			const materialIndex = object.geometry.groups.find( ( group: THREE.GeometryGroup ) => offset >= group.start && offset < group.start + group.count )?.materialIndex ?? 0;
			const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
			const material = materials[ materialIndex ] ?? materials[ 0 ];
			result.segments.push( { a: points[ 0 ], b: points[ 1 ], material, length: points[ 0 ].distanceTo( points[ 1 ] ) } );
			meshSegmentCount += 1;
		}
		if ( meshSegmentCount > 0 ) result.intersectedMeshCount += 1;
	} );
	return result;

}

function intersectionPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, plane: THREE.Plane): THREE.Vector3[] {

	const points: THREE.Vector3[] = [];
	const vertices = [ a, b, c ];
	const epsilon = 1e-6;
	for ( const [ from, to ] of [ [ 0, 1 ], [ 1, 2 ], [ 2, 0 ] ] ) {
		const start = vertices[ from ];
		const end = vertices[ to ];
		const startDistance = plane.distanceToPoint( start );
		const endDistance = plane.distanceToPoint( end );
		if ( Math.abs( startDistance ) <= epsilon ) points.push( start.clone() );
		if ( startDistance * endDistance < - epsilon * epsilon ) points.push( start.clone().lerp( end, startDistance / ( startDistance - endDistance ) ) );
	}
	return uniquePoints( points, epsilon );

}

function uniquePoints(points: THREE.Vector3[], tolerance: number): THREE.Vector3[] {

	return points.filter( ( point, index ) => points.slice( 0, index ).every( ( previous ) => previous.distanceToSquared( point ) > tolerance * tolerance ) );

}

function buildLoops(segments: Segment[]): LoopBuildResult {

	const tolerance = 0.002;
	const nodes: THREE.Vector3[] = [];
	const edges: Array<[ number, number ]> = [];
	const nodeFor = ( point: THREE.Vector3 ) => {
		const existing = nodes.findIndex( ( node ) => node.distanceToSquared( point ) <= tolerance * tolerance );
		if ( existing >= 0 ) return existing;
		nodes.push( point.clone() );
		return nodes.length - 1;
	};
	for ( const segment of segments ) {
		const a = nodeFor( segment.a );
		const b = nodeFor( segment.b );
		if ( a !== b ) edges.push( [ a, b ] );
	}
	const neighbours = new Map<number, number[]>();
	for ( const [ a, b ] of edges ) {
		neighbours.set( a, [ ...( neighbours.get( a ) ?? [] ), b ] );
		neighbours.set( b, [ ...( neighbours.get( b ) ?? [] ), a ] );
	}
	const edgeId = ( a: number, b: number ) => `${Math.min( a, b )}:${Math.max( a, b )}`;
	const visited = new Set<string>();
	const loops: THREE.Vector3[][] = [];
	let skippedOpenChainCount = 0;
	for ( const [ startA, startB ] of edges ) {
		const firstEdge = edgeId( startA, startB );
		if ( visited.has( firstEdge ) ) continue;
		const loop = [ startA ];
		let previous = startA;
		let current = startB;
		visited.add( firstEdge );
		while ( current !== startA && loop.length <= edges.length ) {
			loop.push( current );
			const next = ( neighbours.get( current ) ?? [] ).find( ( node ) => node !== previous && visited.has( edgeId( current, node ) ) === false );
			if ( next === undefined ) break;
			visited.add( edgeId( current, next ) );
			previous = current;
			current = next;
		}
		if ( current === startA && loop.length >= 3 ) loops.push( loop.map( ( index ) => nodes[ index ] ) );
		else skippedOpenChainCount += 1;
	}
	return { loops, skippedOpenChainCount };

}

function selectDominantMaterial(segments: Segment[]): THREE.Material | null {

	const totals = new Map<THREE.Material, number>();
	for ( const segment of segments ) totals.set( segment.material, ( totals.get( segment.material ) ?? 0 ) + segment.length );
	return [ ...totals.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ]?.[ 0 ] ?? null;

}

function createSectionCapMaterial(source: THREE.Material | null): THREE.MeshStandardMaterial {

	return new THREE.MeshStandardMaterial( {
		color: getMaterialColor( source ) ?? 0x55734d,
		roughness: 0.8,
		metalness: 0,
		clippingPlanes: null,
		clipIntersection: false,
		clipShadows: false,
		depthTest: true,
		depthWrite: true,
		transparent: false,
		opacity: 1,
		side: THREE.FrontSide,
		polygonOffset: true,
		polygonOffsetFactor: - 1,
		polygonOffsetUnits: - 1
	} );

}

function getMaterialColor(material: THREE.Material | null): THREE.Color | null {

	const color = ( material as THREE.Material & { color?: THREE.Color } | null )?.color;
	return color instanceof THREE.Color ? color : null;

}

function triangulateLoops(loops: THREE.Vector3[][], plane: THREE.Plane, rootMatrixWorld: THREE.Matrix4): THREE.BufferGeometry | null {

	const normal = plane.normal;
	const tangent = Math.abs( normal.y ) < 0.9
		? new THREE.Vector3( 0, 1, 0 ).cross( normal ).normalize()
		: new THREE.Vector3( 1, 0, 0 ).cross( normal ).normalize();
	const bitangent = new THREE.Vector3().crossVectors( normal, tangent );
	const inverseRoot = rootMatrixWorld.clone().invert();
	const localToWorldNormal = new THREE.Matrix3().getNormalMatrix( rootMatrixWorld );
	const capFacingNormal = getSectionCapFacingNormal( plane ).normalize();
	const positions: number[] = [];
	const rings = loops.map( ( world ) => ( {
		world,
		projected: world.map( ( point ) => new THREE.Vector2( point.dot( tangent ), point.dot( bitangent ) ) )
	} ) );
	for ( const outer of rings ) {
		const depth = rings.filter( ( candidate ) => candidate !== outer && contains( candidate.projected, outer.projected[ 0 ] ) ).length;
		if ( depth % 2 !== 0 ) continue;
		const holes = rings.filter( ( candidate ) => candidate !== outer && contains( outer.projected, candidate.projected[ 0 ] ) && rings.filter( ( parent ) => parent !== candidate && contains( parent.projected, candidate.projected[ 0 ] ) ).length === depth + 1 );
		const contour = orientRing( outer, false );
		const holeRings = holes.map( ( hole ) => orientRing( hole, true ) );
		const vertices = [ ...contour, ...holeRings.flat() ];
		const triangles = THREE.ShapeUtils.triangulateShape( contour.map( ( point ) => point.projected ), holeRings.map( ( ring ) => ring.map( ( point ) => point.projected ) ) );
		for ( const triangle of triangles ) {
			const localA = vertices[ triangle[ 0 ] ].world.clone().applyMatrix4( inverseRoot );
			const localB = vertices[ triangle[ 1 ] ].world.clone().applyMatrix4( inverseRoot );
			const localC = vertices[ triangle[ 2 ] ].world.clone().applyMatrix4( inverseRoot );
			const localNormal = new THREE.Vector3().crossVectors( localB.clone().sub( localA ), localC.clone().sub( localA ) ).applyMatrix3( localToWorldNormal );
			const ordered = localNormal.dot( capFacingNormal ) >= 0 ? [ localA, localB, localC ] : [ localA, localC, localB ];
			for ( const point of ordered ) positions.push( point.x, point.y, point.z );
		}
	}
	if ( positions.length === 0 ) return null;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.computeVertexNormals();
	return geometry;

}

function contains(ring: THREE.Vector2[], point: THREE.Vector2): boolean {

	let inside = false;
	for ( let index = 0, previous = ring.length - 1; index < ring.length; previous = index++ ) {
		const a = ring[ index ];
		const b = ring[ previous ];
		if ( ( a.y > point.y ) !== ( b.y > point.y ) && point.x < ( b.x - a.x ) * ( point.y - a.y ) / ( b.y - a.y ) + a.x ) inside = ! inside;
	}
	return inside;

}

function orientRing(ring: { world: THREE.Vector3[]; projected: THREE.Vector2[] }, clockwise: boolean): Array<{ world: THREE.Vector3; projected: THREE.Vector2 }> {

	const points = ring.projected.map( ( projected, index ) => ( { world: ring.world[ index ], projected } ) );
	let area = 0;
	for ( let index = 0; index < points.length; index += 1 ) {
		const next = points[ ( index + 1 ) % points.length ].projected;
		area += points[ index ].projected.x * next.y - next.x * points[ index ].projected.y;
	}
	return ( area < 0 ) === clockwise ? points : points.reverse();

}

function disposeCapObject(capRoot: THREE.Object3D): void {

	capRoot.removeFromParent();
	capRoot.traverse( ( child ) => {
		if ( child instanceof THREE.Mesh === false ) return;
		child.geometry.dispose();
		const materials = Array.isArray( child.material ) ? child.material : [ child.material ];
		for ( const material of materials ) material.dispose();
	} );

}

function isVisible(object: THREE.Object3D): boolean {

	for ( let current: THREE.Object3D | null = object; current !== null; current = current.parent ) if ( current.visible === false ) return false;
	return true;

}
