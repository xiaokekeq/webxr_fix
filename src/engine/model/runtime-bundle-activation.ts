import type { LoadedModelRuntimeBundle } from './runtime.js';

export type ModelRuntimeActivationResult =
	| { ok: true }
	| { ok: false; stage: 'runtime-activation'; reason: string; error: unknown };

export function activateRuntimeBundle(
	bundle: LoadedModelRuntimeBundle,
	installCore: (bundle: LoadedModelRuntimeBundle) => void,
	commitReady: () => void
): ModelRuntimeActivationResult {

	try {
		installCore( bundle );
		commitReady();
		return { ok: true };
	} catch ( error ) {
		return { ok: false, stage: 'runtime-activation', reason: 'core-runtime-activation-failed', error };
	}

}
