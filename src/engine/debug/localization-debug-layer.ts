import * as THREE from 'three';

const geometry = new THREE.SphereGeometry( 0.045, 12, 8 );
const colors = {
	marker: 0x00d4ff,
	rtk: 0xffd84d,
	model: 0xff4dff
};
const materials = Object.fromEntries(
	Object.entries( colors ).map( ( [ kind, color ] ) => [ kind, new THREE.MeshBasicMaterial( {
		color,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	} ) ] )
) as Record<keyof typeof colors, THREE.MeshBasicMaterial>;

export class LocalizationDebugLayer {

	readonly root = new THREE.Group();

	constructor() {

		this.root.name = '__registration-debug-root';

	}

	sync(points: { marker: THREE.Vector3[]; rtk: THREE.Vector3[]; model: THREE.Vector3[]; }): void {

		this.root.clear();
		this.add( 'marker', points.marker );
		this.add( 'rtk', points.rtk );
		this.add( 'model', points.model );

	}

	dispose(): void {

		this.root.clear();
		this.root.removeFromParent();
		geometry.dispose();
		Object.values( materials ).forEach( ( material ) => material.dispose() );

	}

	private add(kind: keyof typeof colors, points: THREE.Vector3[]): void {

		for ( const point of points ) {
			const sphere = new THREE.Mesh( geometry, materials[ kind ] );
			sphere.name = `registration-${kind}-point`;
			sphere.position.copy( point );
			this.root.add( sphere );
		}

	}

}
