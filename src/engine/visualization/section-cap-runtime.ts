import * as THREE from 'three';

interface Segment { a: THREE.Vector3; b: THREE.Vector3; material: THREE.Material; length: number; }

export class SectionCapRuntime {
	private currentRoot: THREE.Object3D | null = null;
	private revision = 0;
	private rebuildCount = 0;
	private lastSignature = '';
	private capRoot: THREE.Group | null = null;

	sync(root: THREE.Object3D | null, plane: THREE.Plane | null, force = false): void {
		if ( root === null || plane === null ) { this.hide(); this.currentRoot = root; return; }
		const signature = [ root.uuid, ...plane.normal.toArray().map( ( value ) => value.toFixed( 5 ) ), plane.constant.toFixed( 5 ) ].join( ':' );
		if ( force === false && signature === this.lastSignature ) return;
		this.currentRoot = root; this.lastSignature = signature; this.rebuild( root, plane );
	}

	hide(): void { if ( this.capRoot !== null ) this.capRoot.visible = false; this.lastSignature = ''; }
	dispose(): void { this.removeCap(); this.currentRoot = null; this.lastSignature = ''; }

	getDebug() { return { sectionCapEnabled: this.capRoot !== null, sectionCapVisible: this.capRoot?.visible === true, sectionCapMeshCount: this.capRoot?.children.length ?? 0, sectionCapTriangleCount: this.capRoot?.children.reduce( ( total, child ) => total + ( child instanceof THREE.Mesh ? ( child.geometry.getIndex()?.count ?? child.geometry.getAttribute( 'position' ).count ) / 3 : 0 ), 0 ) ?? 0, sectionCapRevision: this.revision, sectionCapRebuildCount: this.rebuildCount }; }

	private rebuild(root: THREE.Object3D, plane: THREE.Plane): void {
		this.removeCap();
		root.updateWorldMatrix( true, true );
		const segments = collectSegments( root, plane );
		const loops = buildLoops( segments, plane );
		if ( loops.length === 0 ) return;
		const material = selectMaterial( segments );
		const geometry = triangulateLoops( loops, plane, root.matrixWorld.clone().invert() );
		if ( geometry === null ) return;
		const cap = new THREE.Mesh( geometry, material );
		cap.name = '__section-cap'; cap.userData.__sectionCap = true; cap.userData.__visualizationHelper = true; cap.userData.__nonSelectableHelper = true;
		this.capRoot = new THREE.Group(); this.capRoot.name = '__section-cap-root'; this.capRoot.userData.__sectionCap = true; this.capRoot.userData.__visualizationHelper = true; this.capRoot.add( cap ); root.add( this.capRoot );
		this.revision += 1; this.rebuildCount += 1;
	}

	private removeCap(): void {
		if ( this.capRoot === null ) return;
		this.capRoot.removeFromParent();
		this.capRoot.traverse( ( child ) => { if ( child instanceof THREE.Mesh ) { child.geometry.dispose(); const materials = Array.isArray( child.material ) ? child.material : [ child.material ]; materials.forEach( ( material ) => material.dispose() ); } } );
		this.capRoot = null;
	}
}

function collectSegments(root: THREE.Object3D, plane: THREE.Plane): Segment[] {
	const segments: Segment[] = []; const positionA = new THREE.Vector3(); const positionB = new THREE.Vector3(); const positionC = new THREE.Vector3();
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || object.userData.__sectionCap === true || object.userData.__visualizationHelper === true || isVisible( object ) === false ) return;
		const position = object.geometry.getAttribute( 'position' ); if ( position === undefined ) return;
		const index = object.geometry.getIndex(); const triangleCount = index === null ? Math.floor( position.count / 3 ) : Math.floor( index.count / 3 );
		for ( let triangle = 0; triangle < triangleCount; triangle += 1 ) {
			const offset = triangle * 3; const ids = [ index === null ? offset : index.getX( offset ), index === null ? offset + 1 : index.getX( offset + 1 ), index === null ? offset + 2 : index.getX( offset + 2 ) ];
			positionA.fromBufferAttribute( position, ids[ 0 ] ).applyMatrix4( object.matrixWorld ); positionB.fromBufferAttribute( position, ids[ 1 ] ).applyMatrix4( object.matrixWorld ); positionC.fromBufferAttribute( position, ids[ 2 ] ).applyMatrix4( object.matrixWorld );
			const points = intersectionPoints( positionA, positionB, positionC, plane );
			if ( points.length !== 2 || points[ 0 ].distanceToSquared( points[ 1 ] ) < 1e-10 ) continue;
			const materialIndex = object.geometry.groups.find( ( group: THREE.GeometryGroup ) => offset >= group.start && offset < group.start + group.count )?.materialIndex ?? 0;
			const materials = Array.isArray( object.material ) ? object.material : [ object.material ]; const material = materials[ materialIndex ] ?? materials[ 0 ];
			segments.push( { a: points[ 0 ], b: points[ 1 ], material, length: points[ 0 ].distanceTo( points[ 1 ] ) } );
		}
	} );
	return segments;
}

function intersectionPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, plane: THREE.Plane): THREE.Vector3[] {
	const points: THREE.Vector3[] = []; const vertices = [ a, b, c ]; const epsilon = 1e-6;
	for ( const [ from, to ] of [ [ 0, 1 ], [ 1, 2 ], [ 2, 0 ] ] ) {
		const start = vertices[ from ]; const end = vertices[ to ]; const da = plane.distanceToPoint( start ); const db = plane.distanceToPoint( end );
		if ( Math.abs( da ) <= epsilon ) points.push( start.clone() );
		if ( da * db < - epsilon * epsilon ) points.push( start.clone().lerp( end, da / ( da - db ) ) );
	}
	return uniquePoints( points, epsilon );
}

function uniquePoints(points: THREE.Vector3[], tolerance: number): THREE.Vector3[] { return points.filter( ( point, index ) => points.slice( 0, index ).every( ( previous ) => previous.distanceToSquared( point ) > tolerance * tolerance ) ); }

function buildLoops(segments: Segment[], plane: THREE.Plane): THREE.Vector3[][] {
	const tolerance = 0.002; const nodes: THREE.Vector3[] = []; const edges: Array<[ number, number ]> = [];
	const nodeFor = ( point: THREE.Vector3 ) => { const existing = nodes.findIndex( ( node ) => node.distanceToSquared( point ) <= tolerance * tolerance ); if ( existing >= 0 ) return existing; nodes.push( point.clone() ); return nodes.length - 1; };
	segments.forEach( ( segment ) => edges.push( [ nodeFor( segment.a ), nodeFor( segment.b ) ] ) );
	const neighbours = new Map<number, number[]>(); edges.forEach( ( [ a, b ] ) => { neighbours.set( a, [ ...( neighbours.get( a ) ?? [] ), b ] ); neighbours.set( b, [ ...( neighbours.get( b ) ?? [] ), a ] ); } );
	const visited = new Set<string>(); const loops: THREE.Vector3[][] = [];
	for ( const [ startA, startB ] of edges ) {
		const edgeId = `${Math.min( startA, startB )}:${Math.max( startA, startB )}`; if ( visited.has( edgeId ) ) continue;
		const loop = [ startA ]; let previous = startA; let current = startB; visited.add( edgeId );
		while ( current !== startA && loop.length <= edges.length ) {
			loop.push( current ); const next = ( neighbours.get( current ) ?? [] ).find( ( node ) => node !== previous && visited.has( `${Math.min( current, node )}:${Math.max( current, node )}` ) === false );
			if ( next === undefined ) break; visited.add( `${Math.min( current, next )}:${Math.max( current, next )}` ); previous = current; current = next;
		}
		if ( current === startA && loop.length >= 3 ) loops.push( loop.map( ( index ) => nodes[ index ] ) );
	}
	return loops;
}

function selectMaterial(segments: Segment[]): THREE.Material {
	const totals = new Map<THREE.Material, number>(); segments.forEach( ( segment ) => totals.set( segment.material, ( totals.get( segment.material ) ?? 0 ) + segment.length ) );
	const source = [ ...totals.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ]?.[ 0 ] ?? new THREE.MeshStandardMaterial( { color: 0x55734d } );
	const material = source.clone(); material.clippingPlanes = null; material.clipIntersection = false; material.clipShadows = false; material.side = THREE.FrontSide; material.polygonOffset = true; material.polygonOffsetFactor = - 1; material.polygonOffsetUnits = - 1; material.needsUpdate = true;
	return material;
}

function triangulateLoops(loops: THREE.Vector3[][], plane: THREE.Plane, inverseRoot: THREE.Matrix4): THREE.BufferGeometry | null {
	const normal = plane.normal; const tangent = Math.abs( normal.y ) < 0.9 ? new THREE.Vector3( 0, 1, 0 ).cross( normal ).normalize() : new THREE.Vector3( 1, 0, 0 ).cross( normal ).normalize(); const bitangent = new THREE.Vector3().crossVectors( normal, tangent );
	const positions: number[] = []; const uvs: number[] = [];
	const rings = loops.map( ( world ) => ( { world, projected: world.map( ( point ) => new THREE.Vector2( point.dot( tangent ), point.dot( bitangent ) ) ) } ) );
	for ( const outer of rings ) {
		const depth = rings.filter( ( candidate ) => candidate !== outer && contains( candidate.projected, outer.projected[ 0 ] ) ).length;
		if ( depth % 2 !== 0 ) continue;
		const holes = rings.filter( ( candidate ) => candidate !== outer && contains( outer.projected, candidate.projected[ 0 ] ) && rings.filter( ( parent ) => parent !== candidate && contains( parent.projected, candidate.projected[ 0 ] ) ).length === depth + 1 );
		const contour = orientRing( outer, false ); const holeRings = holes.map( ( hole ) => orientRing( hole, true ) );
		const vertices = [ ...contour, ...holeRings.flat() ]; const triangles = THREE.ShapeUtils.triangulateShape( contour.map( ( point ) => point.projected ), holeRings.map( ( ring ) => ring.map( ( point ) => point.projected ) ) );
		for ( const triangle of triangles ) {
			const ordered = new THREE.Vector3().crossVectors( vertices[ triangle[ 1 ] ].world.clone().sub( vertices[ triangle[ 0 ] ].world ), vertices[ triangle[ 2 ] ].world.clone().sub( vertices[ triangle[ 0 ] ].world ) ).dot( normal ) >= 0 ? triangle : [ triangle[ 0 ], triangle[ 2 ], triangle[ 1 ] ];
			for ( const index of ordered ) { const point = vertices[ index ].world.clone().applyMatrix4( inverseRoot ); positions.push( point.x, point.y, point.z ); uvs.push( vertices[ index ].projected.x, vertices[ index ].projected.y ); }
		}
	}
	if ( positions.length === 0 ) return null;
	const geometry = new THREE.BufferGeometry(); geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) ); geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) ); geometry.computeVertexNormals(); return geometry;
}

function contains(ring: THREE.Vector2[], point: THREE.Vector2): boolean {
	let inside = false;
	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i++ ) {
		const a = ring[ i ]; const b = ring[ j ];
		if ( ( a.y > point.y ) !== ( b.y > point.y ) && point.x < ( b.x - a.x ) * ( point.y - a.y ) / ( b.y - a.y ) + a.x ) inside = ! inside;
	}
	return inside;
}

function orientRing(ring: { world: THREE.Vector3[]; projected: THREE.Vector2[] }, clockwise: boolean): Array<{ world: THREE.Vector3; projected: THREE.Vector2 }> {
	const points = ring.projected.map( ( projected, index ) => ( { world: ring.world[ index ], projected } ) );
	let area = 0; for ( let index = 0; index < points.length; index += 1 ) { const next = points[ ( index + 1 ) % points.length ].projected; area += points[ index ].projected.x * next.y - next.x * points[ index ].projected.y; }
	return ( area < 0 ) === clockwise ? points : points.reverse();
}

function isVisible(object: THREE.Object3D): boolean { for ( let current: THREE.Object3D | null = object; current !== null; current = current.parent ) if ( current.visible === false ) return false; return true; }
