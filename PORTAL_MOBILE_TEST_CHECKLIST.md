# Underground Portal mobile acceptance

Record device/model, build, average/lowest FPS, Portal redraw count, target size, MSAA, stutter, XR black screen, and context loss.

- Geometry: inspect from above and an angle, walk around all edges, confirm the yellow boundary matches all four corners, then repeat after marker refinement.
- Depth direction: move a hand left/right and up/down, cover with one/two feet, and cross with a tool. With objects 2/5/10/20 cm above the plane, record occlusion stability.
- Ground/depth loss: ground noise must not hide the whole Portal; after a person moves away it recovers; temporary depth loss keeps the Portal visible.
- Picking: test obvious components, thin pipes, intersections, blank area, edges, repeated picks, hidden layers, helpers/sprites/lines, and close the property panel.
- Lifecycle: enter XR, place, enter Portal, switch transparent view and back, reset/re-place, leave/re-enter XR, switch model, and finish marker refinement. Confirm no duplicate proxy/target, stale depth/model pick, or leaked offscreen render.

Development diagnostics: append `?arDebug=portal` (and optionally `&portalThreshold=0.03&portalFeather=0.015`) and record the throttled console output. Production defaults remain threshold `0.05`, feather `0.025`, and 3x3 depth sampling.
