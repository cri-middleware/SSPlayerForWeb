/* tslint:disable */
/* eslint-disable */

export class SSRuntimeContext {
    free(): void;
    [Symbol.dispose](): void;
    add_blend_source(name: string, weight: number): number;
    add_blend_source_by_hash(hash: number, weight: number): number;
    add_empty_blend_source(weight: number): number;
    bind_resource(resource: SSRuntimeResource): boolean;
    blend_source_count(): number;
    cancel_crossfade(): void;
    clear_blend_sources(): void;
    crossfade(from: number, to: number, duration_ms: number): void;
    crossfade_progress(): number | undefined;
    /**
     * Mirror of `ss_runtime_get_active_effect_event`.
     */
    get_active_effect_event(slot_index: number): WebEffectEventInfo;
    /**
     * Mirror of `ss_runtime_get_active_event_instance`. Returns SS6 defaults
     * (`is_synthetic_default = true`, `loop_num = 1`, `speed = 1.0`) when no
     * event is active. Most Players should pass the returned value directly
     * to `SSRuntimeInstanceSlot::step`, which resolves the labels internally.
     */
    get_active_event_instance(slot_index: number): WebEventInstanceInfo;
    get_cell_meta_buf(): number;
    get_cell_meta_len(): number;
    get_coordinate_system(): WebCoordinateSystem;
    get_end_frame(): number;
    get_fps(): number;
    get_frame_data_buf(frame_no: number): number;
    get_frame_data_len(frame_no: number): number;
    get_frame_no(): number;
    get_local_uvs_buf(): number;
    get_local_uvs_len(): number;
    get_local_vertices_buf(): number;
    get_local_vertices_len(): number;
    get_loops(): number;
    get_mesh_index_offsets_buf(): number;
    get_mesh_index_offsets_len(): number;
    get_mesh_indices_buf(): number;
    get_mesh_indices_len(): number;
    get_mesh_uvs_buf(): number;
    get_mesh_uvs_len(): number;
    get_mesh_vertex_offsets_buf(): number;
    get_mesh_vertex_offsets_len(): number;
    get_mesh_vertices_x_buf(): number;
    get_mesh_vertices_x_len(): number;
    get_mesh_vertices_y_buf(): number;
    get_mesh_vertices_y_len(): number;
    get_origin(): WebOrigin;
    get_passed_event_count(): number;
    get_passed_event_index(index: number): number;
    get_passed_event_source_handle(index: number): number;
    get_playback_direction(): WebPlaybackDirection;
    get_playback_style(): WebPlaybackStyle;
    get_remain_loops(): number;
    get_render_mode(): number;
    get_shape_vertex_box_coords_buf(): number;
    get_shape_vertex_box_coords_len(): number;
    get_shape_vertex_counts_buf(): number;
    get_shape_vertex_counts_len(): number;
    get_shape_vertices_buf(): number;
    get_shape_vertices_len(): number;
    get_skip_frames(): boolean;
    get_ssab_buf(): number;
    get_ssab_len(): number;
    get_start_frame(): number;
    get_unit(): WebUnit;
    get_world_matrices_buf(): number;
    get_world_matrices_len(): number;
    is_end_frame_reached(): boolean;
    is_looped(): boolean;
    is_pausing(): boolean;
    is_playing(): boolean;
    load_ssab_borrow(data: Uint8Array): boolean;
    load_ssab_copy(data: Uint8Array): boolean;
    constructor(data?: Uint8Array | null);
    next_frame(): void;
    pause(): void;
    play(): void;
    play_with_start_frame(frame_no: number): void;
    prev_frame(): void;
    primary_handle(): number;
    remove_blend_source(handle: number): void;
    reset(): void;
    set_animation_section(start_frame: number, end_frame: number): void;
    set_animation_speed(speed_rate: number): void;
    set_coordinate_system(coordinate_system: WebCoordinateSystem): void;
    set_frame_no(frame: number): void;
    set_frame_rate(fps: number): void;
    set_loop(loops: number): void;
    set_origin(origin: WebOrigin): void;
    set_playback_direction(direction: WebPlaybackDirection, style: WebPlaybackStyle): void;
    set_primary(handle: number): void;
    set_render_mode(mode: number): void;
    set_skip_frames(skip: boolean): void;
    set_source_event_threshold(handle: number, threshold: number): void;
    set_source_frame(handle: number, frame: number): void;
    set_source_speed(handle: number, speed: number): void;
    set_source_weight(handle: number, weight: number): void;
    set_unit(unit: WebUnit): void;
    setup_animation(name: string): void;
    setup_animation_by_hash(name_hash: number): void;
    source_event_threshold(handle: number): number | undefined;
    source_frame(handle: number): number | undefined;
    source_weight(handle: number): number | undefined;
    stop(): void;
    update(delta: number): number;
}

/**
 * JS-friendly wrapper of `EffectSlot`. Same conceptual flow as the C FFI:
 * 1) construct via `create`, 2) call `step` per frame with the resolved
 * active event and timing, 3) read `draw_plan_buf`/`draw_plan_len` only
 * when `step` returned `true` and only before the next call.
 */
export class SSRuntimeEffectSlot {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static create(resource: SSRuntimeResource, effect_name_hash: number, seed: number): SSRuntimeEffectSlot;
    get_draw_plan_buf(): number;
    get_draw_plan_len(): number;
    get_seed(): number;
    is_independent(): boolean;
    /**
     * Advance one frame. `ev` is the event info returned by
     * `SSRuntimeContext::get_active_effect_event` (or built manually via
     * `WebEffectEventInfo`).
     *
     * `y_flip = true` for Y-down rendering (pixi.js); `vert_stride = 2` packs
     * (x,y) verts, `3` packs (x,y,0) for engines requiring 3-component verts.
     * Returns `true` if visible; on `true` callers read the plan via
     * `get_draw_plan_buf` / `get_draw_plan_len` before the next step.
     */
    step(ev: WebEffectEventInfo, parent_frame: number, delta_seconds: number, fps: number, parent_looped: boolean, y_flip: boolean, vert_stride: number): boolean;
}

/**
 * JS-friendly wrapper of `InstanceSlot`. Same conceptual flow as the C FFI:
 * 1) construct via `create`, 2) call `step` per frame with the resolved
 * active event, child context, and timing, 3) on `transitioned == true`
 * fire any host-side `play()` side effects (event sinks etc.).
 */
export class SSRuntimeInstanceSlot {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    child_frame_no(): number;
    child_looped(): boolean;
    static create(): SSRuntimeInstanceSlot;
    independent(): boolean;
    is_independent(): boolean;
    /**
     * Advance one tick. `ev` is the event info returned by
     * `SSRuntimeContext::get_active_event_instance` (or built manually via
     * `WebEventInstanceInfo`). `child_ctx` must be the *child* runtime —
     * label resolution and frame stepping run against it.
     * Returns `true` if visible. Inspect `transitioned`, `independent`,
     * `child_frame_no`, `child_looped` via the corresponding getters.
     */
    step(ev: WebEventInstanceInfo, child_ctx: SSRuntimeContext, previous_child_frame: number, parent_frame: number, delta_seconds: number, parent_looped: boolean): boolean;
    transitioned(): boolean;
}

export class SSRuntimeResource {
    free(): void;
    [Symbol.dispose](): void;
    static create_borrow(data: Uint8Array): SSRuntimeResource;
    constructor(data: Uint8Array);
}

export enum WebCoordinateSystem {
    YUp = 0,
    YDown = 1,
}

/**
 * JS-friendly mirror of `ss_effect_event_info` (`src/types.rs`).
 */
export class WebEffectEventInfo {
    free(): void;
    [Symbol.dispose](): void;
    constructor(event_frame: number, start_time: number, speed: number, independent: boolean, is_synthetic_default: boolean);
    static synthetic_default(): WebEffectEventInfo;
    event_frame: number;
    independent: boolean;
    is_synthetic_default: boolean;
    speed: number;
    start_time: number;
}

/**
 * JS-friendly mirror of `ss_event_instance_info` (`src/types.rs`).
 *
 * Returned by `SSRuntimeContext::get_active_event_instance` and consumed by
 * `SSRuntimeInstanceSlot::step`. Construct directly via the
 * `WebEventInstanceInfo` constructor when bridging from raw values, or call
 * `synthetic_default` to obtain SS6 defaults.
 */
export class WebEventInstanceInfo {
    free(): void;
    [Symbol.dispose](): void;
    constructor(event_frame: number, start_label_hash: number, start_offset: number, end_label_hash: number, end_offset: number, loop_num: number, speed: number, independent: boolean, reverse: boolean, pingpong: boolean, is_synthetic_default: boolean);
    static synthetic_default(): WebEventInstanceInfo;
    end_label_hash: number;
    end_offset: number;
    event_frame: number;
    independent: boolean;
    is_synthetic_default: boolean;
    loop_num: number;
    pingpong: boolean;
    reverse: boolean;
    speed: number;
    start_label_hash: number;
    start_offset: number;
}

export enum WebOrigin {
    Center = 0,
    TopLeft = 1,
}

export enum WebPlaybackDirection {
    Forward = 0,
    Backward = 1,
}

export enum WebPlaybackStyle {
    Normal = 0,
    PingPong = 1,
}

export enum WebUnit {
    Pixel = 0,
    Normalized = 1,
}

export function ss_runtime_hash_string(s: string): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_webeffecteventinfo_event_frame: (a: number) => number;
    readonly __wbg_get_webeffecteventinfo_independent: (a: number) => number;
    readonly __wbg_get_webeffecteventinfo_is_synthetic_default: (a: number) => number;
    readonly __wbg_get_webeffecteventinfo_speed: (a: number) => number;
    readonly __wbg_get_webeffecteventinfo_start_time: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_end_label_hash: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_end_offset: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_independent: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_is_synthetic_default: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_loop_num: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_pingpong: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_reverse: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_speed: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_start_offset: (a: number) => number;
    readonly __wbg_set_webeffecteventinfo_event_frame: (a: number, b: number) => void;
    readonly __wbg_set_webeffecteventinfo_independent: (a: number, b: number) => void;
    readonly __wbg_set_webeffecteventinfo_is_synthetic_default: (a: number, b: number) => void;
    readonly __wbg_set_webeffecteventinfo_speed: (a: number, b: number) => void;
    readonly __wbg_set_webeffecteventinfo_start_time: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_end_label_hash: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_end_offset: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_independent: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_is_synthetic_default: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_loop_num: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_pingpong: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_reverse: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_speed: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_start_offset: (a: number, b: number) => void;
    readonly __wbg_ssruntimecontext_free: (a: number, b: number) => void;
    readonly __wbg_ssruntimeeffectslot_free: (a: number, b: number) => void;
    readonly __wbg_ssruntimeinstanceslot_free: (a: number, b: number) => void;
    readonly __wbg_ssruntimeresource_free: (a: number, b: number) => void;
    readonly __wbg_webeffecteventinfo_free: (a: number, b: number) => void;
    readonly __wbg_webeventinstanceinfo_free: (a: number, b: number) => void;
    readonly ss_runtime_hash_string: (a: number, b: number) => number;
    readonly ssruntimecontext_add_blend_source: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly ssruntimecontext_add_blend_source_by_hash: (a: number, b: number, c: number, d: number) => void;
    readonly ssruntimecontext_add_empty_blend_source: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_bind_resource: (a: number, b: number) => number;
    readonly ssruntimecontext_blend_source_count: (a: number) => number;
    readonly ssruntimecontext_cancel_crossfade: (a: number) => void;
    readonly ssruntimecontext_clear_blend_sources: (a: number) => void;
    readonly ssruntimecontext_crossfade: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly ssruntimecontext_crossfade_progress: (a: number) => number;
    readonly ssruntimecontext_get_active_effect_event: (a: number, b: number) => number;
    readonly ssruntimecontext_get_active_event_instance: (a: number, b: number) => number;
    readonly ssruntimecontext_get_cell_meta_buf: (a: number) => number;
    readonly ssruntimecontext_get_cell_meta_len: (a: number) => number;
    readonly ssruntimecontext_get_coordinate_system: (a: number) => number;
    readonly ssruntimecontext_get_end_frame: (a: number) => number;
    readonly ssruntimecontext_get_fps: (a: number) => number;
    readonly ssruntimecontext_get_frame_data_buf: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_get_frame_data_len: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_get_frame_no: (a: number) => number;
    readonly ssruntimecontext_get_local_uvs_buf: (a: number) => number;
    readonly ssruntimecontext_get_local_uvs_len: (a: number) => number;
    readonly ssruntimecontext_get_local_vertices_buf: (a: number) => number;
    readonly ssruntimecontext_get_local_vertices_len: (a: number) => number;
    readonly ssruntimecontext_get_loops: (a: number) => number;
    readonly ssruntimecontext_get_mesh_index_offsets_buf: (a: number) => number;
    readonly ssruntimecontext_get_mesh_index_offsets_len: (a: number) => number;
    readonly ssruntimecontext_get_mesh_indices_buf: (a: number) => number;
    readonly ssruntimecontext_get_mesh_indices_len: (a: number) => number;
    readonly ssruntimecontext_get_mesh_uvs_buf: (a: number) => number;
    readonly ssruntimecontext_get_mesh_uvs_len: (a: number) => number;
    readonly ssruntimecontext_get_mesh_vertex_offsets_buf: (a: number) => number;
    readonly ssruntimecontext_get_mesh_vertex_offsets_len: (a: number) => number;
    readonly ssruntimecontext_get_mesh_vertices_x_buf: (a: number) => number;
    readonly ssruntimecontext_get_mesh_vertices_x_len: (a: number) => number;
    readonly ssruntimecontext_get_mesh_vertices_y_buf: (a: number) => number;
    readonly ssruntimecontext_get_mesh_vertices_y_len: (a: number) => number;
    readonly ssruntimecontext_get_origin: (a: number) => number;
    readonly ssruntimecontext_get_passed_event_count: (a: number) => number;
    readonly ssruntimecontext_get_passed_event_index: (a: number, b: number) => number;
    readonly ssruntimecontext_get_passed_event_source_handle: (a: number, b: number) => number;
    readonly ssruntimecontext_get_playback_direction: (a: number) => number;
    readonly ssruntimecontext_get_playback_style: (a: number) => number;
    readonly ssruntimecontext_get_remain_loops: (a: number) => number;
    readonly ssruntimecontext_get_render_mode: (a: number) => number;
    readonly ssruntimecontext_get_shape_vertex_box_coords_buf: (a: number) => number;
    readonly ssruntimecontext_get_shape_vertex_box_coords_len: (a: number) => number;
    readonly ssruntimecontext_get_shape_vertex_counts_buf: (a: number) => number;
    readonly ssruntimecontext_get_shape_vertex_counts_len: (a: number) => number;
    readonly ssruntimecontext_get_shape_vertices_buf: (a: number) => number;
    readonly ssruntimecontext_get_shape_vertices_len: (a: number) => number;
    readonly ssruntimecontext_get_skip_frames: (a: number) => number;
    readonly ssruntimecontext_get_ssab_buf: (a: number, b: number) => void;
    readonly ssruntimecontext_get_ssab_len: (a: number, b: number) => void;
    readonly ssruntimecontext_get_start_frame: (a: number) => number;
    readonly ssruntimecontext_get_unit: (a: number) => number;
    readonly ssruntimecontext_get_world_matrices_buf: (a: number) => number;
    readonly ssruntimecontext_get_world_matrices_len: (a: number) => number;
    readonly ssruntimecontext_is_end_frame_reached: (a: number) => number;
    readonly ssruntimecontext_is_looped: (a: number) => number;
    readonly ssruntimecontext_is_pausing: (a: number) => number;
    readonly ssruntimecontext_is_playing: (a: number) => number;
    readonly ssruntimecontext_load_ssab_borrow: (a: number, b: number, c: number) => number;
    readonly ssruntimecontext_load_ssab_copy: (a: number, b: number, c: number) => number;
    readonly ssruntimecontext_new: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_next_frame: (a: number) => void;
    readonly ssruntimecontext_pause: (a: number) => void;
    readonly ssruntimecontext_play: (a: number) => void;
    readonly ssruntimecontext_play_with_start_frame: (a: number, b: number) => void;
    readonly ssruntimecontext_prev_frame: (a: number) => void;
    readonly ssruntimecontext_primary_handle: (a: number) => number;
    readonly ssruntimecontext_remove_blend_source: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_reset: (a: number) => void;
    readonly ssruntimecontext_set_animation_section: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_set_animation_speed: (a: number, b: number) => void;
    readonly ssruntimecontext_set_coordinate_system: (a: number, b: number) => void;
    readonly ssruntimecontext_set_frame_no: (a: number, b: number) => void;
    readonly ssruntimecontext_set_frame_rate: (a: number, b: number) => void;
    readonly ssruntimecontext_set_loop: (a: number, b: number) => void;
    readonly ssruntimecontext_set_origin: (a: number, b: number) => void;
    readonly ssruntimecontext_set_playback_direction: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_set_primary: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_set_render_mode: (a: number, b: number) => void;
    readonly ssruntimecontext_set_skip_frames: (a: number, b: number) => void;
    readonly ssruntimecontext_set_source_event_threshold: (a: number, b: number, c: number, d: number) => void;
    readonly ssruntimecontext_set_source_frame: (a: number, b: number, c: number, d: number) => void;
    readonly ssruntimecontext_set_source_speed: (a: number, b: number, c: number, d: number) => void;
    readonly ssruntimecontext_set_source_weight: (a: number, b: number, c: number, d: number) => void;
    readonly ssruntimecontext_set_unit: (a: number, b: number) => void;
    readonly ssruntimecontext_setup_animation: (a: number, b: number, c: number, d: number) => void;
    readonly ssruntimecontext_setup_animation_by_hash: (a: number, b: number, c: number) => void;
    readonly ssruntimecontext_source_event_threshold: (a: number, b: number) => number;
    readonly ssruntimecontext_source_frame: (a: number, b: number) => number;
    readonly ssruntimecontext_source_weight: (a: number, b: number) => number;
    readonly ssruntimecontext_stop: (a: number) => void;
    readonly ssruntimecontext_update: (a: number, b: number) => number;
    readonly ssruntimeeffectslot_create: (a: number, b: number, c: number, d: number) => void;
    readonly ssruntimeeffectslot_get_draw_plan_buf: (a: number) => number;
    readonly ssruntimeeffectslot_get_draw_plan_len: (a: number) => number;
    readonly ssruntimeeffectslot_get_seed: (a: number) => number;
    readonly ssruntimeeffectslot_is_independent: (a: number) => number;
    readonly ssruntimeeffectslot_step: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly ssruntimeinstanceslot_child_frame_no: (a: number) => number;
    readonly ssruntimeinstanceslot_child_looped: (a: number) => number;
    readonly ssruntimeinstanceslot_create: () => number;
    readonly ssruntimeinstanceslot_independent: (a: number) => number;
    readonly ssruntimeinstanceslot_is_independent: (a: number) => number;
    readonly ssruntimeinstanceslot_step: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly ssruntimeinstanceslot_transitioned: (a: number) => number;
    readonly ssruntimeresource_create_borrow: (a: number, b: number, c: number) => void;
    readonly ssruntimeresource_new: (a: number, b: number, c: number) => void;
    readonly webeffecteventinfo_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly webeffecteventinfo_synthetic_default: () => number;
    readonly webeventinstanceinfo_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly webeventinstanceinfo_synthetic_default: () => number;
    readonly __wbg_get_webeventinstanceinfo_event_frame: (a: number) => number;
    readonly __wbg_get_webeventinstanceinfo_start_label_hash: (a: number) => number;
    readonly __wbg_set_webeventinstanceinfo_event_frame: (a: number, b: number) => void;
    readonly __wbg_set_webeventinstanceinfo_start_label_hash: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
