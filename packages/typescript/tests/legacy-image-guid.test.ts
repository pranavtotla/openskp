import { describe, it, expect } from 'vitest';
import { Archive, R, READERS, readEntityList } from '../src/legacy';

/**
 * Legacy (MFC) Image entities before SketchUp 2014.
 *
 * A CImage is laid out exactly like a CComponentInstance: the entity
 * preamble, the draw block, a reference to the definition that holds the
 * image's face and texture, the 13-value transform (its last value, the scale
 * term, is 1.0), a string (the instance-name slot, where an image keeps its
 * source path) and a 16-byte GUID. An instance has that GUID from SketchUp
 * 2014 (file version 14) on (#310); an image's is taken to start at version
 * 14 too, as for instances. That boundary is inferred: the only real image
 * records seen are from version 8 files (no GUID) and from SketchUp 2017 and
 * 2018 files (GUID). The image reader was calibrated on SketchUp 2017 and
 * 2018 files only, and read the GUID at every version.
 *
 * A real SketchUp 8 house model (Models/House.skp of
 * github.com/fillet54/ManganoHouse) places one image definition with two
 * images back to back. The phantom GUID swallowed the second image's tag,
 * attribute ref and draw block (16 bytes, the big-tag class-ref included);
 * the entity list read the rest of that image as items, and the top two bytes
 * of its -1.0 then read as a class-ref: "class-ref to non-class slot 16368
 * (CVertex)". In a root entity list the same over-read ends the list early
 * without an error, as the instance GUID did before #310.
 */

const DEF = 1; // pre-registered: the definition the images place
const FIRST_FREE = 2;

const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const zeros = (n: number): number[] => new Array(n).fill(0);
const ascii = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0));
function f64s(...xs: number[]): number[] {
  const b = new Uint8Array(8 * xs.length);
  const view = new DataView(b.buffer);
  xs.forEach((x, i) => view.setFloat64(8 * i, x, true));
  return Array.from(b);
}
function utf16(text: string): number[] {
  const out = [0xff, 0xfe, 0xff, text.length];
  for (const ch of text) out.push(...u16(ch.charCodeAt(0)));
  return out;
}

/** A version-`ver` archive that already holds the definition the images place. */
function archive(data: number[], ver: number): Archive {
  const ar = new Archive(new Uint8Array(data), ver);
  Object.assign(ar.readers, READERS);
  ar.slots.set(DEF, ['obj', 'CComponentDefinition', { k: 'definition', name: 'Image#1' }]);
  ar.nextSlot = FIRST_FREE;
  return ar;
}

// The SketchUp 8 model's two placements of its image definition, rounded.
const XFORM_1 = [0, 0, -1, -0.0551, 0, 0, 0, 0.0551, 0, 88.915, 40.8142, 26.351];
const XFORM_2 = [0, 0, -1, -0.0551, 0, 0, 0, 0.0502, 0, 88.915, 40.8142, 28.46];
const GUID = Array.from({ length: 16 }, (_, i) => 0xa0 + i);
const GUID_HEX = GUID.map((b) => b.toString(16).toUpperCase()).join('');

/** A CImage's bytes after its class tag, as a version-`ver` file writes
 * them. A CComponentInstance's are the same, with `text` as its name. */
function placement(ver: number, xform: number[], text = ''): number[] {
  return [
    ...zeros(2), // no attribute container
    ...(ver >= 17 ? [0] : []), // persistent-id mask: no id bytes
    ...zeros(8), ...zeros(2), // draw block, layer 0
    ...u16(DEF), // the definition, a back-reference
    ...f64s(...xform, 1.0), // the transform and its scale term
    ...utf16(text), // the source path (an instance's name)
    ...(ver >= 14 ? GUID : []), // the GUID, from SketchUp 2014 on
  ];
}

/** The first image in a file declares the class (schema 1, as SketchUp 8 writes it). */
const declareImage = (): number[] => [...u16(0xffff), ...u16(1), ...u16(6), ...ascii('CImage')];
/** No relationships, then a GUID and the definition's name. */
const definitionTail = (): number[] => [...u32(0), ...zeros(2), ...zeros(16), ...utf16('Photo')];
const TAIL = ascii('TAIL');

describe('a legacy image record', () => {
  it.each([8, 13])('ends at its source path in a version %i file (no GUID)', (ver) => {
    const data = [...placement(ver, XFORM_1), ...TAIL];
    const r = new R(new Uint8Array(data), 0);
    const out = READERS['CImage'](archive(data, ver), r);
    expect(out.def).toBe(DEF);
    expect(out.xform).toEqual(XFORM_1);
    expect(out.guid).toBe('');
    expect(data.slice(r.pos)).toEqual(TAIL);
  });

  it.each([14, 17, 20])('still reads its trailing GUID in a version %i file', (ver) => {
    const data = [...placement(ver, XFORM_1), ...TAIL];
    const r = new R(new Uint8Array(data), 0);
    const out = READERS['CImage'](archive(data, ver), r);
    expect(out.def).toBe(DEF);
    expect(out.xform).toEqual(XFORM_1);
    expect(out.guid).toBe(GUID_HEX);
    expect(data.slice(r.pos)).toEqual(TAIL);
  });

  it.each([8, 13, 14, 17])('reads as many bytes as an instance record at version %i', (ver) => {
    const data = [...placement(ver, XFORM_1, 'Photo'), ...TAIL];
    const image = new R(new Uint8Array(data), 0);
    READERS['CImage'](archive(data, ver), image);
    const instance = new R(new Uint8Array(data), 0);
    const inst = READERS['CComponentInstance'](archive(data, ver), instance);
    expect(inst.name).toBe('Photo');
    expect(image.pos).toBe(instance.pos);
    expect(data.slice(image.pos)).toEqual(TAIL);
  });
});

describe('two images back to back in an entity list', () => {
  it.each([
    [8, 'def'],
    [13, 'def'],
    [8, 'root'],
    [14, 'def'],
    [17, 'def'],
  ])('version %i, %s list: both images, then the list ends', (ver, owner) => {
    const tail = definitionTail();
    const data = [
      ...declareImage(), ...placement(ver, XFORM_1), // class at FIRST_FREE, image at FIRST_FREE + 1
      ...u16(0x8000 | FIRST_FREE), ...placement(ver, XFORM_2), // a class-ref to it
      ...tail,
    ];
    const ar = archive(data, ver);
    const r = new R(new Uint8Array(data), 0);
    const ents = readEntityList(ar, r, 2, owner as string);
    expect(ents.map(([slot, name]) => [slot, name])).toEqual([
      [FIRST_FREE + 1, 'CImage'],
      [FIRST_FREE + 2, 'CImage'],
    ]);
    expect(ents.map(([, , v]) => [v.def, v.xform])).toEqual([
      [DEF, XFORM_1],
      [DEF, XFORM_2],
    ]);
    expect(data.slice(r.pos)).toEqual(tail);
  });
});
