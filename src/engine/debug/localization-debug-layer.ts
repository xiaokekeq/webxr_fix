import * as THREE from 'three';

const geometry = new THREE.SphereGeometry( 0.045, 12, 8 );
const colors = {
	siteOrigin: 0x38bdf8,
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
const rtkLineMaterial = new THREE.LineBasicMaterial( { color: colors.rtk, depthTest: false, depthWrite: false, toneMapped: false } );
type DebugPoint = { position: THREE.Vector3; label: string; };

export class LocalizationDebugLayer {

	readonly root = new THREE.Group();

	constructor() {

		this.root.name = '__registration-debug-root';

	}

	sync(points: { siteOrigin: DebugPoint[]; marker: DebugPoint[]; rtk: DebugPoint[]; model: DebugPoint[]; }): void {

		this.clear();
		this.add( 'siteOrigin', points.siteOrigin );
		this.add( 'marker', points.marker );
		this.add( 'rtk', points.rtk );
		this.addRtkLine( points.rtk );
		this.add( 'model', points.model );

	}

	dispose(): void {

		this.clear();
		this.root.removeFromParent();
		geometry.dispose();
		Object.values( materials ).forEach( ( material ) => material.dispose() );
		rtkLineMaterial.dispose();

	}

	private clear(): void {

		this.root.traverse( ( object ) => {
			if ( object instanceof THREE.Sprite ) {
				object.material.map?.dispose();
				object.material.dispose();
			}
			if ( object instanceof THREE.Line ) object.geometry.dispose();
		} );
		this.root.clear();

	}

	private add(kind: keyof typeof colors, points: DebugPoint[]): void {

		for ( const point of points ) {
			const sphere = new THREE.Mesh( geometry, materials[ kind ] );
			sphere.name = `registration-${kind}-point`;
			sphere.position.copy( point.position );
			this.root.add( sphere );
			const label = createLabel( point.label, colors[ kind ] );
			label.position.copy( point.position ).add( new THREE.Vector3( 0, 0.1, 0 ) );
			this.root.add( label );
		}

	}

	private addRtkLine(points: DebugPoint[]): void {

		if ( points.length < 2 ) return;
		const line = new THREE.LineLoop( new THREE.BufferGeometry().setFromPoints( points.map( ( point ) => point.position ) ), rtkLineMaterial );
		line.name = 'registration-rtk-line';
		this.root.add( line );

	}

}

function createLabel(text: string, color: number): THREE.Sprite {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 256;
	canvas.height = 64;
	const context = canvas.getContext( '2d' );
	if ( context !== null ) {
		context.font = 'bold 26px sans-serif';
		context.fillStyle = 'rgba(0,0,0,0.72)';
		context.fillRect( 0, 0, canvas.width, canvas.height );
		context.fillStyle = `#${color.toString( 16 ).padStart( 6, '0' )}`;
		context.fillText( text, 12, 42 );
	}
	const sprite = new THREE.Sprite( new THREE.SpriteMaterial( {
		map: new THREE.CanvasTexture( canvas ), transparent: true, depthTest: false, depthWrite: false, toneMapped: false
	} ) );
	sprite.scale.set( 0.32, 0.08, 1 );
	return sprite;

}
