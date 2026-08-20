import { Readable } from 'node:stream';
import { KeysQueryOperation } from '@comunica/context-entries';
import type { IActionContext } from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import { MetadataValidationState } from '@comunica/utils-metadata';
import { KeysBindings, KeysStreamingSource } from '@incremunica/context-entries';
import { quad, createTestContextWithDataFactory, createTestBindingsFactory } from '@incremunica/dev-tools';
import { StreamingQuerySourceStatus } from '@incremunica/streaming-query-source';
import { StreamingStore } from '@incremunica/streaming-store';
import type { Quad } from '@incremunica/types';
import { arrayifyStream } from 'arrayify-stream';
import { ArrayIterator } from 'asynciterator';
import { DataFactory } from 'rdf-data-factory';
import { PassThrough } from 'readable-stream';
import { Factory } from 'sparqlalgebrajs';
import { streamifyArray } from 'streamify-array';
import { StreamingQuerySourceRdfJs } from '../lib';
import '@incremunica/jest';
import '@comunica/utils-jest';
import 'jest-rdf';

const DF = new DataFactory();
const AF = new Factory();

describe('StreamingQuerySourceRdfJs', () => {
  let ctx: IActionContext;

  let store: StreamingStore<Quad>;
  let source: StreamingQuerySourceRdfJs;
  let BF: BindingsFactory;
  beforeEach(async() => {
    ctx = createTestContextWithDataFactory(DF);
    ctx = ctx.set(KeysStreamingSource.matchOptions, []);
    store = new StreamingStore();
    BF = await createTestBindingsFactory(DF);
    source = new StreamingQuerySourceRdfJs(store, DF, BF);
  });

  describe('halt & resume', () => {
    it('should halt & resume StreamingStore', async() => {
      expect(store.isHalted()).toBe(false);
      source.halt();
      expect(store.isHalted()).toBe(true);
      source.resume();
      expect(store.isHalted()).toBe(false);
    });
  });

  describe('getSelectorShape', () => {
    it('should return a selector shape', async() => {
      await expect(source.getSelectorShape()).resolves.toEqual({
        type: 'operation',
        operation: {
          operationType: 'pattern',
          pattern: AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        },
        variablesOptional: [
          DF.variable('s'),
          DF.variable('p'),
          DF.variable('o'),
        ],
      });
    });
  });

  describe('toString', () => {
    it('should return a string representation', async() => {
      expect(source.toString()).toBe('StreamingQuerySourceRdfJs(StreamingStore)');
    });
  });

  describe('queryBindings', () => {
    it('should throw when passing non-pattern', async() => {
      expect(() => source.queryBindings(
        AF.createNop(),
        ctx,
      )).toThrow(`Attempted to pass non-pattern operation 'nop' to StreamingQuerySourceRdfJs`);
    });

    it('should throw when the store doesn\'t replace the closeStream', async() => {
      store = <any> {
        match: () => streamifyArray([]),
        countQuads: () => 1,
      };
      source = new StreamingQuerySourceRdfJs(store, DF, BF);
      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([]);
      expect(ctx.get(KeysStreamingSource.matchOptions)[0].closeStream)
        .toThrow(new Error('closeStream function has not been replaced in streaming store.'));
    });

    it('should change status when the stream is read', async() => {
      store = <any>{
        match: (s, p, o, g, matchoptions) => {
          const stream = new PassThrough({ objectMode: true });
          matchoptions.closeStream = () => {
            stream.end();
          };
          stream.push(quad('s1', 'p1', 'o1'));
          return stream;
        },
        countQuads: () => 1,
      };
      source = new StreamingQuerySourceRdfJs(store, DF, BF);
      expect(source.status).toBe(StreamingQuerySourceStatus.Initializing);
      const data1 = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        ctx,
      );
      expect(source.status).toBe(StreamingQuerySourceStatus.Initializing);
      const data2 = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        ctx,
      );
      expect(source.status).toBe(StreamingQuerySourceStatus.Initializing);
      data1.read();
      expect(source.status).toBe(StreamingQuerySourceStatus.Running);
      data1.close();
      await new Promise(resolve => setImmediate(resolve));
      expect(source.status).toBe(StreamingQuerySourceStatus.Idle);
      data2.read();
      expect(source.status).toBe(StreamingQuerySourceStatus.Running);
      data2.close();
      await new Promise(resolve => setImmediate(resolve));
      expect(source.status).toBe(StreamingQuerySourceStatus.Idle);
    });

    it('should close the stream if closeStream is called', async() => {
      const closeFn = jest.fn();
      store = <any>{
        match: (s, p, o, g, matchoptions) => {
          closeFn();
          const stream = new PassThrough({ objectMode: true });
          matchoptions.closeStream = () => {
            stream.end();
          };
          stream.push(quad('s1', 'p1', 'o1'));
          return stream;
        },
        countQuads: () => 1,
      };
      source = new StreamingQuerySourceRdfJs(store, DF, BF);
      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        ctx,
      );
      ctx.get(KeysStreamingSource.matchOptions)[0].closeStream();
      await expect(data).toEqualBindingsStream([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ]);
      expect(closeFn).toHaveBeenCalledTimes(1);
      expect(data.closed).toBeTruthy();
    });

    it('should close the stream if closeStream is called (with real store)', async() => {
      store.addQuad(quad('s1', 'p1', 'o1'));
      source = new StreamingQuerySourceRdfJs(store, DF, BF);
      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        ctx,
      );
      ctx.get(KeysStreamingSource.matchOptions)[0].closeStream();
      await expect(data).toEqualBindingsStream([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ]);
      expect(data.closed).toBeTruthy();
    });

    it('should throw when the store doesn\'t replace the deleteStream', async() => {
      store = <any> {
        match: () => streamifyArray([]),
        countQuads: () => 1,
      };
      source = new StreamingQuerySourceRdfJs(store, DF, BF);
      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([]);
      expect(ctx.get(KeysStreamingSource.matchOptions)[0].deleteStream)
        .toThrow(new Error('deleteStream function has not been replaced in streaming store.'));
    });

    it('should delete the stream if deleteStream is called', async() => {
      const deleteFn = jest.fn();
      store = <any>{
        match: (s, p, o, g, matchoptions) => {
          deleteFn();
          const stream = new PassThrough({ objectMode: true });
          matchoptions.deleteStream = () => {
            stream.push(quad('s1', 'p1', 'o1', 'g', false));
            stream.end();
          };
          stream.push(quad('s1', 'p1', 'o1', 'g', true));
          return stream;
        },
        countQuads: () => 1,
      };
      source = new StreamingQuerySourceRdfJs(store, DF, BF);
      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        ctx,
      );
      ctx.get(KeysStreamingSource.matchOptions)[0].deleteStream();
      await expect(data).toEqualBindingsStream([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
      expect(deleteFn).toHaveBeenCalledTimes(1);
      expect(data.closed).toBeTruthy();
    });

    it('should delete the stream if deleteStream is called (with real store)', async() => {
      store.addQuad(quad('s1', 'p1', 'o1'));
      source = new StreamingQuerySourceRdfJs(store, DF, BF);
      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        ctx,
      );
      ctx.get(KeysStreamingSource.matchOptions)[0].deleteStream();
      await expect(data).toEqualBindingsStream([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
      expect(data.closed).toBeTruthy();
    });

    it('should destroy stream if setMetadata function throws', async() => {
      (<any>source).setMetadata = async() => {
        throw new Error('setMetadata error');
      };
      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
        ctx,
      );
      await expect(arrayifyStream(data)).rejects.toThrow(new Error('setMetadata error'));
    });

    it('should return triples in the default graph', async() => {
      store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
      store.end();

      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([
        BF.fromRecord({
          s: DF.namedNode('s1'),
          o: DF.namedNode('o1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          s: DF.namedNode('s2'),
          o: DF.namedNode('o2'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      //
      // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
      // .toEqual({
      //     cardinality: { type: 'exact', value: 2 },
      //     state: expect.any(MetadataValidationState),
      //     variables: [{
      //       canBeUndef: false,
      //       variable: DF.variable('s'),
      //     }, {
      //       canBeUndef: false,
      //       variable: DF.variable('o'),
      //     }],
      // });
      //
    });

    it('should return triples in a named graph', async() => {
      store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1'), DF.namedNode('g1')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2'), DF.namedNode('g2')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3'), DF.namedNode('g3')));
      store.end();

      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o'), DF.namedNode('g1')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([
        BF.fromRecord({
          s: DF.namedNode('s1'),
          o: DF.namedNode('o1'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);
      await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
        .toEqual({
          state: expect.any(MetadataValidationState),
          cardinality: { type: 'exact', value: 1 },
          variables: [{
            canBeUndef: false,
            variable: DF.variable('s'),
          }, {
            canBeUndef: false,
            variable: DF.variable('o'),
          }],
        });
    });

    it('should return quads in named graphs', async() => {
      store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1'), DF.namedNode('g1')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
      store.end();

      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o'), DF.variable('g')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([
        BF.fromRecord({
          s: DF.namedNode('s1'),
          o: DF.namedNode('o1'),
          g: DF.namedNode('g1'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);
      //
      // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
      // .toEqual({
      //     cardinality: { type: 'estimate', value: 2 },
      //     canContainUndefs: false,
      //     state: expect.any(MetadataValidationState),
      //     variables: [ DF.variable('s'), DF.variable('o'), DF.variable('g') ],
      // });
      //
    });

    it('should return quads in named graphs and the default graph with union default graph', async() => {
      ctx = ctx.set(KeysQueryOperation.unionDefaultGraph, true);

      store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1'), DF.namedNode('g1')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
      store.end();

      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o'), DF.variable('g')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([
        BF.fromRecord({
          s: DF.namedNode('s1'),
          o: DF.namedNode('o1'),
          g: DF.namedNode('g1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          s: DF.namedNode('s2'),
          o: DF.namedNode('o2'),
          g: DF.defaultGraph(),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);
      //
      // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
      // .toEqual({
      //     cardinality: { type: 'exact', value: 2 },
      //     canContainUndefs: false,
      //     state: expect.any(MetadataValidationState),
      //     variables: [ DF.variable('s'), DF.variable('o'), DF.variable('g') ],
      // });
      //
    });

    it('should use countQuads if available', async() => {
      (<any> store).countQuads = () => 123;

      store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
      store.end();

      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([
        BF.fromRecord({
          s: DF.namedNode('s1'),
          o: DF.namedNode('o1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          s: DF.namedNode('s2'),
          o: DF.namedNode('o2'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      //
      // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
      // .toEqual({
      //     cardinality: { type: 'exact', value: 123 },
      //     state: expect.any(MetadataValidationState),
      //     variables: [{
      //       canBeUndef: false,
      //       variable: DF.variable('s'),
      //     }, {
      //       canBeUndef: false,
      //       variable: DF.variable('o'),
      //     }],
      // });
      //
    });

    it('should fallback to match if countQuads is not available', async() => {
      store = new StreamingStore();
      (<any> store).countQuads = undefined;
      source = new StreamingQuerySourceRdfJs(store, DF, BF);

      store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
      store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
      store.end();

      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
        ctx,
      );
      await expect(data).toEqualBindingsStream([
        BF.fromRecord({
          s: DF.namedNode('s1'),
          o: DF.namedNode('o1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          s: DF.namedNode('s2'),
          o: DF.namedNode('o2'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      //
      // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
      // .toEqual({
      //     cardinality: { type: 'exact', value: 2 },
      //     canContainUndefs: false,
      //     state: expect.any(MetadataValidationState),
      //     variables: [{
      //       canBeUndef: false,
      //       variable: DF.variable('s'),
      //     }, {
      //       canBeUndef: false,
      //       variable: DF.variable('o'),
      //     }],
      // });
      //
    });

    it('should delegate errors', async() => {
      const it = new Readable();
      it._read = () => {
        it.emit('error', new Error('RdfJsSource error'));
      };
      store = <any> { match: () => it };
      source = new StreamingQuerySourceRdfJs(store, DF, BF);

      const data = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
        ctx,
      );
      await expect(arrayifyStream(data)).rejects.toThrow(new Error('RdfJsSource error'));
    });

    it('should destroy quadsStream and handle status', async() => {
      store = <any>{
        match: () => {
          return null;
        },
      };
      source = new StreamingQuerySourceRdfJs(store, DF, BF);

      const quadsStream1 = new PassThrough({ objectMode: true });
      store.match = () => quadsStream1;
      expect(source.status).toBe(StreamingQuerySourceStatus.Initializing);
      const data1 = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o'), DF.namedNode('g1')),
        ctx,
      );
      data1.read();
      expect(source.status).toBe(StreamingQuerySourceStatus.Running);

      data1.destroy();
      expect(quadsStream1.destroyed).toBe(true);
      expect(source.status).toBe(StreamingQuerySourceStatus.Idle);

      const quadsStream2 = new PassThrough({ objectMode: true });
      store.match = () => quadsStream2;
      const data2 = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o'), DF.namedNode('g1')),
        ctx,
      );
      data2.read();
      expect(source.status).toBe(StreamingQuerySourceStatus.Running);
      const quadsStream3 = new PassThrough({ objectMode: true });
      store.match = () => quadsStream3;
      const data3 = source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o'), DF.namedNode('g1')),
        ctx,
      );
      data3.read();
      expect(source.status).toBe(StreamingQuerySourceStatus.Running);

      data2.destroy();
      expect(quadsStream2.destroyed).toBe(true);
      expect(source.status).toBe(StreamingQuerySourceStatus.Running);

      data3.destroy();
      expect(quadsStream3.destroyed).toBe(true);
      expect(source.status).toBe(StreamingQuerySourceStatus.Idle);
    });

    describe('for quoted triples', () => {
      describe('with a store supporting quoted triple filtering', () => {
        beforeEach(() => {
          store = new StreamingStore();
          source = new StreamingQuerySourceRdfJs(store, DF, BF);
        });

        it('should run when containing quoted triples', async() => {
          store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('p'), DF.quad(
            DF.namedNode('sa3'),
            DF.namedNode('pax'),
            DF.namedNode('oa3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.namedNode('ob3'),
          )));
          store.end();

          const data = source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            ctx,
          );
          await expect(data).toEqualBindingsStream([
            BF.fromRecord({
              s: DF.namedNode('s1'),
              o: DF.namedNode('o1'),
            }).setContextEntry(KeysBindings.isAddition, true),
            BF.fromRecord({
              s: DF.namedNode('s2'),
              o: DF.namedNode('o2'),
            }).setContextEntry(KeysBindings.isAddition, true),
            BF.fromRecord({
              s: DF.namedNode('s3'),
              o: DF.quad(
                DF.namedNode('sa3'),
                DF.namedNode('pax'),
                DF.namedNode('oa3'),
              ),
            }).setContextEntry(KeysBindings.isAddition, true),
          ]);

          //
          // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
          // .toEqual({
          //     cardinality: { type: 'exact', value: 3 },
          //     canContainUndefs: false,
          //     state: expect.any(MetadataValidationState),
          //     variables: [{
          //       canBeUndef: false,
          //       variable: DF.variable('s'),
          //     }, {
          //       canBeUndef: false,
          //       variable: DF.variable('o'),
          //     }],
          // });
          //
        });

        it('should run when containing quoted triples with a quoted pattern (1)', async() => {
          store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('p'), DF.quad(
            DF.namedNode('sa3'),
            DF.namedNode('pax'),
            DF.namedNode('oa3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.namedNode('ob3'),
          )));
          store.end();

          const data = source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.quad(
              DF.variable('s1'),
              DF.variable('p1'),
              DF.variable('o1'),
            )),
            ctx,
          );
          await expect(data).toEqualBindingsStream([
            BF.fromRecord({
              s: DF.namedNode('s3'),
              s1: DF.namedNode('sa3'),
              p1: DF.namedNode('pax'),
              o1: DF.namedNode('oa3'),
            }).setContextEntry(KeysBindings.isAddition, true),
          ]);
          await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
            .toEqual({
              state: expect.any(MetadataValidationState),
              cardinality: { type: 'estimate', value: 3 },
              variables: [{
                canBeUndef: false,
                variable: DF.variable('s'),
              }, {
                canBeUndef: false,
                variable: DF.variable('s1'),
              }, {
                canBeUndef: false,
                variable: DF.variable('p1'),
              }, {
                canBeUndef: false,
                variable: DF.variable('o1'),
              }],
            });
        });

        it('should run when containing quoted triples with a quoted pattern (2)', async() => {
          store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('p'), DF.quad(
            DF.namedNode('sa3'),
            DF.namedNode('pax'),
            DF.namedNode('oa3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.namedNode('ob3'),
          )));
          store.end();

          const data = source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.variable('p'), DF.quad(
              DF.variable('s1'),
              DF.namedNode('pbx'),
              DF.variable('o1'),
            )),
            ctx,
          );
          await expect(data).toEqualBindingsStream([
            BF.fromRecord({
              s: DF.namedNode('s4'),
              p: DF.namedNode('px'),
              s1: DF.namedNode('sb3'),
              o1: DF.namedNode('ob3'),
            }).setContextEntry(KeysBindings.isAddition, true),
          ]);
          await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
            .toEqual({
              state: expect.any(MetadataValidationState),
              cardinality: { type: 'estimate', value: 5 },
              variables: [{
                canBeUndef: false,
                variable: DF.variable('s'),
              }, {
                canBeUndef: false,
                variable: DF.variable('p'),
              }, {
                canBeUndef: false,
                variable: DF.variable('s1'),
              }, {
                canBeUndef: false,
                variable: DF.variable('o1'),
              }],
            });
        });

        it('should run when containing quoted triples with a nested quoted pattern', async() => {
          store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('p'), DF.quad(
            DF.namedNode('sa3'),
            DF.namedNode('pax'),
            DF.namedNode('oa3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.namedNode('ob3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.quad(
              DF.namedNode('sb3'),
              DF.namedNode('pbx'),
              DF.namedNode('ob3'),
            ),
          )));
          store.end();

          const data = source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.variable('p'), DF.quad(
              DF.variable('s1'),
              DF.namedNode('pbx'),
              DF.quad(
                DF.variable('s2'),
                DF.variable('pcx'),
                DF.variable('o2'),
              ),
            )),
            ctx,
          );
          await expect(data).toEqualBindingsStream([
            BF.fromRecord({
              s: DF.namedNode('s4'),
              p: DF.namedNode('px'),
              s1: DF.namedNode('sb3'),
              s2: DF.namedNode('sb3'),
              pcx: DF.namedNode('pbx'),
              o2: DF.namedNode('ob3'),
            }).setContextEntry(KeysBindings.isAddition, true),
          ]);
          await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
            .toEqual({
              cardinality: { type: 'estimate', value: 6 },
              state: expect.any(MetadataValidationState),
              variables: [{
                canBeUndef: false,
                variable: DF.variable('s'),
              }, {
                canBeUndef: false,
                variable: DF.variable('p'),
              }, {
                canBeUndef: false,
                variable: DF.variable('s1'),
              }, {
                canBeUndef: false,
                variable: DF.variable('s2'),
              }, {
                canBeUndef: false,
                variable: DF.variable('pcx'),
              }, {
                canBeUndef: false,
                variable: DF.variable('o2'),
              }],
            });
        });
      });

      describe('with a store not supporting quoted triple filtering', () => {
        beforeEach(() => {
          store = new StreamingStore();
          source = new StreamingQuerySourceRdfJs(store, DF, BF);
        });

        it('should run when containing quoted triples', async() => {
          store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('p'), DF.quad(
            DF.namedNode('sa3'),
            DF.namedNode('pax'),
            DF.namedNode('oa3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.namedNode('ob3'),
          )));
          store.end();

          const data = source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            ctx,
          );
          await expect(data).toEqualBindingsStream([
            BF.fromRecord({
              s: DF.namedNode('s1'),
              o: DF.namedNode('o1'),
            }).setContextEntry(KeysBindings.isAddition, true),
            BF.fromRecord({
              s: DF.namedNode('s2'),
              o: DF.namedNode('o2'),
            }).setContextEntry(KeysBindings.isAddition, true),
            BF.fromRecord({
              s: DF.namedNode('s3'),
              o: DF.quad(
                DF.namedNode('sa3'),
                DF.namedNode('pax'),
                DF.namedNode('oa3'),
              ),
            }).setContextEntry(KeysBindings.isAddition, true),
          ]);

          //
          // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
          // .toEqual({
          //     cardinality: { type: 'exact', value: 3 },
          //     canContainUndefs: false,
          //     state: expect.any(MetadataValidationState),
          //     variables: [{
          //       canBeUndef: false,
          //       variable: DF.variable('s'),
          //     }, {
          //       canBeUndef: false,
          //       variable: DF.variable('o'),
          //     }],
          // });
          //
        });

        it('should run when containing quoted triples with a quoted pattern (1)', async() => {
          store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('p'), DF.quad(
            DF.namedNode('sa3'),
            DF.namedNode('pax'),
            DF.namedNode('oa3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.namedNode('ob3'),
          )));
          store.end();

          const data = source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.quad(
              DF.variable('s1'),
              DF.variable('p1'),
              DF.variable('o1'),
            )),
            ctx,
          );
          await expect(data).toEqualBindingsStream([
            BF.fromRecord({
              s: DF.namedNode('s3'),
              s1: DF.namedNode('sa3'),
              p1: DF.namedNode('pax'),
              o1: DF.namedNode('oa3'),
            }).setContextEntry(KeysBindings.isAddition, true),
          ]);

          //
          // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
          // .toEqual({
          //     cardinality: { type: 'estimate', value: 3 },
          //     state: expect.any(MetadataValidationState),
          //     variables: [{
          //       canBeUndef: false,
          //       variable: DF.variable('s'),
          //     }, {
          //       canBeUndef: false,
          //       variable: DF.variable('s1'),
          //     }, {
          //       canBeUndef: false,
          //       variable: DF.variable('p1'),
          //     }, {
          //       canBeUndef: false,
          //       variable: DF.variable('o1'),
          //     }],
          // });
          //
        });

        it('should run when containing quoted triples with a quoted pattern (2)', async() => {
          store.addQuad(<Quad>DF.quad(DF.namedNode('s1'), DF.namedNode('p'), DF.namedNode('o1')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s2'), DF.namedNode('p'), DF.namedNode('o2')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('px'), DF.namedNode('o3')));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s3'), DF.namedNode('p'), DF.quad(
            DF.namedNode('sa3'),
            DF.namedNode('pax'),
            DF.namedNode('oa3'),
          )));
          store.addQuad(<Quad>DF.quad(DF.namedNode('s4'), DF.namedNode('px'), DF.quad(
            DF.namedNode('sb3'),
            DF.namedNode('pbx'),
            DF.namedNode('ob3'),
          )));
          store.end();

          const data = source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.variable('p'), DF.quad(
              DF.variable('s1'),
              DF.namedNode('pbx'),
              DF.variable('o1'),
            )),
            ctx,
          );
          await expect(data).toEqualBindingsStream([
            BF.fromRecord({
              s: DF.namedNode('s4'),
              p: DF.namedNode('px'),
              s1: DF.namedNode('sb3'),
              o1: DF.namedNode('ob3'),
            }).setContextEntry(KeysBindings.isAddition, true),
          ]);
          //
          // await expect(new Promise(resolve => data.getProperty('metadata', resolve))).resolves
          // .toEqual({
          //     cardinality: { type: 'estimate', value: 5 },
          //     canContainUndefs: false,
          //     state: expect.any(MetadataValidationState),
          //     variables: [ DF.variable('s'), DF.variable('p'), DF.variable('s1'), DF.variable('o1') ],
          // });
          //
        });
      });
    });
  });

  describe('queryQuads', () => {
    it('should throw', () => {
      expect(() => source.queryQuads(<any> undefined, ctx))
        .toThrow(`queryQuads is not implemented in StreamingQuerySourceRdfJs`);
    });
  });

  describe('queryBoolean', () => {
    it('should throw', () => {
      expect(() => source.queryBoolean(<any> undefined, ctx))
        .toThrow(`queryBoolean is not implemented in StreamingQuerySourceRdfJs`);
    });
  });

  describe('queryVoid', () => {
    it('should throw', () => {
      expect(() => source.queryVoid(<any> undefined, ctx))
        .toThrow(`queryVoid is not implemented in StreamingQuerySourceRdfJs`);
    });
  });

  describe('quadsToBindings', () => {
    it('destroys quadStream and calls the onClose function', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([], { autoStart: false });
      quadStream.setProperty('metadata', {
        cardinality: { type: 'exact', value: 1 },
        order: [
          { term: 'subject', direction: 'asc' },
          { term: 'predicate', direction: 'asc' },
          { term: 'object', direction: 'asc' },
          { term: 'graph', direction: 'asc' },
        ],
      });
      const pattern = AF.createPattern(
        DF.namedNode('s'),
        DF.variable('p'),
        DF.namedNode('o'),
      );

      const onCloseFn = jest.fn();
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, onCloseFn, () => {});

      bindingsStream.destroy();

      expect(quadStream.destroyed).toBe(true);
      expect(onCloseFn).toHaveBeenCalledTimes(1);
    });

    it('should call onStart when the stream is read', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([], { autoStart: false });
      quadStream.setProperty('metadata', {
        cardinality: { type: 'exact', value: 1 },
        order: [
          { term: 'subject', direction: 'asc' },
          { term: 'predicate', direction: 'asc' },
          { term: 'object', direction: 'asc' },
          { term: 'graph', direction: 'asc' },
        ],
      });
      const pattern = AF.createPattern(
        DF.namedNode('s'),
        DF.variable('p'),
        DF.namedNode('o'),
      );

      const onStartFn = jest.fn();
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, () => {}, onStartFn);

      bindingsStream.read();
      expect(onStartFn).toHaveBeenCalledTimes(1);
    });

    it('converts triples', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([
        quad('s1', 'p1', 'o1', undefined, true),
        quad('s2', 'p2', 'o2'),
        quad('s3', 'p3', 'o3'),
        quad('s1', 'p1', 'o1', undefined, false),
      ], { autoStart: false });
      quadStream.setProperty('metadata', {
        cardinality: { type: 'exact', value: 3 },
        order: [
          { term: 'subject', direction: 'asc' },
          { term: 'predicate', direction: 'asc' },
          { term: 'object', direction: 'asc' },
          { term: 'graph', direction: 'asc' },
        ],
      });
      const pattern = AF.createPattern(
        DF.namedNode('s'),
        DF.variable('p'),
        DF.namedNode('o'),
      );
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, () => {}, () => {});

      // Check results
      await expect(bindingsStream).toEqualBindingsStream([
        BF.fromRecord({
          p: DF.namedNode('p1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p2'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p3'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p1'),
        }).setContextEntry(KeysBindings.isAddition, false),
      ]);

      // Check metadata
      const metadata = await new Promise(resolve => bindingsStream.getProperty('metadata', resolve));
      expect(metadata).toEqual({
        cardinality: { type: 'exact', value: 3 },
        order: [
          { term: DF.variable('p'), direction: 'asc' },
        ],
        variables: [{
          canBeUndef: false,
          variable: DF.variable('p'),
        }],
      });
    });

    it('converts triples without order metadata', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
        quad('s3', 'p3', 'o3'),
      ], { autoStart: false });
      quadStream.setProperty('metadata', {
        cardinality: { type: 'exact', value: 3 },
      });
      const pattern = AF.createPattern(
        DF.namedNode('s'),
        DF.variable('p'),
        DF.namedNode('o'),
      );
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, () => {}, () => {});

      // Check results
      await expect(bindingsStream).toEqualBindingsStream([
        BF.fromRecord({
          p: DF.namedNode('p1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p2'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p3'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      // Check metadata
      const metadata = await new Promise(resolve => bindingsStream.getProperty('metadata', resolve));
      expect(metadata).toEqual({
        cardinality: { type: 'exact', value: 3 },
        variables: [{
          canBeUndef: false,
          variable: DF.variable('p'),
        }],
      });
    });

    it('converts triples with available orders metadata', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
        quad('s3', 'p3', 'o3'),
      ], { autoStart: false });
      quadStream.setProperty('metadata', {
        cardinality: { type: 'exact', value: 3 },
        availableOrders: [
          {
            cost: {
              cardinality: { type: 'exact', value: 123 },
              iterations: 1,
              persistedItems: 2,
              blockingItems: 3,
              requestTime: 4,
            },
            terms: [
              { term: 'subject', direction: 'asc' },
              { term: 'predicate', direction: 'asc' },
            ],
          },
          {
            cost: {
              cardinality: { type: 'exact', value: 456 },
              iterations: 1,
              persistedItems: 2,
              blockingItems: 3,
              requestTime: 4,
            },
            terms: [
              { term: 'object', direction: 'desc' },
              { term: 'graph', direction: 'desc' },
            ],
          },
        ],
      });
      const pattern = AF.createPattern(
        DF.namedNode('s'),
        DF.variable('p'),
        DF.namedNode('o'),
      );
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, () => {}, () => {});

      // Check results
      await expect(bindingsStream).toEqualBindingsStream([
        BF.fromRecord({
          p: DF.namedNode('p1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p2'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p3'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      // Check metadata
      const metadata = await new Promise(resolve => bindingsStream.getProperty('metadata', resolve));
      expect(metadata).toEqual({
        cardinality: { type: 'exact', value: 3 },
        variables: [{
          canBeUndef: false,
          variable: DF.variable('p'),
        }],
        availableOrders: [
          {
            cost: {
              blockingItems: 3,
              cardinality: {
                type: 'exact',
                value: 123,
              },
              iterations: 1,
              persistedItems: 2,
              requestTime: 4,
            },
            terms: [
              {
                direction: 'asc',
                term: {
                  termType: 'Variable',
                  value: 'p',
                },
              },
            ],
          },
          {
            cost: {
              blockingItems: 3,
              cardinality: {
                type: 'exact',
                value: 456,
              },
              iterations: 1,
              persistedItems: 2,
              requestTime: 4,
            },
            terms: [],
          },
        ],
      });
    });

    it('converts quads', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2', 'g1', true),
        quad('s3', 'p3', 'o3', 'g2'),
        quad('s2', 'p2', 'o2', 'g1', false),
      ], { autoStart: false });
      quadStream.setProperty('metadata', {
        cardinality: { type: 'exact', value: 3 },
        order: [
          { term: 'subject', direction: 'asc' },
          { term: 'predicate', direction: 'asc' },
          { term: 'object', direction: 'asc' },
          { term: 'graph', direction: 'asc' },
        ],
      });
      const pattern = AF.createPattern(
        DF.namedNode('s'),
        DF.variable('p'),
        DF.namedNode('o'),
        DF.variable('g'),
      );
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, () => {}, () => {});

      // Check results
      await expect(bindingsStream).toEqualBindingsStream([
        BF.fromRecord({
          p: DF.namedNode('p2'),
          g: DF.namedNode('g1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p3'),
          g: DF.namedNode('g2'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          p: DF.namedNode('p2'),
          g: DF.namedNode('g1'),
        }).setContextEntry(KeysBindings.isAddition, false),
      ]);

      // Check metadata
      const metadata = await new Promise(resolve => bindingsStream.getProperty('metadata', resolve));
      expect(metadata).toEqual({
        cardinality: { type: 'estimate', value: 3 },
        order: [
          { term: DF.variable('p'), direction: 'asc' },
          { term: DF.variable('g'), direction: 'asc' },
        ],
        variables: [{
          canBeUndef: false,
          variable: DF.variable('p'),
        }, {
          canBeUndef: false,
          variable: DF.variable('g'),
        }],
      });
    });

    it('converts quads with union default graph', async() => {
      const quadStream = new ArrayIterator([
        quad('s1', 'p', 'o1', 'g1'),
        quad('s2', 'p', 'o2'),
        quad('s3', 'px', 'o3'),
      ], { autoStart: false });
      quadStream.setProperty('metadata', {
        cardinality: { type: 'exact', value: 3 },
        order: [
          { term: 'subject', direction: 'asc' },
          { term: 'predicate', direction: 'asc' },
          { term: 'object', direction: 'asc' },
          { term: 'graph', direction: 'asc' },
        ],
      });
      const pattern = AF.createPattern(
        DF.variable('s'),
        DF.namedNode('p'),
        DF.variable('o'),
        DF.variable('g'),
      );
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, true, () => {}, () => {});

      await expect(bindingsStream).toEqualBindingsStream([
        BF.fromRecord({
          s: DF.namedNode('s1'),
          o: DF.namedNode('o1'),
          g: DF.namedNode('g1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          s: DF.namedNode('s2'),
          o: DF.namedNode('o2'),
          g: DF.defaultGraph(),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          s: DF.namedNode('s3'),
          o: DF.namedNode('o3'),
          g: DF.defaultGraph(),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      const metadata = await new Promise(resolve => bindingsStream.getProperty('metadata', resolve));
      expect(metadata).toEqual({
        cardinality: { type: 'exact', value: 3 },
        order: [
          { term: DF.variable('s'), direction: 'asc' },
          { term: DF.variable('o'), direction: 'asc' },
          { term: DF.variable('g'), direction: 'asc' },
        ],
        variables: [
          {
            canBeUndef: false,
            variable: DF.variable('s'),
          },
          {
            canBeUndef: false,
            variable: DF.variable('o'),
          },
          {
            canBeUndef: false,
            variable: DF.variable('g'),
          },
        ],
      });
    });

    it('converts triples with duplicate variables', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([
        quad('s1', 's1', 'o1'),
        quad('s2', 'p2', 'o2'),
        quad('s3', 's1', 'o3'),
      ], { autoStart: false });
      quadStream.setProperty('metadata', {
        state: new MetadataValidationState(),
        cardinality: { type: 'exact', value: 3 },
        order: [
          { term: 'subject', direction: 'asc' },
          { term: 'predicate', direction: 'asc' },
          { term: 'object', direction: 'asc' },
          { term: 'graph', direction: 'asc' },
        ],
      });
      const pattern = AF.createPattern(
        DF.variable('x'),
        DF.variable('x'),
        DF.namedNode('o'),
      );
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, () => {}, () => {});

      // Check results
      await expect(bindingsStream).toEqualBindingsStream([
        BF.fromRecord({
          x: DF.namedNode('s1'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      // Check metadata
      const metadata = await new Promise(resolve => bindingsStream.getProperty('metadata', resolve));
      expect(metadata).toEqual({
        state: expect.any(MetadataValidationState),
        cardinality: { type: 'estimate', value: 3 },
        order: [
          { term: DF.variable('x'), direction: 'asc' },
        ],
        variables: [{
          canBeUndef: false,
          variable: DF.variable('x'),
        }],
      });
    });

    it('converts quoted triples with duplicate variables', async() => {
      // Prepare data
      const quadStream = new ArrayIterator([
        quad('s1', 'p1', 's1'),
        quad('s2', 'p2', 's2'),
        quad('s3', 'p3', 's3'),
      ], { autoStart: false });
      quadStream.setProperty('metadata', {
        state: new MetadataValidationState(),
        cardinality: { type: 'exact', value: 3 },
      });
      const pattern = AF.createPattern(
        DF.variable('x'),
        DF.variable('p'),
        DF.variable('x'),
      );
      const bindingsStream = (<any>StreamingQuerySourceRdfJs)
        .quadsToBindings(quadStream, pattern, DF, BF, false, () => {}, () => {});

      // Check results
      await expect(bindingsStream).toEqualBindingsStream([
        BF.fromRecord({
          x: DF.namedNode('s1'),
          p: DF.namedNode('p1'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          x: DF.namedNode('s2'),
          p: DF.namedNode('p2'),
        }).setContextEntry(KeysBindings.isAddition, true),
        BF.fromRecord({
          x: DF.namedNode('s3'),
          p: DF.namedNode('p3'),
        }).setContextEntry(KeysBindings.isAddition, true),
      ]);

      // Check metadata
      const metadata = await new Promise(resolve => bindingsStream.getProperty('metadata', resolve));
      expect(metadata).toEqual({
        state: expect.any(MetadataValidationState),
        cardinality: { type: 'estimate', value: 3 },
        availableOrders: undefined,
        order: undefined,
        variables: [{
          canBeUndef: false,
          variable: DF.variable('x'),
        }, {
          canBeUndef: false,
          variable: DF.variable('p'),
        }],
      });
    });
  });
});
