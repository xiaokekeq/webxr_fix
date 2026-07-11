import * as THREE from 'three';
import {
	createCpuDepthOcclusionUniforms,
	syncCpuDepthOcclusionUniforms,
	type CpuDepthOcclusionUniforms
} from '@/engine/depth/cpu-depth-occlusion.js';
import type { CpuDepthFrame } from '@/engine/depth/real-depth-provider.js';

const PORTAL_SURFACE_NAME = '__underground-top-portal-surface';
const PORTAL_RENDER_ORDER = 40;
const PORTAL_SURFACE_LIFT_METERS = 0.002;
const PORTAL_MAX_RESOLUTION = 1024;
const PORTAL_MIN_RESOLUTION = 512;

const vertexShader = /* glsl */`
precision highp float;

out vec2 vPortalUv;
out vec4 vDepthClipPosition;
out float vPortalSurfaceDepthMeters;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clipPosition = projectionMatrix * mvPosition;
  vPortalUv = uv;
  vDepthClipPosition = clipPosition;
  vPortalSurfaceDepthMeters = -mvPosition.z;
  gl_Position = clipPosition;
}`;

const fragmentShader = /* glsl */`
precision highp float;
precision highp int;

uniform sampler2D uPortalColorTexture;
uniform bool uDepthOcclusionEnabled;
uniform highp usampler2D uRealDepthTexture;
uniform float uRawValueToMeters;
uniform mat4 uNormDepthBufferFromNormView;
uniform ivec2 uDepthTextureSize;
uniform float uForegroundThresholdMeters;
uniform float uDepthFeatherMeters;
uniform float uViewOpacity;

in vec2 vPortalUv;
in vec4 vDepthClipPosition;
in float vPortalSurfaceDepthMeters;
out vec4 outColor;

float sampleForegroundScore(ivec2 coord) {
  uint rawDepth = texelFetch(uRealDepthTexture, coord, 0).r;
  if (rawDepth == 0u) return -1.0;
  float realDepthMeters = float(rawDepth) * uRawValueToMeters;
  float foregroundDelta = vPortalSurfaceDepthMeters - realDepthMeters;
  return smoothstep(
    uForegroundThresholdMeters - uDepthFeatherMeters,
    uForegroundThresholdMeters + uDepthFeatherMeters,
    foregroundDelta
  );
}

float foregroundMask() {
  if (!uDepthOcclusionEnabled || any(lessThanEqual(uDepthTextureSize, ivec2(0)))) return 0.0;

  vec2 ndc = vDepthClipPosition.xy / vDepthClipPosition.w;
  vec2 normViewUv = ndc * 0.5 + 0.5;
  normViewUv.y = 1.0 - normViewUv.y;
  vec4 transformed = uNormDepthBufferFromNormView * vec4(normViewUv, 0.0, 1.0);
  vec2 depthUvTopLeft = transformed.xy / transformed.w;
  if (any(lessThan(depthUvTopLeft, vec2(0.0))) || any(greaterThan(depthUvTopLeft, vec2(1.0)))) return 0.0;

  vec2 depthTextureUv = vec2(depthUvTopLeft.x, 1.0 - depthUvTopLeft.y);
  ivec2 center = clamp(
    ivec2(depthTextureUv * vec2(uDepthTextureSize)),
    ivec2(0),
    uDepthTextureSize - ivec2(1)
  );
  float total = 0.0;
  float valid = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 coord = clamp(center + ivec2(x, y), ivec2(0), uDepthTextureSize - ivec2(1));
      float score = sampleForegroundScore(coord);
      if (score >= 0.0) {
        total += score;
        valid += 1.0;
      }
    }
  }
  return valid > 0.0 ? total / valid : 0.0;
}

void main() {
  vec4 portalColor = texture(uPortalColorTexture, vPortalUv);
  vec3 portalBackground = vec3(0.025, 0.055, 0.08);
  vec3 visibleColor = mix(portalBackground, portalColor.rgb, portalColor.a);
  float baseAlpha = mix(0.68, 1.0, portalColor.a) * uViewOpacity;
  float finalAlpha = baseAlpha * (1.0 - foregroundMask());
  if (finalAlpha < 0.01) discard;
  outColor = vec4(visibleColor, finalAlpha);
}`;

export interface UndergroundTopPortalPickResult {
	hitPortal: boolean;
	sourceObject: THREE.Object3D | null;
}

export class UndergroundTopPortal {
	private readonly renderScene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera();
	private readonly portalRaycaster = new THREE.Raycaster();
	private readonly sourceObjects = new Map<string, THREE.Object3D>();
	private readonly normal = new THREE.Vector3( 0, 1, 0 );
	private readonly center = new THREE.Vector3();
	private readonly cameraForward = new THREE.Vector3();
	private readonly previousViewport = new THREE.Vector4();
	private readonly previousScissor = new THREE.Vector4();
	private readonly previousClearColor = new THREE.Color();
	private sourceModel: THREE.Group | null = null;
	private sourceModelWasVisible = true;
	private renderModel: THREE.Group | null = null;
	private surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
	private renderTarget: THREE.WebGLRenderTarget | null = null;
	private uniforms: CpuDepthOcclusionUniforms & {
		uPortalColorTexture: { value: THREE.Texture | null };
		uForegroundThresholdMeters: { value: number };
		uDepthFeatherMeters: { value: number };
		uViewOpacity: { value: number };
	} | null = null;
	private cornersSignature = '';
	private matrixSignature = '';
	private portalDirty = true;

	constructor(private readonly scene: THREE.Scene) {

		this.renderScene.add( new THREE.HemisphereLight( 0xffffff, 0x52657a, 2.2 ) );
		const light = new THREE.DirectionalLight( 0xffffff, 1.6 );
		light.position.set( 3, 8, 4 );
		this.renderScene.add( light );

	}

	update(args: {
		renderer: THREE.WebGLRenderer;
		mainCamera: THREE.Camera;
		model: THREE.Group | null;
		footprintCorners: THREE.Vector3[];
		depthFrame: CpuDepthFrame;
		enabled: boolean;
	}): void {

		if (
			args.enabled === false
			|| args.model === null
			|| args.footprintCorners.length !== 4
			|| args.footprintCorners.some( ( point ) => point.toArray().some( ( value ) => Number.isFinite( value ) === false ) )
		) {
			this.hide();
			return;
		}

		this.setSourceModel( args.model );
		this.updateGeometry( args.renderer, args.footprintCorners );
		this.syncModelMatrix();
		this.ensureSurface();
		syncCpuDepthOcclusionUniforms( this.uniforms!, args.depthFrame );
		this.updateViewOpacity( args.mainCamera );
		this.sourceModel!.visible = false;
		this.surface!.visible = this.uniforms!.uViewOpacity.value > 0.001;
		if ( this.portalDirty ) {
			this.syncRenderModelState();
			this.render( args.renderer );
		}

	}

	pick(raycaster: THREE.Raycaster): UndergroundTopPortalPickResult {

		if ( this.surface === null || this.surface.visible === false ) {
			return { hitPortal: false, sourceObject: null };
		}
		const portalHit = raycaster.intersectObject( this.surface, false )[ 0 ];
		if ( portalHit?.uv === undefined ) {
			return { hitPortal: false, sourceObject: null };
		}
		this.portalRaycaster.setFromCamera(
			new THREE.Vector2( portalHit.uv.x * 2 - 1, portalHit.uv.y * 2 - 1 ),
			this.camera
		);
		const modelHit = this.renderModel === null
			? undefined
			: this.portalRaycaster.intersectObject( this.renderModel, true )
				.find( ( hit ) => hit.object.visible );
		const sourceId = modelHit?.object.userData.__portalSourceObjectId;
		return {
			hitPortal: true,
			sourceObject: typeof sourceId === 'string' ? this.sourceObjects.get( sourceId ) ?? null : null
		};

	}

	markDirty(): void {

		this.portalDirty = true;

	}

	reset(): void {

		this.restoreSourceVisibility();
		this.sourceModel = null;
		this.renderModel?.removeFromParent();
		this.renderModel = null;
		this.sourceObjects.clear();
		this.surface?.removeFromParent();
		this.surface?.geometry.dispose();
		this.surface?.material.dispose();
		this.surface = null;
		this.renderTarget?.dispose();
		this.renderTarget = null;
		this.uniforms = null;
		this.cornersSignature = '';
		this.matrixSignature = '';
		this.portalDirty = true;

	}

	dispose(): void {

		this.reset();

	}

	private hide(): void {

		this.restoreSourceVisibility();
		if ( this.surface !== null ) this.surface.visible = false;

	}

	private setSourceModel(model: THREE.Group): void {

		if ( this.sourceModel === model ) return;
		this.restoreSourceVisibility();
		this.sourceModel = model;
		this.sourceModelWasVisible = model.visible;
		this.rebuildRenderModel();

	}

	private restoreSourceVisibility(): void {

		if ( this.sourceModel !== null ) this.sourceModel.visible = this.sourceModelWasVisible;

	}

	private rebuildRenderModel(): void {

		this.renderModel?.removeFromParent();
		this.sourceObjects.clear();
		if ( this.sourceModel === null ) return;
		this.renderModel = this.sourceModel.clone( true );
		const sourceNodes: THREE.Object3D[] = [];
		const renderNodes: THREE.Object3D[] = [];
		this.sourceModel.traverse( ( object ) => sourceNodes.push( object ) );
		this.renderModel.traverse( ( object ) => renderNodes.push( object ) );
		for ( let index = 0; index < Math.min( sourceNodes.length, renderNodes.length ); index += 1 ) {
			const source = sourceNodes[ index ];
			const render = renderNodes[ index ];
			this.sourceObjects.set( source.uuid, source );
			render.userData.__portalSourceObjectId = source.uuid;
			if (
				index > 0
				&& ( source.userData.__nonSelectableHelper === true || source instanceof THREE.Sprite )
			) render.visible = false;
		}
		this.renderModel.matrixAutoUpdate = false;
		this.renderScene.add( this.renderModel );
		this.matrixSignature = '';
		this.portalDirty = true;

	}

	private updateGeometry(renderer: THREE.WebGLRenderer, corners: THREE.Vector3[]): void {

		const signature = corners.flatMap( ( point ) => point.toArray().map( ( value ) => value.toFixed( 5 ) ) ).join( ',' );
		if ( signature === this.cornersSignature ) return;
		this.cornersSignature = signature;
		const [ p0, p1, p2, p3 ] = corners.map( ( point ) => point.clone() );
		const axisU = p1.clone().sub( p0 ).normalize();
		const axisV = p3.clone().sub( p0 ).normalize();
		this.normal.crossVectors( axisU, axisV ).normalize();
		if ( this.normal.dot( new THREE.Vector3( 0, 1, 0 ) ) < 0 ) this.normal.negate();
		this.center.copy( p0 ).add( p1 ).add( p2 ).add( p3 ).multiplyScalar( 0.25 );
		const width = 0.5 * ( p0.distanceTo( p1 ) + p3.distanceTo( p2 ) );
		const height = 0.5 * ( p0.distanceTo( p3 ) + p1.distanceTo( p2 ) );
		this.camera.left = - width / 2;
		this.camera.right = width / 2;
		this.camera.top = height / 2;
		this.camera.bottom = - height / 2;
		this.camera.position.copy( this.center ).addScaledVector( this.normal, 1 );
		this.camera.up.copy( axisV );
		this.camera.lookAt( this.center.clone().addScaledVector( this.normal, -1 ) );
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld( true );

		const lifted = [ p0, p1, p2, p3 ].map( ( point ) => point.addScaledVector( this.normal, PORTAL_SURFACE_LIFT_METERS ) );
		const positions = [ lifted[ 0 ], lifted[ 1 ], lifted[ 2 ], lifted[ 0 ], lifted[ 2 ], lifted[ 3 ] ];
		const geometry = new THREE.BufferGeometry();
		geometry.setFromPoints( positions );
		geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1 ], 2 ) );
		this.surface?.geometry.dispose();
		if ( this.surface === null ) {
			this.surface = new THREE.Mesh( geometry, this.createMaterial() );
			this.surface.name = PORTAL_SURFACE_NAME;
			this.surface.frustumCulled = false;
			this.surface.renderOrder = PORTAL_RENDER_ORDER;
			this.surface.userData.__nonSelectableHelper = true;
			this.scene.add( this.surface );
		} else {
			this.surface.geometry = geometry;
		}
		this.resizeRenderTarget( renderer, width, height );
		this.portalDirty = true;

	}

	private createMaterial(): THREE.ShaderMaterial {

		this.uniforms = Object.assign( createCpuDepthOcclusionUniforms(), {
			uPortalColorTexture: { value: this.renderTarget?.texture ?? null },
			uForegroundThresholdMeters: { value: 0.05 },
			uDepthFeatherMeters: { value: 0.025 },
			uViewOpacity: { value: 1 }
		} );
		return new THREE.ShaderMaterial( {
			uniforms: this.uniforms,
			vertexShader,
			fragmentShader,
			glslVersion: THREE.GLSL3,
			transparent: true,
			depthTest: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			toneMapped: false
		} );

	}

	private ensureSurface(): void {

		if ( this.surface !== null && this.renderTarget !== null && this.uniforms !== null ) return;
		throw new Error( 'Portal surface is missing valid footprint geometry.' );

	}

	private resizeRenderTarget(renderer: THREE.WebGLRenderer, width: number, height: number): void {

		const maxSize = Math.min( PORTAL_MAX_RESOLUTION, renderer.capabilities.maxTextureSize );
		let targetWidth = maxSize;
		let targetHeight = Math.round( maxSize * height / width );
		if ( height > width ) {
			targetHeight = maxSize;
			targetWidth = Math.round( maxSize * width / height );
		}
		targetWidth = Math.min( maxSize, Math.max( PORTAL_MIN_RESOLUTION, targetWidth ) );
		targetHeight = Math.min( maxSize, Math.max( PORTAL_MIN_RESOLUTION, targetHeight ) );
		if ( this.renderTarget?.width === targetWidth && this.renderTarget.height === targetHeight ) return;
		this.renderTarget?.dispose();
		this.renderTarget = new THREE.WebGLRenderTarget( targetWidth, targetHeight, {
			format: THREE.RGBAFormat,
			type: THREE.UnsignedByteType,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			generateMipmaps: false,
			depthBuffer: true,
			stencilBuffer: false
		} );
		if ( renderer.capabilities.isWebGL2 ) {
			this.renderTarget.samples = Math.min( renderer.capabilities.maxSamples, 4 );
		}
		if ( this.uniforms !== null ) this.uniforms.uPortalColorTexture.value = this.renderTarget.texture;
		this.portalDirty = true;

	}

	private syncModelMatrix(): void {

		if ( this.sourceModel === null || this.renderModel === null ) return;
		this.sourceModel.updateMatrixWorld( true );
		const signature = this.sourceModel.matrixWorld.elements.map( ( value ) => value.toFixed( 6 ) ).join( ',' );
		if ( signature === this.matrixSignature ) return;
		this.matrixSignature = signature;
		this.renderModel.matrix.copy( this.sourceModel.matrixWorld );
		this.renderModel.matrixWorld.copy( this.sourceModel.matrixWorld );
		this.renderModel.updateMatrixWorld( true );
		const bounds = new THREE.Box3().setFromObject( this.renderModel );
		const size = bounds.getSize( new THREE.Vector3() );
		const boundsCenter = bounds.getCenter( new THREE.Vector3() );
		this.camera.far = Math.max( 50, this.camera.position.distanceTo( boundsCenter ) + size.length() + 10 );
		this.camera.updateProjectionMatrix();
		this.portalDirty = true;

	}

	private syncRenderModelState(): void {

		if ( this.renderModel === null ) return;
		this.renderModel.traverse( ( renderObject ) => {
			if ( renderObject === this.renderModel ) return;
			const sourceId = renderObject.userData.__portalSourceObjectId;
			const source = typeof sourceId === 'string' ? this.sourceObjects.get( sourceId ) : undefined;
			if ( source === undefined ) return;
			renderObject.visible = source.userData.__nonSelectableHelper === true || source instanceof THREE.Sprite
				? false
				: source.visible;
			if ( source instanceof THREE.Mesh && renderObject instanceof THREE.Mesh ) {
				renderObject.material = source.material;
			}
		} );

	}

	private updateViewOpacity(camera: THREE.Camera): void {

		camera.updateMatrixWorld( true );
		camera.getWorldDirection( this.cameraForward );
		const factor = this.cameraForward.dot( this.normal.clone().negate() );
		this.uniforms!.uViewOpacity.value = THREE.MathUtils.smoothstep( factor, 0.2, 0.45 );

	}

	private render(renderer: THREE.WebGLRenderer): void {

		if ( this.renderTarget === null ) return;
		const previousTarget = renderer.getRenderTarget();
		const previousXrEnabled = renderer.xr.enabled;
		const previousAutoClear = renderer.autoClear;
		const previousClearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( this.previousClearColor );
		renderer.getViewport( this.previousViewport );
		renderer.getScissor( this.previousScissor );
		const previousScissorTest = renderer.getScissorTest();
		try {
			renderer.xr.enabled = false;
			renderer.autoClear = false;
			renderer.setRenderTarget( this.renderTarget );
			renderer.setViewport( 0, 0, this.renderTarget.width, this.renderTarget.height );
			renderer.setScissorTest( false );
			renderer.setClearColor( 0x000000, 0 );
			renderer.clear( true, true, true );
			renderer.render( this.renderScene, this.camera );
			this.portalDirty = false;
		} finally {
			renderer.setRenderTarget( previousTarget );
			renderer.xr.enabled = previousXrEnabled;
			renderer.autoClear = previousAutoClear;
			renderer.setClearColor( this.previousClearColor, previousClearAlpha );
			renderer.setViewport( this.previousViewport );
			renderer.setScissor( this.previousScissor );
			renderer.setScissorTest( previousScissorTest );
		}

	}
}
