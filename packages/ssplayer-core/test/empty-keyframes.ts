import * as flatbuffers from 'flatbuffers';
import { Keyframes } from '../src/ss/format/keyframes.js';

// `SsAnimeBinary.keyframes` is required, and so is every column in it. A
// synthetic pack that animates nothing still carries the table, empty: one
// `runs` entry for where the (absent) last run ends, and nothing else.
export function createEmptyKeyframes(b: flatbuffers.Builder): flatbuffers.Offset {
    const runs = Keyframes.createRunsVector(b, [0]);
    const frame = Keyframes.createFrameVector(b, []);
    const interpolation = Keyframes.createInterpolationVector(b, []);
    const curve = Keyframes.createCurveVector(b, []);
    const value = Keyframes.createValueVector(b, []);
    Keyframes.startCurvesVector(b, 0);
    const curves = b.endVector();
    const easingRates = Keyframes.createEasingRatesVector(b, []);
    const cells = Keyframes.createCellsVector(b, []);
    const partColors = Keyframes.createPartColorsVector(b, []);
    const shaders = Keyframes.createShadersVector(b, []);
    const vertices = Keyframes.createVerticesVector(b, []);
    const skews = Keyframes.createSkewsVector(b, []);
    const deforms = Keyframes.createDeformsVector(b, []);
    Keyframes.startKeyframes(b);
    Keyframes.addRuns(b, runs);
    Keyframes.addFrame(b, frame);
    Keyframes.addInterpolation(b, interpolation);
    Keyframes.addCurve(b, curve);
    Keyframes.addValue(b, value);
    Keyframes.addCurves(b, curves);
    Keyframes.addEasingRates(b, easingRates);
    Keyframes.addCells(b, cells);
    Keyframes.addPartColors(b, partColors);
    Keyframes.addShaders(b, shaders);
    Keyframes.addVertices(b, vertices);
    Keyframes.addSkews(b, skews);
    Keyframes.addDeforms(b, deforms);
    return Keyframes.endKeyframes(b);
}
