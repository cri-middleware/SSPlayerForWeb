import { Bounds, Geometry, Mesh, Shader, pointInTriangle, type PointData } from 'pixi.js';

/**
 * The geometry of a pooled mesh. A pool slot keeps its buffers at the largest
 * draw it has held, so only a prefix of them is this frame's: `usedVertices`
 * vertices and `indexCount` indices. Pixi bounds a geometry over its whole
 * position buffer; left at that, the stale vertices past the prefix would widen
 * the player's `getBounds()`.
 */
export class PooledGeometry extends Geometry {
    /** Vertices of this frame's draw; the rest of every buffer is stale. */
    public usedVertices = 0;
    private readonly _usedBounds = new Bounds();
    private _usedBoundsDirty = true;

    protected override onBufferUpdate(): void {
        this._usedBoundsDirty = true;
        super.onBufferUpdate();
    }

    public override get bounds(): Bounds {
        const b = this._usedBounds;
        if (!this._usedBoundsDirty) return b;
        this._usedBoundsDirty = false;
        const p = this.getBuffer('aPosition').data as Float32Array;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0, n = this.usedVertices * 2; i < n; i += 2) {
            const x = p[i], y = p[i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        b.minX = minX; b.minY = minY; b.maxX = maxX; b.maxY = maxY;
        return b;
    }
}

/**
 * A mesh over a {@link PooledGeometry}. Pixi hit-tests a mesh against every
 * triangle in its index buffer; this one stops at `indexCount`, so the stale
 * triangles past this frame's draw cannot answer a pointer.
 */
export class PooledMesh extends Mesh<PooledGeometry, Shader> {
    public override containsPoint(point: PointData): boolean {
        const g = this.geometry;
        const { x, y } = point;
        if (!g.bounds.containsPoint(x, y)) return false;
        const v = g.getBuffer('aPosition').data as Float32Array;
        const idx = g.getIndex().data as Uint32Array;
        for (let i = 0, n = g.indexCount; i + 2 < n; i += 3) {
            const a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2;
            if (pointInTriangle(x, y, v[a], v[a + 1], v[b], v[b + 1], v[c], v[c + 1])) return true;
        }
        return false;
    }
}
