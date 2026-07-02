import type {
	ArSessionPhase,
	RegistrationStore
} from '@/localization/core/registration-store.js';

interface CreateArSessionStateRuntimeOptions {
	store: RegistrationStore;
	isPresenting(): boolean;
	hasGroundHit(): boolean;
	hasPlacedModel(): boolean;
	isCoarsePlacementPending(): boolean;
}

export interface ArSessionStateRuntime {
	handleSessionStart(): void;
	handleSessionEnd(): void;
	syncPhase(): void;
	markPlacementCommitted(committed?: boolean): void;
}

export function createArSessionStateRuntime(
	options: CreateArSessionStateRuntimeOptions
): ArSessionStateRuntime {

	const {
		store,
		isPresenting,
		hasGroundHit,
		hasPlacedModel,
		isCoarsePlacementPending
	} = options;

	let hasCommittedPlacement = false;

	return {
		handleSessionStart() {

			hasCommittedPlacement = false;
			store.patch( {
				appMode: 'ar-session',
				arSessionPhase: 'scanning',
				workspaceMode: 'registration',
				registrationStatusDetail: '\u72b6\u6001\uff1a\u626b\u63cf\u5e73\u9762\u4e2d'
			} );

		},

		handleSessionEnd() {

			hasCommittedPlacement = false;
			store.patch( {
				appMode: 'pre-ar',
				arSessionPhase: 'scanning',
				workspaceMode: 'browse',
				registrationStatusDetail: '\u72b6\u6001\uff1a\u7b49\u5f85\u8bc6\u522b\u5e73\u9762'
			} );

		},

		syncPhase() {

			if ( isPresenting() === false ) {
				hasCommittedPlacement = false;
				patchPhase( 'scanning' );
				return;
			}

			if ( isCoarsePlacementPending() ) {
				patchPhase( 'placing' );
				return;
			}

			if ( hasCommittedPlacement || hasPlacedModel() ) {
				hasCommittedPlacement = hasPlacedModel();
				patchPhase( 'placed' );
				return;
			}

			if ( hasGroundHit() ) {
				patchPhase( 'ready-to-place' );
				return;
			}

			patchPhase( 'scanning' );

		},

		markPlacementCommitted(committed = true) {

			hasCommittedPlacement = committed;

		}
	};

	function patchPhase(nextPhase: ArSessionPhase): void {

		if ( store.getState().arSessionPhase === nextPhase ) {
			return;
		}

		store.patch( { arSessionPhase: nextPhase } );

		switch ( nextPhase ) {
			case 'scanning':
				store.patch( { registrationStatusDetail: '\u72b6\u6001\uff1a\u626b\u63cf\u5e73\u9762\u4e2d' } );
				break;
			case 'ready-to-place':
				store.patch( { registrationStatusDetail: '\u72b6\u6001\uff1a\u5df2\u8bc6\u522b\u5e73\u9762\uff0c\u53ef\u5f00\u59cb\u653e\u7f6e' } );
				break;
			case 'placing':
				store.patch( { registrationStatusDetail: '\u72b6\u6001\uff1a\u6b63\u5728\u653e\u7f6e\u6a21\u578b' } );
				break;
			case 'placed':
				store.patch( { registrationStatusDetail: '\u72b6\u6001\uff1a\u6a21\u578b\u5df2\u653e\u7f6e' } );
				break;
		}

	}

}


