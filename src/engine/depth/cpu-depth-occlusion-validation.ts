import * as THREE from 'three';
import {
	createCpuDepthOcclusionUniforms,
	syncCpuDepthOcclusionUniforms,
	type CpuDepthOcclusionUniforms
} from './cpu-depth-occlusion.js';
import type { CpuDepthFrame } from './real-depth-provider.js';

const VALIDATION_GROUP_NAME = '__cpu-depth-occlusion-validation';

const vertexShader = /* glsl */`
precision highp float;

out vec4 vDepthClipPosition;
out float vVirtualDepthMeters;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clipPosition = projectionMatrix * mvPosition;
  vDepthClipPosition = clipPosition;
  vVirtualDepthMeters = -mvPosition.z;
  gl_Position = clipPosition;
}`;

const fragmentShader = /* glsl */`
precision highp float;
precision highp int;

uniform bool uDepthOcclusionEnabled;
uniform highp usampler2D uRealDepthTexture;
uniform float uRawValueToMeters;
uniform mat4 uNormDepthBufferFromNormView;
uniform float uDepthBiasMeters;

in vec4 vDepthClipPosition;
in float vVirtualDepthMeters;
out vec4 outColor;

void main() {
  if (uDepthOcclusionEnabled) {
    vec2 ndc = vDepthClipPosition.xy / vDepthClipPosition.w;
    vec2 normViewUv = ndc * 0.5 + 0.5;
    normViewUv.y = 1.0 - normViewUv.y;
    vec4 transformedDepthUv = uNormDepthBufferFromNormView * vec4(normViewUv, 0.0, 1.0);
    vec2 depthUvTopLeft = transformedDepthUv.xy / transformedDepthUv.w;
    bool insideDepthTexture = depthUvTopLeft.x >= 0.0 && depthUvTopLeft.x <= 1.0
      && depthUvTopLeft.y >= 0.0 && depthUvTopLeft.y <= 1.0;

    if (insideDepthTexture) {
      vec2 depthTextureUv = vec2(depthUvTopLeft.x, 1.0 - depthUvTopLeft.y);
      uint rawDepth = texture(uRealDepthTexture, depthTextureUv).r;
      if (rawDepth != 0u) {
        float realDepthMeters = float(rawDepth) * uRawValueToMeters;
        if (realDepthMeters < vVirtualDepthMeters - uDepthBiasMeters) discard;
      }
    }
  }

  outColor = vec4(0.2, 0.7, 1.0, 1.0);
}`;

export interface CpuDepthOcclusionValidationState {
	enabled: boolean;
	placed: boolean;
	occlusionEnabled: boolean;
}

export class CpuDepthOcclusionValidation {
	private readonly group = new THREE.Group();
	private readonly cameraPosition = new THREE.Vector3();
	private readonly cameraForward = new THREE.Vector3();
	private uniforms: CpuDepthOcclusionUniforms | null = null;
	private geometry: THREE.BoxGeometry | null = null;
	private material: THREE.ShaderMaterial | null = null;
	private enabled = false;
	private placed = false;

	constructor(private readonly scene: THREE.Scene) {

		this.group.name = VALIDATION_GROUP_NAME;

	}

	setEnabled(enabled: boolean): void {

		if ( this.enabled === enabled ) return;
		this.enabled = enabled;
		if ( enabled === false ) this.clear();

	}

	update(camera: THREE.Camera, frame: CpuDepthFrame): void {

		if ( this.enabled === false ) return;
		this.ensureMesh();
		syncCpuDepthOcclusionUniforms( this.uniforms!, frame );
		if ( this.placed ) return;

		camera.updateMatrixWorld();
		camera.getWorldPosition( this.cameraPosition );
		camera.getWorldDirection( this.cameraForward );
		this.group.position.copy( this.cameraPosition ).addScaledVector( this.cameraForward, 1 );
		this.group.position.y -= 0.25;
		this.placed = true;

	}

	getState(): CpuDepthOcclusionValidationState {

		return {
			enabled: this.enabled,
			placed: this.placed,
			occlusionEnabled: this.uniforms?.uDepthOcclusionEnabled.value === true
		};

	}

	dispose(): void {

		this.enabled = false;
		this.clear();

	}

	private ensureMesh(): void {

		if ( this.material !== null ) return;
		this.uniforms = createCpuDepthOcclusionUniforms();
		this.geometry = new THREE.BoxGeometry( 0.25, 0.25, 0.25 );
		this.material = new THREE.ShaderMaterial( {
			uniforms: this.uniforms,
			vertexShader,
			fragmentShader,
			glslVersion: THREE.GLSL3,
			depthWrite: true,
			toneMapped: false
		} );
		this.group.add( new THREE.Mesh( this.geometry, this.material ) );
		this.scene.add( this.group );

	}

	private clear(): void {

		this.group.removeFromParent();
		this.group.clear();
		this.geometry?.dispose();
		this.material?.dispose();
		this.geometry = null;
		this.material = null;
		this.uniforms = null;
		this.placed = false;

	}
}
