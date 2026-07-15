import type {
	ArWorkflowMode,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';
import type {
	InspectionPlacementSource
} from '@/localization/core/registration-store.js';

const STATUS_MANUAL_MARKER_READY = '请确认控制标志编号，进入 AR 后按顺序采集 Marker 四角点完成空间校正。';
const STATUS_MANUAL_MARKER_PLANE_READY = 'hit-test 已就绪，请继续采集 Marker 四角点；平面检测不会直接放置正式模型。';

interface InspectionMarkerWorkflowOptions {
	getWorkflowMode(): ArWorkflowMode;
	getInspectionPlacementSource(): InspectionPlacementSource;
	getCurrentSessionId(): string | null;
	getSiteId(): string | null;
	getControlTargets(): VisualControlTarget[];
	getPrimaryTargetId(): string | null;
	hasGroundHit(): boolean;
	hasPlacedModel(): boolean;
	setStatus(message: string): void;
	requestPreferredPlacement(): void;
	startManualCalibration(message: string): void;
}

export class InspectionMarkerWorkflow {

	private sessionActive = false;

	constructor(private readonly options: InspectionMarkerWorkflowOptions) {}

	startSession(): void {

		this.sessionActive = true;
		if ( this.options.getWorkflowMode() !== 'ar-inspection' ) {
			return;
		}

		this.options.setStatus( STATUS_MANUAL_MARKER_READY );

	}

	stopSession(): void {

		this.sessionActive = false;

	}

	markManualCalibrationStarted(): void {

		this.options.setStatus( '已进入手动 Marker 四角点校正，请按角点顺序采集。' );

	}

	markAutoApplied(): void {

		// Compatibility hook only. Camera/image-based marker tracking has been removed.

	}

	getStableTargetId(): string | null {

		return this.options.getPrimaryTargetId();

	}

	getStableFrameCount(): number {

		return 0;

	}

	syncHints(): void {

		if (
			this.sessionActive === false
			|| this.options.getWorkflowMode() !== 'ar-inspection'
			|| this.options.hasPlacedModel()
		) {
			return;
		}

		if ( this.options.getInspectionPlacementSource() === 'manual-marker' && this.options.hasGroundHit() ) {
			this.options.setStatus( STATUS_MANUAL_MARKER_PLANE_READY );
		}

	}

	private buildLogPayload(args: {
		reason: string;
	}): Record<string, unknown> {

		const target = this.options.getControlTargets()[ 0 ];
		return {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			sessionId: this.options.getCurrentSessionId(),
			source: this.options.getInspectionPlacementSource(),
			targetId: this.options.getPrimaryTargetId(),
			targetName: target?.name ?? target?.markerId ?? null,
			hasHitTest: this.options.hasGroundHit(),
			reason: args.reason,
			createdAt: Date.now()
		};

	}

}
