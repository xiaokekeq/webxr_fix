import { computed } from 'vue';
import { useRoute } from 'vue-router';
import damContent from '@/data/dam-ui.json';
import { type WaterNetworkUiContent, waterNetworkUi } from './water-network-ui.js';

export type ProductId = 'dam' | 'water-network';

export const productUis: Record<ProductId, WaterNetworkUiContent> = {
	dam: damContent as WaterNetworkUiContent,
	'water-network': waterNetworkUi
};

export function useProductUi() {
	const route = useRoute();
	const productId = computed<ProductId>( () => route.meta.product === 'water-network' ? 'water-network' : 'dam' );
	const ui = computed( () => productUis[ productId.value ] );

	return { productId, ui };
}
