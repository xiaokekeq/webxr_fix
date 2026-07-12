import * as THREE from 'three';

export interface PortalRenderProxyBuildResult {
	root: THREE.Object3D;
	sourceToProxy: Map<THREE.Object3D, THREE.Object3D>;
	proxyToSource: Map<THREE.Object3D, THREE.Object3D>;
	sourceRenderableCount: number;
	proxyRenderableCount: number;
	includedAnnotatedRenderableCount: number;
	skippedHelperRenderableCount: number;
	skippedUnsupportedRenderableCount: number;
	skippedHelperCount: number;
}

export function buildPortalRenderProxy(sourceRoot: THREE.Object3D): PortalRenderProxyBuildResult {

	const sourceToProxy = new Map<THREE.Object3D, THREE.Object3D>();
	const proxyToSource = new Map<THREE.Object3D, THREE.Object3D>();
	let skippedHelperCount = 0;
	let skippedHelperRenderableCount = 0;
	let includedAnnotatedRenderableCount = 0;
	const buildNode = ( source: THREE.Object3D ): THREE.Object3D | null => {
		if ( shouldIncludeInPortalProxy( source ) === false ) {
			skippedHelperCount += 1;
			if ( isRenderable( source ) ) skippedHelperRenderableCount += 1;
			return null;
		}
		if ( isRenderable( source ) && source.userData.__annotationItem !== undefined ) includedAnnotatedRenderableCount += 1;
		const proxy = createProxyNode( source );
		copyRenderTransform( source, proxy );
		proxy.userData.__portalSourceObjectId = source.uuid;
		sourceToProxy.set( source, proxy );
		proxyToSource.set( proxy, source );
		for ( const child of source.children ) {
			const proxyChild = buildNode( child );
			if ( proxyChild !== null ) proxy.add( proxyChild );
		}
		return proxy;
	};
	const root = buildNode( sourceRoot );
	if ( root === null ) throw new Error( 'render-proxy-empty' );
	const sourceRenderableCount = countRenderable( sourceRoot );
	const proxyRenderableCount = countRenderable( root );
	if ( sourceToProxy.size !== proxyToSource.size ) throw new Error( 'render-proxy-tree-mismatch' );
	if ( proxyRenderableCount === 0 ) throw new Error( 'render-proxy-empty' );
	if ( import.meta.env.DEV ) assertProxyUserData( root );
	return {
		root, sourceToProxy, proxyToSource, sourceRenderableCount, proxyRenderableCount,
		includedAnnotatedRenderableCount, skippedHelperRenderableCount,
		skippedUnsupportedRenderableCount: 0, skippedHelperCount
	};

}

function createProxyNode(source: THREE.Object3D): THREE.Object3D {

	if ( source instanceof THREE.SkinnedMesh ) throw new Error( 'render-proxy-unsupported-skinned-mesh' );
	if ( source instanceof THREE.InstancedMesh ) {
		const proxy = new THREE.InstancedMesh( source.geometry, source.material, source.count );
		proxy.instanceMatrix.copy( source.instanceMatrix );
		proxy.instanceColor = source.instanceColor === null ? null : source.instanceColor.clone() as THREE.InstancedBufferAttribute;
		proxy.boundingBox = source.boundingBox?.clone() ?? null;
		proxy.boundingSphere = source.boundingSphere?.clone() ?? null;
		return proxy;
	}
	if ( source instanceof THREE.Mesh ) return new THREE.Mesh( source.geometry, source.material );
	if ( source instanceof THREE.LineSegments ) return new THREE.LineSegments( source.geometry, source.material );
	if ( source instanceof THREE.Line ) return new THREE.Line( source.geometry, source.material );
	if ( source instanceof THREE.Points ) return new THREE.Points( source.geometry, source.material );
	if ( source instanceof THREE.Group ) return new THREE.Group();
	if ( source.type === 'Object3D' ) return new THREE.Object3D();
	throw new Error( `render-proxy-unsupported-object-type:${source.type}` );

}

function copyRenderTransform(source: THREE.Object3D, proxy: THREE.Object3D): void {

	proxy.name = source.name;
	proxy.position.copy( source.position );
	proxy.quaternion.copy( source.quaternion );
	proxy.scale.copy( source.scale );
	proxy.matrix.copy( source.matrix );
	proxy.matrixAutoUpdate = source.matrixAutoUpdate;
	proxy.visible = source.visible;
	proxy.layers.mask = source.layers.mask;
	proxy.renderOrder = source.renderOrder;
	proxy.frustumCulled = source.frustumCulled;
	proxy.castShadow = source.castShadow;
	proxy.receiveShadow = source.receiveShadow;

}

function shouldIncludeInPortalProxy(source: THREE.Object3D): boolean {

	return source instanceof THREE.Sprite === false
		&& source.userData.__nonSelectableHelper !== true
		&& source.userData.__visualizationHelper !== true;

}

function countRenderable(root: THREE.Object3D): number {

	let count = 0;
	root.traverse( ( object ) => {
		if ( shouldIncludeInPortalProxy( object ) && isRenderable( object ) ) count += 1;
	} );
	return count;

}

function isRenderable(object: THREE.Object3D): boolean {

	return object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points;

}

function assertProxyUserData(root: THREE.Object3D): void {

	root.traverse( ( object ) => {
		if ( Object.values( object.userData ).some( ( value ) => value instanceof THREE.Object3D || typeof value === 'function' ) ) {
			throw new Error( 'render-proxy-userdata-cycle' );
		}
	} );

}
