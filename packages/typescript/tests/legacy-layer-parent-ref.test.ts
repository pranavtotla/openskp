import { describe, it, expect } from 'vitest';
import { create } from '../src/create';
import { parseSkp } from '../src/index';
import { Archive } from '../src/legacy';

/**
 * The end of the layer list, where the definition list begins.
 *
 * The usual layout is `<active-layer back-ref u16><definition count u32>`, then
 * the first CComponentDefinition record. Some SketchUp 2018 zero-material files
 * (custom tag listed ahead of Layer0, see legacy-zero-material-custom-layer)
 * write an extra parent back-ref first: `<parent u16><active u16><count u32>`.
 * `Archive.skipClayerParentRef` tells the two apart by whether the next two
 * u16s are both CLayer objects - but in the usual layout the second u16 is the
 * low half of the definition count, so a count that equals the slot of any
 * layer passed that test too. The reader then took the active layer for a
 * parent, read the count two bytes late (`0x0000` high half + the `0xffff`
 * class tag of the first definition = 0xffff0000), and gave up with
 * "implausible definition count" (or, after re-basing, "class-ref to non-class
 * slot"). It took nothing but an active layer that is not the last layer
 * record - Layer0 usually is not - and as many definitions as some layer's
 * slot number: a model with one tag and 10 component definitions written by
 * this package's own writer did not read back.
 *
 * Only the usual layout puts a definition record six bytes on; that is what
 * the walker reads next whenever the count is not 0 (and a count of 0 never
 * looks like a layer back-ref).
 */

const LAYER_CLASS = 14;
const LAYERS = [15, 16, 17, 18, 19, 20, 21, 22]; // Layer0 first, as SketchUp lists it
const DEFINITION_CLASS = 30;

const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const ascii = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0));

/** The first CComponentDefinition record's tag: a new class, schema 11. */
const newDefinitionClass = (): number[] => [0xff, 0xff, ...u16(11), ...u16(20), ...ascii('CComponentDefinition')];
/** A later definition record's tag: a class-ref to the class declared earlier. */
const definitionClassRef = (): number[] => u16(0x8000 | DEFINITION_CLASS);

/** A SketchUp 2017 archive positioned on `bytes`, which follow the last layer
 * record; the layer class and its objects are already registered. */
function archive(bytes: number[], layers = LAYERS): Archive {
  const ar = new Archive(new Uint8Array(bytes), 17);
  ar.slots.set(LAYER_CLASS, ['class', 'CLayer', 3]);
  ar.classSlot.set('CLayer', LAYER_CLASS);
  for (const slot of layers) ar.slots.set(slot, ['obj', 'CLayer', { k: 'layer' }]);
  return ar;
}

describe('Archive.skipClayerParentRef', () => {
  it('leaves an active-layer back-ref whose definition count equals a layer slot', () => {
    // 8 layers in slots 15-22, Layer0 active, 16 definitions: Walls is slot 16
    const ar = archive([...u16(15), ...u32(16), ...newDefinitionClass()]);
    ar.skipClayerParentRef(22);
    expect(ar.r.pos).toBe(0);
  });

  it('leaves it for every count that collides with a layer slot', () => {
    for (const count of LAYERS) {
      const ar = archive([...u16(15), ...u32(count), ...newDefinitionClass()]);
      ar.skipClayerParentRef(22);
      expect(ar.r.pos, `count=${count}`).toBe(0);
    }
  });

  it('leaves it when the first definition is a class-ref to a class declared earlier', () => {
    const ar = archive([...u16(15), ...u32(17), ...definitionClassRef(), 0, 0]);
    ar.slots.set(DEFINITION_CLASS, ['class', 'CComponentDefinition', 11]);
    ar.classSlot.set('CComponentDefinition', DEFINITION_CLASS);
    ar.skipClayerParentRef(22);
    expect(ar.r.pos).toBe(0);
  });

  it('still skips the parent ref of the v18 layout with no definitions', () => {
    // zero_material_custom_layer_v18.skp: parent 16 (Guide), active 17 (Layer0),
    // 0 definitions, 2 root entities
    const ar = archive([...u16(16), ...u16(17), ...u32(0), ...u32(2)], [16, 17]);
    ar.skipClayerParentRef(17);
    expect(ar.r.pos).toBe(2);
  });

  it('still skips the parent ref of the v18 layout when definitions follow', () => {
    // the definition record starts 8 bytes on, not 6
    const ar = archive([...u16(16), ...u16(17), ...u32(3), ...newDefinitionClass()], [16, 17]);
    ar.skipClayerParentRef(17);
    expect(ar.r.pos).toBe(2);
  });

  it('leaves a back-ref to the layer just read', () => {
    const ar = archive([...u16(22), ...u32(16), ...newDefinitionClass()]);
    ar.skipClayerParentRef(22);
    expect(ar.r.pos).toBe(0);
  });

  it('leaves a definition count that is not a layer slot', () => {
    const ar = archive([...u16(15), ...u32(80), ...newDefinitionClass()]);
    ar.skipClayerParentRef(22);
    expect(ar.r.pos).toBe(0);
  });
});

/** Writes `tags` tags and `definitions` component definitions (one triangle
 * each, one instance each, spread over the tags), then reads the file back. */
function writeAndRead(tags: number, definitions: number) {
  const builder = create();
  const layers = Array.from({ length: tags }, (_, i) => builder.addLayer(`Tag ${i + 1}`));
  const defs = Array.from({ length: definitions }, (_, i) =>
    builder.addComponentDefinition(`Part ${i + 1}`, (def) => {
      def.addFace([[0, 0, 0], [10, 0, 0], [0, 10, 0]]);
    })
  );
  defs.forEach((def, i) => {
    builder.addInstance(def, { name: `Part ${i + 1}`, translation: [20 * i, 0, 0], layer: layers[i % tags] });
  });
  const bytes = builder.toBytes();
  return parseSkp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

describe('writer round trip: definition counts that equal a layer slot', () => {
  it('reads back one tag and 10 component definitions', () => {
    const model = writeAndRead(1, 10);
    expect(model.version).toBe('{17.0.1}');
    expect(model.definitions.size).toBe(10);
    expect(model.layers.map((l) => l.name)).toEqual(['Layer0', 'Tag 1']);
    expect(model.root.instances.length).toBe(10);
  });

  it('reads back every model with 1-8 tags and 1-24 component definitions', () => {
    const failed: string[] = [];
    for (let tags = 1; tags <= 8; tags++) {
      for (let definitions = 1; definitions <= 24; definitions++) {
        let got: string;
        try {
          const model = writeAndRead(tags, definitions);
          got = `${model.definitions.size} definitions, ${model.layers.length} layers, ${model.root.instances.length} instances`;
        } catch (e) {
          got = String((e as Error).message).slice(0, 80);
        }
        const want = `${definitions} definitions, ${tags + 1} layers, ${definitions} instances`;
        if (got !== want) failed.push(`${tags} tags, ${definitions} definitions: ${got}`);
      }
    }
    expect(failed).toEqual([]);
  });
});

/**
 * The same collision in a model with two materials. They come first in the
 * file, so Layer0 and the tag take slots 13 and 14. With two materials the
 * reader takes its slot base from them and walks that base only, so the
 * count read two bytes late is reported as it is: "implausible definition
 * count", the error a SketchUp 2017 model with this collision gave.
 */
function writeAndReadTwoMaterials(definitions: number) {
  const builder = create();
  const red = builder.addMaterial('Red', [200, 30, 30, 255]);
  builder.addMaterial('Blue', [30, 30, 200, 255]);
  const tag = builder.addLayer('Tag 1');
  const defs = Array.from({ length: definitions }, (_, i) =>
    builder.addComponentDefinition(`Part ${i + 1}`, (def) => {
      def.addFace([[0, 0, 0], [10, 0, 0], [0, 10, 0]], { material: red });
    })
  );
  defs.forEach((def, i) => {
    builder.addInstance(def, { name: `Part ${i + 1}`, translation: [20 * i, 0, 0], layer: tag });
  });
  const bytes = builder.toBytes();
  return parseSkp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

describe('writer round trip: two materials and a definition count that equals a layer slot', () => {
  it.each([13, 14])('reads back two materials, one tag and %i component definitions', (definitions) => {
    let got: string;
    try {
      const model = writeAndReadTwoMaterials(definitions);
      got =
        `${model.definitions.size} definitions, ${model.layers.length} layers, ` +
        `${model.root.instances.length} instances, ${model.materials.length} materials`;
    } catch (e) {
      got = String((e as Error).message).slice(0, 80);
    }
    expect(got).toBe(`${definitions} definitions, 2 layers, ${definitions} instances, 2 materials`);
  });
});
