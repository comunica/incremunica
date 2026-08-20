import 'jest-rdf';
import { partialArrayifyStream, quad } from '@incremunica/dev-tools';
import type { Quad } from '@incremunica/types';
import { arrayifyStream } from 'arrayify-stream';
import { promisifyEventEmitter } from 'event-emitter-promisify/dist';
import { Store } from 'n3';
import { DataFactory } from 'rdf-data-factory';
import { termToString } from 'rdf-string';
import { Readable } from 'readable-stream';
import { streamifyArray } from 'streamify-array';
import { StreamingStore } from '../lib';

const DF = new DataFactory();

function stringifyQuadArray(quads: Quad[]): string {
  return quads.map(quad => `${(quad.isAddition ?? true) ? '+' : '-'} ${termToString(quad.subject)} ${termToString(quad.predicate)} ${termToString(quad.object)} ${termToString(quad.graph)}`).join('. ');
}

describe('StreamingStore', () => {
  let store: StreamingStore<Quad>;

  beforeEach(() => {
    store = new StreamingStore();
  });

  it('exposes the internal store', async() => {
    expect(store.getStore()).toBeInstanceOf(Store);
  });

  it('handles an empty ended store', async() => {
    store.end();
    await expect(arrayifyStream(store.match(null, null, null, null))).resolves
      .toEqual([]);
  });

  it('handles an empty non-ended store', async() => {
    const stream = store.match(null, null, null, null);
    jest.spyOn(stream, 'on');
    await new Promise(setImmediate);
    expect(stream.on).not.toHaveBeenCalled();
  });

  it('throws when importing to an ended store', async() => {
    store.end();
    expect(() => store.import(<any>undefined))
      .toThrow('Attempted to import into an ended StreamingStore');
  });

  it('copy of store is of type Store', async() => {
    expect(store.copyOfStore()).toBeInstanceOf(Store);
  });

  it('copy of store has all quads', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s', 'p', 'o'),
    ])));

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
      quad('s', 'p', 'o'),
    ]);
  });

  it('should return hasEnded', async() => {
    expect(store.hasEnded()).toBeFalsy();
    store.end();
    expect(store.hasEnded()).toBeTruthy();
  });

  it('handle deletion of quads', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1', true),
      quad('s2', 'p2', 'o2', 'g2', true),
      quad('s3', 'p3', 'o3', 'g3', true),
    ])));

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1', false),
      quad('s2', 'p2', 'o2', 'g2', false),
    ])));

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
      quad('s3', 'p3', 'o3', 'g3'),
    ]);
  });

  it('gracefully handles ending during slow imports', async() => {
    const readStream = store.match(null, null, null, null);

    const importStream = new Readable({ objectMode: true });
    importStream._read = () => {
      setImmediate(() => {
        importStream.push(quad('s1', 'p1', 'o1', 'g1'));
        importStream.push(null);
      });
    };
    store.import(importStream);
    store.end();
    await new Promise(resolve => importStream.on('end', resolve));

    readStream.on('data', () => {
      // Void reads
    });
    const errorHandler = jest.fn();
    readStream.on('error', errorHandler);
    await new Promise(resolve => readStream.on('end', resolve));

    expect(errorHandler).not.toHaveBeenCalled();
  });

  it('gracefully handles ending during very slow imports', async() => {
    const readStream = store.match(null, null, null, null);

    const importStream = new Readable({ objectMode: true });
    importStream._read = () => {
      // Do nothing
    };
    store.import(importStream);
    store.end();

    readStream.on('data', () => {
      // Void reads
    });
    const errorHandler = jest.fn();
    readStream.on('error', errorHandler);
    await new Promise(resolve => readStream.on('end', resolve));

    importStream.push(quad('s1', 'p1', 'o1', 'g1'));
    importStream.push(null);

    expect(errorHandler).not.toHaveBeenCalled();
  });

  it('handles one match after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    store.end();

    await expect(arrayifyStream(store.match(null, null, null, null))).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
  });

  it('handles one match with multiple imports after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));
    store.end();

    await expect(arrayifyStream(store.match(null, null, null, null))).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('handles one match before end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    const match1 = store.match(null, null, null, null);
    store.end();

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
  });

  it('handles one match with multiple imports before end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));
    const match1 = store.match(null, null, null, null);
    store.end();

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('handles multiple matches after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    store.end();
    const match1 = store.match(null, null, null, null);
    const match2 = store.match(null, null, null, null);
    const match3 = store.match(null, null, null, null);

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
    await expect(arrayifyStream(match2)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
    await expect(arrayifyStream(match3)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
  });

  it('handles multiple matches with multiple imports after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));
    store.end();
    const match1 = store.match(null, null, null, null);
    const match2 = store.match(null, null, null, null);
    const match3 = store.match(null, null, null, null);

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
    await expect(arrayifyStream(match2)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
    await expect(arrayifyStream(match3)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('handles multiple matches before end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    const match1 = store.match(null, null, null, null);
    const match2 = store.match(null, null, null, null);
    const match3 = store.match(null, null, null, null);
    store.end();

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
    await expect(arrayifyStream(match2)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
    await expect(arrayifyStream(match3)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
      ]);
  });

  it('handles multiple matches with multiple imports before end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));
    const match1 = store.match(null, null, null, null);
    const match2 = store.match(null, null, null, null);
    const match3 = store.match(null, null, null, null);
    store.end();

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
    await expect(arrayifyStream(match2)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
    await expect(arrayifyStream(match3)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('handles one match with imports before and after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));

    const match1 = store.match(null, null, null, null);

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
    ])));

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    store.end();

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('handles multiple matches with imports before and after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));

    const match1 = store.match(null, null, null, null);
    const match2 = store.match(null, null, null, null);

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    store.end();

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);

    await expect(arrayifyStream(match2)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('handles multiple async matches with imports before and after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));
    const match1 = store.match(null, null, null, null);

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    store.end();

    await expect(arrayifyStream(store.match(null, null, null, null))).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s1', 'p1', 'o1', 'g1'),
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('handles matches for different quad patterns', async() => {
    const m1 = store.match(null, null, null, null);
    const ms1 = store.match(DF.namedNode('s'), null, null, null);
    const ms2 = store.match(DF.namedNode('s'), DF.namedNode('p'), null, null);
    const ms3 = store.match(DF.namedNode('s'), DF.namedNode('p'), DF.namedNode('o'), null);
    const ms4 = store
      .match(DF.namedNode('s'), DF.namedNode('p'), DF.namedNode('o'), DF.namedNode('g'));
    const mp1 = store.match(null, DF.namedNode('p'), null, null);
    const mp2 = store.match(null, DF.namedNode('p'), DF.namedNode('o'), null);
    const mp3 = store.match(null, DF.namedNode('p'), DF.namedNode('o'), DF.namedNode('g'));
    const mo1 = store.match(null, null, DF.namedNode('o'), null);
    const mo2 = store.match(null, null, DF.namedNode('o'), DF.namedNode('g'));
    const mg1 = store.match(null, null, null, DF.namedNode('g'));

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s', 'p1', 'o1'),
      quad('s', 'p', 'o2'),
      quad('s3', 'p', 'o'),
      quad('s4', 'p4', 'o', 'g'),
    ])));

    store.end();

    await expect(arrayifyStream(m1)).resolves
      .toBeRdfIsomorphic([
        quad('s', 'p1', 'o1'),
        quad('s', 'p', 'o2'),
        quad('s3', 'p', 'o'),
        quad('s4', 'p4', 'o', 'g'),
      ]);

    await expect(arrayifyStream(ms1)).resolves
      .toBeRdfIsomorphic([
        quad('s', 'p1', 'o1'),
        quad('s', 'p', 'o2'),
      ]);
    await expect(arrayifyStream(ms2)).resolves
      .toBeRdfIsomorphic([
        quad('s', 'p', 'o2'),
      ]);
    await expect(arrayifyStream(ms3)).resolves
      .toBeRdfIsomorphic([]);
    await expect(arrayifyStream(ms4)).resolves
      .toBeRdfIsomorphic([]);

    await expect(arrayifyStream(mp1)).resolves
      .toBeRdfIsomorphic([
        quad('s', 'p', 'o2'),
        quad('s3', 'p', 'o'),
      ]);
    await expect(arrayifyStream(mp2)).resolves
      .toBeRdfIsomorphic([
        quad('s3', 'p', 'o'),
      ]);
    await expect(arrayifyStream(mp3)).resolves
      .toBeRdfIsomorphic([]);

    await expect(arrayifyStream(mo1)).resolves
      .toBeRdfIsomorphic([
        quad('s3', 'p', 'o'),
        quad('s4', 'p4', 'o', 'g'),
      ]);
    await expect(arrayifyStream(mo2)).resolves
      .toBeRdfIsomorphic([
        quad('s4', 'p4', 'o', 'g'),
      ]);

    await expect(arrayifyStream(mg1)).resolves
      .toBeRdfIsomorphic([
        quad('s4', 'p4', 'o', 'g'),
      ]);
  });

  it('handles multiple matches with removes before and after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));
    await promisifyEventEmitter(store.remove(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));
    await new Promise(resolve => setImmediate(resolve));

    const match1 = store.match(null, null, null, null);
    const match2 = store.match(null, null, null, null);
    const posQuad = quad('s5', 'p5', 'o5', 'g5', true);

    await promisifyEventEmitter(store.remove(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    await promisifyEventEmitter(store.remove(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
      posQuad,
    ])));

    store.end();

    expect(stringifyQuadArray(await arrayifyStream(match1))).toEqual(stringifyQuadArray([
      quad('s2', 'p2', 'o2', 'g2', true),
      quad('s3', 'p3', 'o3', 'g3', true),
      quad('s4', 'p4', 'o4', 'g4', true),
      quad('s2', 'p2', 'o2', 'g2', false),
      quad('s3', 'p3', 'o3', 'g3', false),
      quad('s4', 'p4', 'o4', 'g4', false),
      quad('s5', 'p5', 'o5', 'g5', true),
    ]));
    expect(stringifyQuadArray(await arrayifyStream(match2))).toEqual(stringifyQuadArray([
      quad('s2', 'p2', 'o2', 'g2', true),
      quad('s3', 'p3', 'o3', 'g3', true),
      quad('s4', 'p4', 'o4', 'g4', true),
      quad('s2', 'p2', 'o2', 'g2', false),
      quad('s3', 'p3', 'o3', 'g3', false),
      quad('s4', 'p4', 'o4', 'g4', false),
      quad('s5', 'p5', 'o5', 'g5', true),
    ]));
  });

  it('handles multiple async matches with removes before and after end', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));
    await promisifyEventEmitter(store.remove(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));
    const match1 = store.match(null, null, null, null);

    await promisifyEventEmitter(store.remove(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    await promisifyEventEmitter(store.remove(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));
    store.end();

    await expect(arrayifyStream(store.match(null, null, null, null))).resolves
      .toBeRdfIsomorphic([]);

    await expect(arrayifyStream(match1)).resolves
      .toBeRdfIsomorphic([
        quad('s2', 'p2', 'o2', 'g2'),
        quad('s3', 'p3', 'o3', 'g3'),
        quad('s4', 'p4', 'o4', 'g4'),
      ]);
  });

  it('trows error for remove after end', async() => {
    store.end();

    expect(() => {
      store.remove(streamifyArray([
        quad('s1', 'p1', 'o1', 'g1'),
      ]));
    }).toThrow('Attempted to remove out of an ended StreamingStore');
  });

  it('handles halting', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const matchStream = store.match(null, null, null, null);

    expect(store.isHalted()).toBeFalsy();
    store.halt();
    expect(store.isHalted()).toBeTruthy();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    await promisifyEventEmitter(store.remove(streamifyArray([
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.resume();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
    ]);

    store.end();

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
  });

  it('handles multiple halting', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const matchStream = store.match(null, null, null, null);

    await expect(partialArrayifyStream<Quad>(matchStream, 2)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.halt();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
      quad('s4', 'p4', 'o4', 'g4', false),
    ])));

    store.resume();

    let actualArray = await partialArrayifyStream<Quad>(<Readable>matchStream, 3);
    expect(actualArray).toBeRdfIsomorphic([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
    expect(actualArray[0].isAddition).toBeTruthy();
    expect(actualArray[1].isAddition).toBeTruthy();
    expect(actualArray[2].isAddition).toBeFalsy();

    store.halt();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3', false),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    store.resume();

    actualArray = await partialArrayifyStream<Quad>(<Readable>matchStream, 2);
    expect(actualArray).toBeRdfIsomorphic([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
    expect(actualArray[0].isAddition).toBeFalsy();
    expect(actualArray[1].isAddition).toBeTruthy();

    store.end();
  });

  it('handles end during halting', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const matchStream = store.match(null, null, null, null);

    expect(store.isHalted()).toBeFalsy();
    store.halt();
    expect(store.isHalted()).toBeTruthy();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.resume();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);
  });

  it('closeStream should stop match', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const options = {
      closeStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    options.closeStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
  });

  it('closeStream should stop match with multiple match 1', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));

    const options1 = {
      closeStream: () => {},
    };
    const matchStream1 = store.match(
      null,
      null,
      null,
      null,
      options1,
    );

    const options2 = {
      closeStream: () => {},
    };
    const matchStream2 = store.match(
      null,
      null,
      null,
      null,
      options2,
    );

    options1.closeStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    options2.closeStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
    ])));

    await expect(arrayifyStream(matchStream1)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
    ]);

    await expect(arrayifyStream(matchStream2)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
    ]);
  });

  it('closeStream after end 2', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    store.end();

    const options = {
      closeStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    options.closeStream(); // Does noting

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);
  });

  it('handle closeStream with halt 1', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const options = {
      closeStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    store.halt();
    options.closeStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic(
      await arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    );

    store.resume();
    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
  });

  it('handle closeStream with halt with deletions 1', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const options = {
      closeStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    store.halt();
    options.closeStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1', false),
      quad('s2', 'p2', 'o2', 'g2', false),
    ])));

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic(
      await arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    );

    store.resume();
    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([]);
  });

  // Additions
  it('deleteStream should first propagate everything as deletions and then stop', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const options = {
      deleteStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    options.deleteStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s1', 'p1', 'o1', 'g1', false),
      quad('s2', 'p2', 'o2', 'g2', false),
    ]);

    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
  });

  it('deleteStream should first propagate everything as deletions and then stop 2', async() => {
    store.addQuad(
      quad('s1', 'p1', 'o1', 'g1'),
    );

    const options = {
      deleteStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    options.deleteStream();

    const array = await arrayifyStream(matchStream);
    expect(array[0]).toEqualRdfQuad(
      quad('s1', 'p1', 'o1', 'g1'),
    );
    expect(array[1]).toEqualRdfQuad(
      quad('s1', 'p1', 'o1', 'g1'),
    );
    expect(array[0].isAddition).toBeTruthy();
    expect(array[1].isAddition).toBeFalsy();
  });

  it('closeStream should stop match with multiple match 2', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));

    const options1 = {
      deleteStream: () => {},
    };
    const matchStream1 = store.match(
      null,
      null,
      null,
      null,
      options1,
    );

    const options2 = {
      deleteStream: () => {},
    };
    const matchStream2 = store.match(
      null,
      null,
      null,
      null,
      options2,
    );

    options1.deleteStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    options2.deleteStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
    ])));

    await expect(arrayifyStream(matchStream1)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s1', 'p1', 'o1', 'g1', false),
    ]);

    await expect(arrayifyStream(matchStream2)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s1', 'p1', 'o1', 'g1', false),
      quad('s2', 'p2', 'o2', 'g2', false),
    ]);

    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
    ]);
  });

  it('closeStream after end 1', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    store.end();

    const options = {
      deleteStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    options.deleteStream(); // Does noting

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);
  });

  it('handle closeStream with halt 2', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const options = {
      deleteStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    store.halt();
    options.deleteStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ])));

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s1', 'p1', 'o1', 'g1', false),
      quad('s2', 'p2', 'o2', 'g2', false),
    ]);

    store.resume();
    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
  });

  it('handle closeStream with halt with deletions 2', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    const options = {
      deleteStream: () => {},
    };

    const matchStream = store.match(
      null,
      null,
      null,
      null,
      options,
    );

    store.halt();
    options.deleteStream();

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1', false),
      quad('s2', 'p2', 'o2', 'g2', false),
    ])));

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s1', 'p1', 'o1', 'g1', false),
      quad('s2', 'p2', 'o2', 'g2', false),
    ]);

    store.resume();
    store.end();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([]);
  });

  it('should return the amount of quads', async() => {
    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ])));

    expect(store.countQuads(null, null, null, null)).toBe(2);

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));

    expect(store.countQuads(null, null, null, null)).toBe(2);

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1', false),
    ])));

    expect(store.countQuads(null, null, null, null)).toBe(1);

    await promisifyEventEmitter(store.import(streamifyArray([
      quad('s1', 'p1', 'o1', 'g1'),
    ])));

    expect(store.countQuads(DF.namedNode('s1'), null, null, null)).toBe(1);

    store.end();
  });

  it('should handle single quad insertions', async() => {
    store.addQuad(quad('s1', 'p1', 'o1', 'g1'));

    const match = store.match(null, null, null, null);

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
    ]);
    store.addQuad(quad('s2', 'p2', 'o2', 'g2', true));

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.addQuad(quad('s2', 'p2', 'o2', 'g2', false));

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
    ]);

    store.end();

    await expect(arrayifyStream(match)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);
  });

  it('should handle single quad removals', async() => {
    store.removeQuad(quad('s1', 'p1', 'o1', 'g1', true));
    store.removeQuad(quad('s2', 'p2', 'o2', 'g2', true));

    const match = store.match(null, null, null, null);

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.removeQuad(quad('s1', 'p1', 'o1', 'g1'));

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.addQuad(quad('s2', 'p2', 'o2', 'g2', false));

    await expect(
      arrayifyStream(store.copyOfStore().match(null, null, null, null)),
    ).resolves.toBeRdfIsomorphic([
    ]);

    store.end();

    await expect(arrayifyStream(match)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);
  });

  it('should throw error if addQuad after end', async() => {
    store.end();

    expect(() => {
      store.addQuad(quad('s1', 'p1', 'o1', 'g1'));
    }).toThrow('Attempted to add a quad into an ended StreamingStore.');
  });

  it('should throw error if removeQuad after end', async() => {
    store.end();

    expect(() => {
      store.removeQuad(quad('s1', 'p1', 'o1', 'g1'));
    }).toThrow('Attempted to remove a quad of an ended StreamingStore.');
  });

  it('handles halting with addQuad', async() => {
    store.addQuad(quad('s1', 'p1', 'o1', 'g1'));
    store.addQuad(quad('s2', 'p2', 'o2', 'g2'));

    const matchStream = store.match(null, null, null, null);

    expect(store.isHalted()).toBeFalsy();
    store.halt();
    expect(store.isHalted()).toBeTruthy();

    store.addQuad(quad('s3', 'p3', 'o3', 'g3'));
    store.addQuad(quad('s4', 'p4', 'o4', 'g4'));

    store.removeQuad(quad('s4', 'p4', 'o4', 'g4'));

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
    ]);

    store.resume();

    await expect(arrayifyStream(store.copyOfStore().match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
    ]);

    store.end();

    await expect(arrayifyStream(matchStream)).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
      quad('s2', 'p2', 'o2', 'g2'),
      quad('s3', 'p3', 'o3', 'g3'),
      quad('s4', 'p4', 'o4', 'g4'),
      quad('s4', 'p4', 'o4', 'g4'),
    ]);
  });

  it('should be set semantics', async() => {
    store.addQuad(quad('s1', 'p1', 'o1', 'g1'));
    store.addQuad(quad('s1', 'p1', 'o1', 'g1'));

    store.removeQuad(quad('s2', 'p2', 'o2', 'g2'));

    store.end();

    await expect(arrayifyStream(store.match(null, null, null, null))).resolves.toBeRdfIsomorphic([
      quad('s1', 'p1', 'o1', 'g1'),
    ]);
  });
});
