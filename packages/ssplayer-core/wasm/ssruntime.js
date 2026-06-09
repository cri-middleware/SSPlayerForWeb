/* @ts-self-types="./ssruntime.d.ts" */

export class SSRuntimeContext {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SSRuntimeContextFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ssruntimecontext_free(ptr, 0);
    }
    /**
     * @param {string} name
     * @param {number} weight
     * @returns {number}
     */
    add_blend_source(name, weight) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.ssruntimecontext_add_blend_source(retptr, this.__wbg_ptr, ptr0, len0, weight);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} hash
     * @param {number} weight
     * @returns {number}
     */
    add_blend_source_by_hash(hash, weight) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_add_blend_source_by_hash(retptr, this.__wbg_ptr, hash, weight);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} weight
     * @returns {number}
     */
    add_empty_blend_source(weight) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_add_empty_blend_source(retptr, this.__wbg_ptr, weight);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {SSRuntimeResource} resource
     * @returns {boolean}
     */
    bind_resource(resource) {
        _assertClass(resource, SSRuntimeResource);
        const ret = wasm.ssruntimecontext_bind_resource(this.__wbg_ptr, resource.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    blend_source_count() {
        const ret = wasm.ssruntimecontext_blend_source_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    cancel_crossfade() {
        wasm.ssruntimecontext_cancel_crossfade(this.__wbg_ptr);
    }
    clear_blend_sources() {
        wasm.ssruntimecontext_clear_blend_sources(this.__wbg_ptr);
    }
    /**
     * @param {number} from
     * @param {number} to
     * @param {number} duration_ms
     */
    crossfade(from, to, duration_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_crossfade(retptr, this.__wbg_ptr, from, to, duration_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number | undefined}
     */
    crossfade_progress() {
        const ret = wasm.ssruntimecontext_crossfade_progress(this.__wbg_ptr);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * Mirror of `ss_runtime_get_active_effect_event`.
     * @param {number} slot_index
     * @returns {WebEffectEventInfo}
     */
    get_active_effect_event(slot_index) {
        const ret = wasm.ssruntimecontext_get_active_effect_event(this.__wbg_ptr, slot_index);
        return WebEffectEventInfo.__wrap(ret);
    }
    /**
     * Mirror of `ss_runtime_get_active_event_instance`. Returns SS6 defaults
     * (`is_synthetic_default = true`, `loop_num = 1`, `speed = 1.0`) when no
     * event is active. Most Players should pass the returned value directly
     * to `SSRuntimeInstanceSlot::step`, which resolves the labels internally.
     * @param {number} slot_index
     * @returns {WebEventInstanceInfo}
     */
    get_active_event_instance(slot_index) {
        const ret = wasm.ssruntimecontext_get_active_event_instance(this.__wbg_ptr, slot_index);
        return WebEventInstanceInfo.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    get_cell_meta_buf() {
        const ret = wasm.ssruntimecontext_get_cell_meta_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_cell_meta_len() {
        const ret = wasm.ssruntimecontext_get_cell_meta_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {WebCoordinateSystem}
     */
    get_coordinate_system() {
        const ret = wasm.ssruntimecontext_get_coordinate_system(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_end_frame() {
        const ret = wasm.ssruntimecontext_get_end_frame(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_fps() {
        const ret = wasm.ssruntimecontext_get_fps(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} frame_no
     * @returns {number}
     */
    get_frame_data_buf(frame_no) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_get_frame_data_buf(retptr, this.__wbg_ptr, frame_no);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} frame_no
     * @returns {number}
     */
    get_frame_data_len(frame_no) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_get_frame_data_len(retptr, this.__wbg_ptr, frame_no);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    get_frame_no() {
        const ret = wasm.ssruntimecontext_get_frame_no(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_local_uvs_buf() {
        const ret = wasm.ssruntimecontext_get_local_uvs_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_local_uvs_len() {
        const ret = wasm.ssruntimecontext_get_local_uvs_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_local_vertices_buf() {
        const ret = wasm.ssruntimecontext_get_local_vertices_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_local_vertices_len() {
        const ret = wasm.ssruntimecontext_get_local_vertices_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_loops() {
        const ret = wasm.ssruntimecontext_get_loops(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_mesh_index_offsets_buf() {
        const ret = wasm.ssruntimecontext_get_mesh_index_offsets_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_index_offsets_len() {
        const ret = wasm.ssruntimecontext_get_mesh_index_offsets_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_indices_buf() {
        const ret = wasm.ssruntimecontext_get_mesh_indices_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_indices_len() {
        const ret = wasm.ssruntimecontext_get_mesh_indices_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_uvs_buf() {
        const ret = wasm.ssruntimecontext_get_mesh_uvs_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_uvs_len() {
        const ret = wasm.ssruntimecontext_get_mesh_uvs_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_vertex_offsets_buf() {
        const ret = wasm.ssruntimecontext_get_mesh_vertex_offsets_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_vertex_offsets_len() {
        const ret = wasm.ssruntimecontext_get_mesh_vertex_offsets_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_vertices_x_buf() {
        const ret = wasm.ssruntimecontext_get_mesh_vertices_x_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_vertices_x_len() {
        const ret = wasm.ssruntimecontext_get_mesh_vertices_x_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_vertices_y_buf() {
        const ret = wasm.ssruntimecontext_get_mesh_vertices_y_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mesh_vertices_y_len() {
        const ret = wasm.ssruntimecontext_get_mesh_vertices_y_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {WebOrigin}
     */
    get_origin() {
        const ret = wasm.ssruntimecontext_get_origin(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_passed_event_count() {
        const ret = wasm.ssruntimecontext_get_passed_event_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    get_passed_event_index(index) {
        const ret = wasm.ssruntimecontext_get_passed_event_index(this.__wbg_ptr, index);
        return ret;
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    get_passed_event_source_handle(index) {
        const ret = wasm.ssruntimecontext_get_passed_event_source_handle(this.__wbg_ptr, index);
        return ret >>> 0;
    }
    /**
     * @returns {WebPlaybackDirection}
     */
    get_playback_direction() {
        const ret = wasm.ssruntimecontext_get_playback_direction(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {WebPlaybackStyle}
     */
    get_playback_style() {
        const ret = wasm.ssruntimecontext_get_playback_style(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_remain_loops() {
        const ret = wasm.ssruntimecontext_get_remain_loops(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_render_mode() {
        const ret = wasm.ssruntimecontext_get_render_mode(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_shape_vertex_box_coords_buf() {
        const ret = wasm.ssruntimecontext_get_shape_vertex_box_coords_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_shape_vertex_box_coords_len() {
        const ret = wasm.ssruntimecontext_get_shape_vertex_box_coords_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_shape_vertex_counts_buf() {
        const ret = wasm.ssruntimecontext_get_shape_vertex_counts_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_shape_vertex_counts_len() {
        const ret = wasm.ssruntimecontext_get_shape_vertex_counts_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_shape_vertices_buf() {
        const ret = wasm.ssruntimecontext_get_shape_vertices_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_shape_vertices_len() {
        const ret = wasm.ssruntimecontext_get_shape_vertices_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    get_skip_frames() {
        const ret = wasm.ssruntimecontext_get_skip_frames(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get_ssab_buf() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_get_ssab_buf(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    get_ssab_len() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_get_ssab_len(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    get_start_frame() {
        const ret = wasm.ssruntimecontext_get_start_frame(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {WebUnit}
     */
    get_unit() {
        const ret = wasm.ssruntimecontext_get_unit(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_world_matrices_buf() {
        const ret = wasm.ssruntimecontext_get_world_matrices_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_world_matrices_len() {
        const ret = wasm.ssruntimecontext_get_world_matrices_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    is_end_frame_reached() {
        const ret = wasm.ssruntimecontext_is_end_frame_reached(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    is_looped() {
        const ret = wasm.ssruntimecontext_is_looped(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    is_pausing() {
        const ret = wasm.ssruntimecontext_is_pausing(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    is_playing() {
        const ret = wasm.ssruntimecontext_is_playing(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} data
     * @returns {boolean}
     */
    load_ssab_borrow(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ssruntimecontext_load_ssab_borrow(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} data
     * @returns {boolean}
     */
    load_ssab_copy(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ssruntimecontext_load_ssab_copy(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array | null} [data]
     */
    constructor(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(data) ? 0 : passArray8ToWasm0(data, wasm.__wbindgen_export);
            var len0 = WASM_VECTOR_LEN;
            wasm.ssruntimecontext_new(retptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            SSRuntimeContextFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    next_frame() {
        wasm.ssruntimecontext_next_frame(this.__wbg_ptr);
    }
    pause() {
        wasm.ssruntimecontext_pause(this.__wbg_ptr);
    }
    play() {
        wasm.ssruntimecontext_play(this.__wbg_ptr);
    }
    /**
     * @param {number} frame_no
     */
    play_with_start_frame(frame_no) {
        wasm.ssruntimecontext_play_with_start_frame(this.__wbg_ptr, frame_no);
    }
    prev_frame() {
        wasm.ssruntimecontext_prev_frame(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    primary_handle() {
        const ret = wasm.ssruntimecontext_primary_handle(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} handle
     */
    remove_blend_source(handle) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_remove_blend_source(retptr, this.__wbg_ptr, handle);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    reset() {
        wasm.ssruntimecontext_reset(this.__wbg_ptr);
    }
    /**
     * @param {number} start_frame
     * @param {number} end_frame
     */
    set_animation_section(start_frame, end_frame) {
        wasm.ssruntimecontext_set_animation_section(this.__wbg_ptr, start_frame, end_frame);
    }
    /**
     * @param {number} speed_rate
     */
    set_animation_speed(speed_rate) {
        wasm.ssruntimecontext_set_animation_speed(this.__wbg_ptr, speed_rate);
    }
    /**
     * @param {WebCoordinateSystem} coordinate_system
     */
    set_coordinate_system(coordinate_system) {
        wasm.ssruntimecontext_set_coordinate_system(this.__wbg_ptr, coordinate_system);
    }
    /**
     * @param {number} frame
     */
    set_frame_no(frame) {
        wasm.ssruntimecontext_set_frame_no(this.__wbg_ptr, frame);
    }
    /**
     * @param {number} fps
     */
    set_frame_rate(fps) {
        wasm.ssruntimecontext_set_frame_rate(this.__wbg_ptr, fps);
    }
    /**
     * @param {number} loops
     */
    set_loop(loops) {
        wasm.ssruntimecontext_set_loop(this.__wbg_ptr, loops);
    }
    /**
     * @param {WebOrigin} origin
     */
    set_origin(origin) {
        wasm.ssruntimecontext_set_origin(this.__wbg_ptr, origin);
    }
    /**
     * @param {WebPlaybackDirection} direction
     * @param {WebPlaybackStyle} style
     */
    set_playback_direction(direction, style) {
        wasm.ssruntimecontext_set_playback_direction(this.__wbg_ptr, direction, style);
    }
    /**
     * @param {number} handle
     */
    set_primary(handle) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_set_primary(retptr, this.__wbg_ptr, handle);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} mode
     */
    set_render_mode(mode) {
        wasm.ssruntimecontext_set_render_mode(this.__wbg_ptr, mode);
    }
    /**
     * @param {boolean} skip
     */
    set_skip_frames(skip) {
        wasm.ssruntimecontext_set_skip_frames(this.__wbg_ptr, skip);
    }
    /**
     * @param {number} handle
     * @param {number} threshold
     */
    set_source_event_threshold(handle, threshold) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_set_source_event_threshold(retptr, this.__wbg_ptr, handle, threshold);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} handle
     * @param {number} frame
     */
    set_source_frame(handle, frame) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_set_source_frame(retptr, this.__wbg_ptr, handle, frame);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} handle
     * @param {number} speed
     */
    set_source_speed(handle, speed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_set_source_speed(retptr, this.__wbg_ptr, handle, speed);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} handle
     * @param {number} weight
     */
    set_source_weight(handle, weight) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_set_source_weight(retptr, this.__wbg_ptr, handle, weight);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {WebUnit} unit
     */
    set_unit(unit) {
        wasm.ssruntimecontext_set_unit(this.__wbg_ptr, unit);
    }
    /**
     * @param {string} name
     */
    setup_animation(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.ssruntimecontext_setup_animation(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} name_hash
     */
    setup_animation_by_hash(name_hash) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ssruntimecontext_setup_animation_by_hash(retptr, this.__wbg_ptr, name_hash);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} handle
     * @returns {number | undefined}
     */
    source_event_threshold(handle) {
        const ret = wasm.ssruntimecontext_source_event_threshold(this.__wbg_ptr, handle);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * @param {number} handle
     * @returns {number | undefined}
     */
    source_frame(handle) {
        const ret = wasm.ssruntimecontext_source_frame(this.__wbg_ptr, handle);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * @param {number} handle
     * @returns {number | undefined}
     */
    source_weight(handle) {
        const ret = wasm.ssruntimecontext_source_weight(this.__wbg_ptr, handle);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    stop() {
        wasm.ssruntimecontext_stop(this.__wbg_ptr);
    }
    /**
     * @param {number} delta
     * @returns {number}
     */
    update(delta) {
        const ret = wasm.ssruntimecontext_update(this.__wbg_ptr, delta);
        return ret;
    }
}
if (Symbol.dispose) SSRuntimeContext.prototype[Symbol.dispose] = SSRuntimeContext.prototype.free;

/**
 * JS-friendly wrapper of `EffectSlot`. Same conceptual flow as the C FFI:
 * 1) construct via `create`, 2) call `step` per frame with the resolved
 * active event and timing, 3) read `draw_plan_buf`/`draw_plan_len` only
 * when `step` returned `true` and only before the next call.
 */
export class SSRuntimeEffectSlot {
    static __wrap(ptr) {
        const obj = Object.create(SSRuntimeEffectSlot.prototype);
        obj.__wbg_ptr = ptr;
        SSRuntimeEffectSlotFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SSRuntimeEffectSlotFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ssruntimeeffectslot_free(ptr, 0);
    }
    /**
     * @param {SSRuntimeResource} resource
     * @param {number} effect_name_hash
     * @param {number} seed
     * @returns {SSRuntimeEffectSlot}
     */
    static create(resource, effect_name_hash, seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(resource, SSRuntimeResource);
            wasm.ssruntimeeffectslot_create(retptr, resource.__wbg_ptr, effect_name_hash, seed);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return SSRuntimeEffectSlot.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    get_draw_plan_buf() {
        const ret = wasm.ssruntimeeffectslot_get_draw_plan_buf(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_draw_plan_len() {
        const ret = wasm.ssruntimeeffectslot_get_draw_plan_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_seed() {
        const ret = wasm.ssruntimeeffectslot_get_seed(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    is_independent() {
        const ret = wasm.ssruntimeeffectslot_is_independent(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Advance one frame. `ev` is the event info returned by
     * `SSRuntimeContext::get_active_effect_event` (or built manually via
     * `WebEffectEventInfo`).
     *
     * `y_flip = true` for Y-down rendering (pixi.js); `vert_stride = 2` packs
     * (x,y) verts, `3` packs (x,y,0) for engines requiring 3-component verts.
     * Returns `true` if visible; on `true` callers read the plan via
     * `get_draw_plan_buf` / `get_draw_plan_len` before the next step.
     * @param {WebEffectEventInfo} ev
     * @param {number} parent_frame
     * @param {number} delta_seconds
     * @param {number} fps
     * @param {boolean} parent_looped
     * @param {boolean} y_flip
     * @param {number} vert_stride
     * @returns {boolean}
     */
    step(ev, parent_frame, delta_seconds, fps, parent_looped, y_flip, vert_stride) {
        _assertClass(ev, WebEffectEventInfo);
        const ret = wasm.ssruntimeeffectslot_step(this.__wbg_ptr, ev.__wbg_ptr, parent_frame, delta_seconds, fps, parent_looped, y_flip, vert_stride);
        return ret !== 0;
    }
}
if (Symbol.dispose) SSRuntimeEffectSlot.prototype[Symbol.dispose] = SSRuntimeEffectSlot.prototype.free;

/**
 * JS-friendly wrapper of `InstanceSlot`. Same conceptual flow as the C FFI:
 * 1) construct via `create`, 2) call `step` per frame with the resolved
 * active event, child context, and timing, 3) on `transitioned == true`
 * fire any host-side `play()` side effects (event sinks etc.).
 */
export class SSRuntimeInstanceSlot {
    static __wrap(ptr) {
        const obj = Object.create(SSRuntimeInstanceSlot.prototype);
        obj.__wbg_ptr = ptr;
        SSRuntimeInstanceSlotFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SSRuntimeInstanceSlotFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ssruntimeinstanceslot_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    child_frame_no() {
        const ret = wasm.ssruntimeinstanceslot_child_frame_no(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    child_looped() {
        const ret = wasm.ssruntimeinstanceslot_child_looped(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {SSRuntimeInstanceSlot}
     */
    static create() {
        const ret = wasm.ssruntimeinstanceslot_create();
        return SSRuntimeInstanceSlot.__wrap(ret);
    }
    /**
     * @returns {boolean}
     */
    independent() {
        const ret = wasm.ssruntimeinstanceslot_independent(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    is_independent() {
        const ret = wasm.ssruntimeinstanceslot_is_independent(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Advance one tick. `ev` is the event info returned by
     * `SSRuntimeContext::get_active_event_instance` (or built manually via
     * `WebEventInstanceInfo`). `child_ctx` must be the *child* runtime —
     * label resolution and frame stepping run against it.
     * Returns `true` if visible. Inspect `transitioned`, `independent`,
     * `child_frame_no`, `child_looped` via the corresponding getters.
     * @param {WebEventInstanceInfo} ev
     * @param {SSRuntimeContext} child_ctx
     * @param {number} previous_child_frame
     * @param {number} parent_frame
     * @param {number} delta_seconds
     * @param {boolean} parent_looped
     * @returns {boolean}
     */
    step(ev, child_ctx, previous_child_frame, parent_frame, delta_seconds, parent_looped) {
        _assertClass(ev, WebEventInstanceInfo);
        _assertClass(child_ctx, SSRuntimeContext);
        const ret = wasm.ssruntimeinstanceslot_step(this.__wbg_ptr, ev.__wbg_ptr, child_ctx.__wbg_ptr, previous_child_frame, parent_frame, delta_seconds, parent_looped);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    transitioned() {
        const ret = wasm.ssruntimeinstanceslot_transitioned(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) SSRuntimeInstanceSlot.prototype[Symbol.dispose] = SSRuntimeInstanceSlot.prototype.free;

export class SSRuntimeResource {
    static __wrap(ptr) {
        const obj = Object.create(SSRuntimeResource.prototype);
        obj.__wbg_ptr = ptr;
        SSRuntimeResourceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SSRuntimeResourceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ssruntimeresource_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} data
     * @returns {SSRuntimeResource}
     */
    static create_borrow(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.ssruntimeresource_create_borrow(retptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return SSRuntimeResource.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {Uint8Array} data
     */
    constructor(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.ssruntimeresource_new(retptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            SSRuntimeResourceFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) SSRuntimeResource.prototype[Symbol.dispose] = SSRuntimeResource.prototype.free;

/**
 * @enum {0 | 1}
 */
export const WebCoordinateSystem = Object.freeze({
    YUp: 0, "0": "YUp",
    YDown: 1, "1": "YDown",
});

/**
 * JS-friendly mirror of `ss_effect_event_info` (`src/types.rs`).
 */
export class WebEffectEventInfo {
    static __wrap(ptr) {
        const obj = Object.create(WebEffectEventInfo.prototype);
        obj.__wbg_ptr = ptr;
        WebEffectEventInfoFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WebEffectEventInfoFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_webeffecteventinfo_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get event_frame() {
        const ret = wasm.__wbg_get_webeffecteventinfo_event_frame(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get independent() {
        const ret = wasm.__wbg_get_webeffecteventinfo_independent(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get is_synthetic_default() {
        const ret = wasm.__wbg_get_webeffecteventinfo_is_synthetic_default(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get speed() {
        const ret = wasm.__wbg_get_webeffecteventinfo_speed(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get start_time() {
        const ret = wasm.__wbg_get_webeffecteventinfo_start_time(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set event_frame(arg0) {
        wasm.__wbg_set_webeffecteventinfo_event_frame(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set independent(arg0) {
        wasm.__wbg_set_webeffecteventinfo_independent(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set is_synthetic_default(arg0) {
        wasm.__wbg_set_webeffecteventinfo_is_synthetic_default(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set speed(arg0) {
        wasm.__wbg_set_webeffecteventinfo_speed(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set start_time(arg0) {
        wasm.__wbg_set_webeffecteventinfo_start_time(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} event_frame
     * @param {number} start_time
     * @param {number} speed
     * @param {boolean} independent
     * @param {boolean} is_synthetic_default
     */
    constructor(event_frame, start_time, speed, independent, is_synthetic_default) {
        const ret = wasm.webeffecteventinfo_new(event_frame, start_time, speed, independent, is_synthetic_default);
        this.__wbg_ptr = ret;
        WebEffectEventInfoFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {WebEffectEventInfo}
     */
    static synthetic_default() {
        const ret = wasm.webeffecteventinfo_synthetic_default();
        return WebEffectEventInfo.__wrap(ret);
    }
}
if (Symbol.dispose) WebEffectEventInfo.prototype[Symbol.dispose] = WebEffectEventInfo.prototype.free;

/**
 * JS-friendly mirror of `ss_event_instance_info` (`src/types.rs`).
 *
 * Returned by `SSRuntimeContext::get_active_event_instance` and consumed by
 * `SSRuntimeInstanceSlot::step`. Construct directly via the
 * `WebEventInstanceInfo` constructor when bridging from raw values, or call
 * `synthetic_default` to obtain SS6 defaults.
 */
export class WebEventInstanceInfo {
    static __wrap(ptr) {
        const obj = Object.create(WebEventInstanceInfo.prototype);
        obj.__wbg_ptr = ptr;
        WebEventInstanceInfoFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WebEventInstanceInfoFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_webeventinstanceinfo_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get end_label_hash() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_end_label_hash(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get end_offset() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_end_offset(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get event_frame() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_event_frame(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get independent() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_independent(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get is_synthetic_default() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_is_synthetic_default(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get loop_num() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_loop_num(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get pingpong() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_pingpong(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get reverse() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_reverse(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get speed() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_speed(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get start_label_hash() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_start_label_hash(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get start_offset() {
        const ret = wasm.__wbg_get_webeventinstanceinfo_start_offset(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set end_label_hash(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_end_label_hash(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set end_offset(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_end_offset(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set event_frame(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_event_frame(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set independent(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_independent(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set is_synthetic_default(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_is_synthetic_default(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set loop_num(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_loop_num(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set pingpong(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_pingpong(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set reverse(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_reverse(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set speed(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_speed(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set start_label_hash(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_start_label_hash(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set start_offset(arg0) {
        wasm.__wbg_set_webeventinstanceinfo_start_offset(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} event_frame
     * @param {number} start_label_hash
     * @param {number} start_offset
     * @param {number} end_label_hash
     * @param {number} end_offset
     * @param {number} loop_num
     * @param {number} speed
     * @param {boolean} independent
     * @param {boolean} reverse
     * @param {boolean} pingpong
     * @param {boolean} is_synthetic_default
     */
    constructor(event_frame, start_label_hash, start_offset, end_label_hash, end_offset, loop_num, speed, independent, reverse, pingpong, is_synthetic_default) {
        const ret = wasm.webeventinstanceinfo_new(event_frame, start_label_hash, start_offset, end_label_hash, end_offset, loop_num, speed, independent, reverse, pingpong, is_synthetic_default);
        this.__wbg_ptr = ret;
        WebEventInstanceInfoFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {WebEventInstanceInfo}
     */
    static synthetic_default() {
        const ret = wasm.webeventinstanceinfo_synthetic_default();
        return WebEventInstanceInfo.__wrap(ret);
    }
}
if (Symbol.dispose) WebEventInstanceInfo.prototype[Symbol.dispose] = WebEventInstanceInfo.prototype.free;

/**
 * @enum {0 | 1}
 */
export const WebOrigin = Object.freeze({
    Center: 0, "0": "Center",
    TopLeft: 1, "1": "TopLeft",
});

/**
 * @enum {0 | 1}
 */
export const WebPlaybackDirection = Object.freeze({
    Forward: 0, "0": "Forward",
    Backward: 1, "1": "Backward",
});

/**
 * @enum {0 | 1}
 */
export const WebPlaybackStyle = Object.freeze({
    Normal: 0, "0": "Normal",
    PingPong: 1, "1": "PingPong",
});

/**
 * @enum {0 | 1}
 */
export const WebUnit = Object.freeze({
    Pixel: 0, "0": "Pixel",
    Normalized: 1, "1": "Normalized",
});

/**
 * @param {string} s
 * @returns {number}
 */
export function ss_runtime_hash_string(s) {
    const ptr0 = passStringToWasm0(s, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ss_runtime_hash_string(ptr0, len0);
    return ret >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bbadd78c1bac3a77: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
    };
    return {
        __proto__: null,
        "./ssruntime_bg.js": import0,
    };
}

const SSRuntimeContextFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ssruntimecontext_free(ptr, 1));
const SSRuntimeEffectSlotFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ssruntimeeffectslot_free(ptr, 1));
const SSRuntimeInstanceSlotFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ssruntimeinstanceslot_free(ptr, 1));
const SSRuntimeResourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ssruntimeresource_free(ptr, 1));
const WebEffectEventInfoFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_webeffecteventinfo_free(ptr, 1));
const WebEventInstanceInfoFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_webeventinstanceinfo_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('ssruntime_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
