import type { RegistrationStore } from '@/localization/core/registration-store.js';
import type { SetStatus } from '@/features/ar/types/runtime-types.js';

interface CreateStatusRuntimeOptions {
	store: RegistrationStore;
	updateStatusText: SetStatus;
}

export interface StatusRuntime {
	setStatus(message: string): void;
	updateRegistrationStatusDetail(message: string): void;
}

export function createStatusRuntime(options: CreateStatusRuntimeOptions): StatusRuntime {

	const { store, updateStatusText } = options;

	return {
		setStatus(message) {

			updateStatusText( message );
			store.patch( { runtimeStatus: message } );

		},

		updateRegistrationStatusDetail(message) {

			store.patch( { registrationStatusDetail: message } );

		}
	};

}
