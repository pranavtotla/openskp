import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkp, type Definition, type SkpModel } from '../src/index';

/**
 * The real file behind legacy-image-guid.test.ts: Models/House.skp of
 * github.com/fillet54/ManganoHouse, a SketchUp 8.0.4810 house model
 * (10,071,838 bytes) with three Image entities. It is not in this repository:
 * set OPENSKP_CORPUS_DIR to a directory that holds it as
 * gh-ManganoHouse-House.skp to run these tests. Without the variable (or
 * without the file there) they are skipped.
 */
const NAME = 'gh-ManganoHouse-House.skp';
const dir = process.env.OPENSKP_CORPUS_DIR;
const file = dir ? path.join(dir, NAME) : null;
const present = file !== null && fs.existsSync(file);

describe.skipIf(!present)(`${NAME} from OPENSKP_CORPUS_DIR`, () => {
  let model: SkpModel;
  let defs: Definition[];
  beforeAll(() => {
    const buf = fs.readFileSync(file as string);
    model = parseSkp(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    defs = [...model.definitions.values()];
  });

  it('reads the whole model (was: class-ref to non-class slot 16368 (CVertex))', () => {
    expect(model.version).toBe('{8.0.4810}');
    expect(defs.length).toBe(210);
    expect(defs.filter((d) => d.isGroup).length).toBe(173);
    expect(defs.reduce((n, d) => n + d.faces.length, 0)).toBe(25787);
    expect(defs.reduce((n, d) => n + d.edges.length, 0)).toBe(60445);
    expect([model.root, ...defs].reduce((n, d) => n + d.instances.length, 0)).toBe(335);
    expect(model.root.instances.length).toBe(62);
    const names = new Set(defs.map((d) => d.name));
    for (const name of ['Door', 'Skirting', 'StanTheMan’s Kitchen Cabinet Store', 'PFSS6PKXSS_DC']) {
      expect(names.has(name)).toBe(true);
    }
  });

  it('places its three images', () => {
    const images = defs.filter((d) => d.isImage);
    expect(images.map((d) => d.name).sort()).toEqual(['Image', 'Image#1']);
    for (const d of images) {
      expect([d.faces.length, d.edges.length]).toEqual([1, 4]);
      expect(model.materialsById.get(d.faces[0].materialId!)?.texture).toBeTruthy();
    }
    const placed = [model.root, ...defs]
      .flatMap((d) => d.instances)
      .map((i) => model.definitions.get(i.refIdx)!)
      .filter((d) => d.isImage)
      .map((d) => d.name)
      .sort();
    expect(placed).toEqual(['Image', 'Image#1', 'Image#1']);
  });

  it('reads its layers and materials', () => {
    expect(model.layers.map((l) => l.name)).toEqual([
      'Layer0', 'Walls', 'Doors', 'Door Frames', 'Ceilings', 'Floor', 'Fence', 'Ground', 'Floorplan',
      'Lower_Cabinets', 'Appliances', 'Extra Cabinets', 'Counter Tops', 'Upper_Cabinets', 'Skyportal',
    ]);
    // the file was saved with every layer but the active one, Skyportal, hidden
    expect(model.layers.filter((l) => !l.hidden).map((l) => l.name)).toEqual(['Skyportal']);
    expect(model.materials.length).toBe(62);
    expect(model.materials.filter((m) => m.texture).length).toBe(9);
  });
});
