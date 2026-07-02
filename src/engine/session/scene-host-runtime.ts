import type * as THREE from 'three';
import type { ARSceneBundle } from '@/features/ar/types/runtime-types.js';

export interface SceneHostRuntimeHosts {
	canvasHost: HTMLElement;
	xrButtonHost: HTMLElement;
}

interface CreateSceneHostRuntimeOptions {
	sceneBundle: ARSceneBundle;
	resizeScene(
		camera: THREE.PerspectiveCamera,
		renderer: THREE.WebGLRenderer,
		host: HTMLElement | null
	): void;
}

export interface SceneHostRuntime {
	mount(hosts: SceneHostRuntimeHosts, xrButtonWrap: HTMLElement): void;
	sync(): void;
	resize(): void;
}

export function createSceneHostRuntime(
	options: CreateSceneHostRuntimeOptions
): SceneHostRuntime {

	const { sceneBundle, resizeScene } = options;

	let hosts: SceneHostRuntimeHosts | null = null;

	return {
		mount(nextHosts, xrButtonWrap) {

			hosts = nextHosts;
			if ( xrButtonWrap.parentElement !== nextHosts.xrButtonHost ) {
				nextHosts.xrButtonHost.appendChild( xrButtonWrap );
			}

		},

		sync() {

			if ( hosts === null ) {
				return;
			}

			if ( sceneBundle.renderer.domElement.parentElement !== hosts.canvasHost ) {
				hosts.canvasHost.appendChild( sceneBundle.renderer.domElement );
			}

			resizeScene( sceneBundle.camera, sceneBundle.renderer, hosts.canvasHost );
			sceneBundle.renderer.render( sceneBundle.scene, sceneBundle.camera );

		},

		resize() {

			const host = sceneBundle.renderer.domElement.parentElement;
			resizeScene( sceneBundle.camera, sceneBundle.renderer, host );
			sceneBundle.renderer.render( sceneBundle.scene, sceneBundle.camera );

		}
	};

}
