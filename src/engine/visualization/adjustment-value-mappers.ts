export function mapXrayOpacityValue(value: number): number {
	return 0.05 + Math.min( 100, Math.max( 0, value ) ) / 100 * 0.95;
}

export function mapLayerPeelingValue(value: number, layerCount: number): number {
	if ( layerCount <= 1 ) return 0;
	const visibleLayerCount = 1 + Math.round( Math.min( 100, Math.max( 0, value ) ) / 100 * ( layerCount - 1 ) );
	return layerCount - visibleLayerCount;
}

export function mapHiddenLayerCountToValue(hiddenLayerCount: number, layerCount: number): number {
	if ( layerCount <= 1 ) return 100;
	return Math.round( ( layerCount - Math.min( layerCount - 1, Math.max( 0, hiddenLayerCount ) ) - 1 ) / ( layerCount - 1 ) * 100 );
}
