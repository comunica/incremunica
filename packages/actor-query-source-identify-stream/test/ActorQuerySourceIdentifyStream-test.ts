import { QuerySourceHypermedia } from '@comunica/actor-query-source-identify-hypermedia';
import {
  LinkedRdfSourcesAsyncRdfIterator,
} from '@comunica/actor-query-source-identify-hypermedia/lib/LinkedRdfSourcesAsyncRdfIterator';
import { LinkQueueFifo } from '@comunica/actor-rdf-resolve-hypermedia-links-queue-fifo';
import type { MediatorContextPreprocess } from '@comunica/bus-context-preprocess';
import type {
  IActionDereferenceRdf,
  IActorDereferenceRdfOutput,
  MediatorDereferenceRdf,
} from '@comunica/bus-dereference-rdf';
import { ActorQuerySourceIdentify } from '@comunica/bus-query-source-identify';
import type {
  IActionQuerySourceIdentifyHypermedia,
  MediatorQuerySourceIdentifyHypermedia,
} from '@comunica/bus-query-source-identify-hypermedia';
import type {
  IActionRdfMetadataAccumulate,
  IActorRdfMetadataAccumulateOutput,
  MediatorRdfMetadataAccumulate,
} from '@comunica/bus-rdf-metadata-accumulate';
import { KeysInitQuery, KeysQueryOperation } from '@comunica/context-entries';
import { ActionContext, Bus } from '@comunica/core';
import type { Bindings, IActionContext, IQuerySource, MetadataBindings } from '@comunica/types';
import { MetadataValidationState } from '@comunica/utils-metadata';
import { StreamingQuerySourceRdfJs } from '@incremunica/actor-query-source-identify-streaming-rdfjs';
import { KeysBindings, KeysStreamingSource } from '@incremunica/context-entries';
import {
  createTestContextWithDataFactory,
  AF,
  DF,
  BF,
  partialArrayifyAsyncIterator,
  testBufferIterator,
} from '@incremunica/dev-tools';
import { StreamingStore } from '@incremunica/streaming-store';
import type { IQuerySourceStreamElement, Quad } from '@incremunica/types';
import { ArrayIterator, AsyncIterator, wrap } from 'asynciterator';
import { Store } from 'n3';
import { PassThrough } from 'readable-stream';
import { ActorQuerySourceIdentifyStream } from '../lib';
import 'jest-rdf';
import '@comunica/utils-jest';
import { StreamingQuerySourceStream } from '../lib/StreamingQuerySourceStream';

const quad = require('rdf-quad');
const streamifyArray = require('streamify-array');

// @ts-expect-error
const mediatorDereferenceRdf: MediatorDereferenceRdf = {
  async mediate({ url }: IActionDereferenceRdf): Promise<IActorDereferenceRdfOutput> {
    return {
      data: url === 'firstUrl' ?
        streamifyArray([
          quad('s1', 'p1', 'o1'),
          quad('s2', 'p2', 'o2'),
        ]) :
        streamifyArray([
          quad('s3', 'p3', 'o3'),
          quad('s4', 'p4', 'o4'),
        ]),
      metadata: { triples: true },
      exists: true,
      requestTime: 0,
      url,
    };
  },
};
// @ts-expect-error
const mediatorMetadata: MediatorRdfMetadata = {
  mediate: ({ quads }: any) => Promise.resolve({
    data: quads,
    metadata: <any> {
      state: new MetadataValidationState(),
      cardinality: { type: 'estimate', value: 4 },
    },
  }),
};
// @ts-expect-error
const mediatorMetadataExtract: MediatorRdfMetadataExtract = {
  mediate: ({ metadata }: any) => Promise.resolve({ metadata }),
};
// @ts-expect-error
const mediatorRdfMetadataAccumulate: MediatorRdfMetadataAccumulate = {
  async mediate(action: IActionRdfMetadataAccumulate): Promise<IActorRdfMetadataAccumulateOutput> {
    if (action.mode === 'initialize') {
      return {
        metadata: {
          cardinality: { type: 'exact', value: 0 },
        },
      };
    }

    const metadata = { ...action.accumulatedMetadata };
    if (metadata.cardinality) {
      metadata.cardinality = { ...metadata.cardinality };
    }
    const subMetadata = action.appendingMetadata;
    if (!subMetadata.cardinality) {
      // We're already at infinite, so ignore any later metadata
      metadata.cardinality = <any>{};
      metadata.cardinality.type = 'estimate';
      metadata.cardinality.value = Number.POSITIVE_INFINITY;
    }
    if (metadata.cardinality?.value !== undefined && subMetadata.cardinality?.value !== undefined) {
      metadata.cardinality.value += subMetadata.cardinality.value;
    }
    if (subMetadata.cardinality?.type === 'estimate') {
      metadata.cardinality.type = 'estimate';
    }

    return { metadata };
  },
};
// @ts-expect-error
const mediatorQuerySourceIdentifyHypermedia: MediatorQuerySourceIdentifyHypermedia = {
  async mediate({ quads }: IActionQuerySourceIdentifyHypermedia) {
    const store = new Store();
    store.import(quads);
    return {
      dataset: 'MYDATASET',
      source: <IQuerySource> <any> {
        async getSelectorShape() {
          return {
            type: 'operation',
            operation: {
              operationType: 'pattern',
              pattern: AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o'), DF.variable('g')),
            },
            variablesOptional: [
              DF.variable('s'),
              DF.variable('p'),
              DF.variable('o'),
              DF.variable('g'),
            ],
          };
        },
        queryBindings(_operation, context) {
          const unionStream = new PassThrough({ objectMode: true });
          // @ts-expect-error
          store.match().pipe(unionStream, { end: false });
          quads.on('error', () => {
            setImmediate(() => {
              it.close();
            });
          });
          const it = wrap(unionStream).transform({
            map: (q: Quad) => {
              let bindings = BF.fromRecord({
                s: q.subject,
                p: q.predicate,
                o: q.object,
                g: q.graph,
              });
              bindings = bindings.setContextEntry(KeysBindings.isAddition, q.isAddition);
              return bindings;
            },
            autoStart: false,
          });
          it.setProperty('metadata', {
            firstMeta: true,
            state: new MetadataValidationState(),
            variables: [
              { variable: DF.variable('s'), canBeUndef: false },
              { variable: DF.variable('p'), canBeUndef: false },
              { variable: DF.variable('o'), canBeUndef: false },
              { variable: DF.variable('g'), canBeUndef: false },
            ],
            cardinality: { type: 'estimate', value: 4 },
          });
          const matchOptions = context.get(KeysStreamingSource.matchOptions);
          matchOptions.push({
            deleteStream: () => {
              // @ts-expect-error
              store.match().pipe(new PassThrough({
                transform(
                  chunk: any,
                  _encoding: BufferEncoding,
                  callback: (error?: (Error | null), data?: any) => void,
                ) {
                  chunk.isAddition = false;
                  callback(null, chunk);
                },
                objectMode: true,
              })).pipe(unionStream, { end: true });
            },
          });
          return it;
        },
        queryQuads() {
          return wrap(store.match());
        },
        queryBoolean() {
          return true;
        },
        queryVoid() {
          // Do nothing
        },
      },
    };
  },
};
// @ts-expect-error
const mediatorRdfResolveHypermediaLinks: MediatorRdfResolveHypermediaLinks = {
  mediate: () => Promise.resolve({ links: [{ url: 'next' }]}),
};
// @ts-expect-error
const mediatorRdfResolveHypermediaLinksQueue: MediatorRdfResolveHypermediaLinksQueue = {
  mediate: () => Promise.resolve({ linkQueue: new LinkQueueFifo() }),
};
const mediators = {
  mediatorMetadata,
  mediatorMetadataExtract,
  mediatorMetadataAccumulate: mediatorRdfMetadataAccumulate,
  mediatorDereferenceRdf,
  mediatorQuerySourceIdentifyHypermedia,
  mediatorRdfResolveHypermediaLinks,
  mediatorRdfResolveHypermediaLinksQueue,
};

describe('ActorQuerySourceIdentifyStream', () => {
  let bus: any;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
  });

  describe('The ActorQuerySourceIdentifyStream module', () => {
    it('should be a function', () => {
      expect(ActorQuerySourceIdentifyStream).toBeInstanceOf(Function);
    });

    it('should be a ActorQuerySourceIdentifyStream constructor', () => {
      expect(new (<any> ActorQuerySourceIdentifyStream)({ name: 'actor', bus }))
        .toBeInstanceOf(ActorQuerySourceIdentifyStream);
      expect(new (<any> ActorQuerySourceIdentifyStream)({ name: 'actor', bus }))
        .toBeInstanceOf(ActorQuerySourceIdentify);
    });

    it('should not be able to create new ActorQuerySourceIdentifyStream objects without \'new\'', () => {
      expect(() => {
        (<any> ActorQuerySourceIdentifyStream)();
      }).toThrow(`Class constructor ActorQuerySourceIdentifyStream cannot be invoked without 'new'`);
    });
  });

  describe('An ActorQuerySourceIdentifyStream instance', () => {
    let actor: ActorQuerySourceIdentifyStream;
    let source: AsyncIterator<any>;
    let mediatorContextPreprocess: MediatorContextPreprocess;
    let context: IActionContext;
    let deleteCallback: () => void;

    beforeEach(() => {
      jest.spyOn(mediatorRdfMetadataAccumulate, 'mediate');
      deleteCallback = jest.fn();
      mediatorContextPreprocess = <MediatorContextPreprocess><any> {
        mediate: jest.fn((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: {
                queryBindings: () => {
                  const it = new AsyncIterator();
                  it.read = () => {
                    if (it.readable) {
                      it.readable = false;
                      return BF.bindings([
                        [ DF.variable('v'), DF.namedNode('a') ],
                      ]).setContextEntry(KeysBindings.isAddition, true);
                    }
                    return null;
                  };
                  it.readable = true;

                  it.setProperty<() => void>('delete', () => {
                    deleteCallback();
                    it.read = () => {
                      if (it.readable) {
                        it.readable = false;
                        return BF.bindings([
                          [ DF.variable('v'), DF.namedNode('a') ],
                        ]).setContextEntry(KeysBindings.isAddition, false);
                      }
                      it.close();
                      return null;
                    };
                    it.readable = true;
                  });

                  it.setProperty('metadata', {
                    state: new MetadataValidationState(),
                    cardinality: { type: 'exact', value: 1 },
                    variables: [
                      { variable: DF.variable('v'), canBeUndef: false },
                    ],
                  });

                  return it;
                },
              },
              context: new ActionContext(),
            }]),
          });
        }),
      };
      actor = new ActorQuerySourceIdentifyStream({
        name: 'actor',
        bus,
        mediatorRdfMetadataAccumulate,
        mediatorContextPreprocess,
      });
      source = new ArrayIterator<IQuerySourceStreamElement>([
        {
          isAddition: true,
          querySource: 'http://example.org/',
        },
      ]);
      context = createTestContextWithDataFactory();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('test', () => {
      it('should test', async() => {
        await expect(actor.test({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context: new ActionContext(),
        })).resolves.toBeTruthy();
      });

      it('should not test with sparql type', async() => {
        await expect(actor.test({
          querySourceUnidentified: { type: 'sparql', value: <any>source },
          context: new ActionContext(),
        })).resolves.toFailTest(`actor requires a single query source with stream type to be present in the context.`);
      });
    });

    describe('run', () => {
      it('should get the source', async() => {
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(result.querySource.context).not.toBe(context);
        expect(result.querySource.source.referenceValue).toBe('StreamingQuerySources');
        expect(result.querySource.source.toString()).toBe('StreamingHypermediaQuerySources');
        await expect(result.querySource.source.getSelectorShape(
          new ActionContext(),
        )).resolves.toEqual({
          type: 'operation',
          operation: {
            operationType: 'pattern',
            pattern: AF.createPattern(
              DF.variable('s'),
              DF.variable('p'),
              DF.variable('o'),
            ),
          },
          variablesOptional: [
            DF.variable('s'),
            DF.variable('p'),
            DF.variable('o'),
          ],
        });
        await expect(result.querySource.source.queryVoid(
          AF.createNop(),
          new ActionContext(),
        )).rejects.toThrow('queryVoid is not implemented in StreamingQuerySourceRdfJs');
        expect(() => {
          result.querySource.source.queryQuads(
            AF.createNop(),
            new ActionContext(),
          );
        }).toThrow('queryQuads is not implemented in StreamingQuerySourceRdfJs');
        await expect(result.querySource.source.queryBoolean(
          AF.createAsk(AF.createNop()),
          new ActionContext(),
        )).rejects.toThrow('queryBoolean is not implemented in StreamingQuerySourceRdfJs');
      });

      it('should fail if the sourcesEventEmitter fails', async() => {
        const source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
        ]);
        source.readable = true;
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any> source },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
          source.destroy(new Error('Test Error'));
        })).rejects.toThrow('Test Error');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Test Error');
      });

      it('should fail the context preprocessing fails (1)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation(async() => {
          throw new Error('Test Error');
        });
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any> new ArrayIterator([{
            isAddition: true,
            querySource: 'http://example.org/1',
          }]) },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Test Error');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Test Error');
      });

      it('should fail the context preprocessing fails (2)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, undefined),
          });
        });
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any> new ArrayIterator([{
            isAddition: true,
            querySource: 'http://example.org/1',
          }]) },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Expected a single query source in the context.');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Expected a single query source in the context.');
      });

      it('should fail the context preprocessing fails (3)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, []),
          });
        });
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any> new ArrayIterator([{
            isAddition: true,
            querySource: 'http://example.org/1',
          }]) },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Expected a single query source in the context');
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Expected a single query source in the context');
      });

      it('should work when calling query bindings twice', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[0].querySource ]) },
        );
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(1);
        const bindings2 = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings2, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(2);
      });

      it('should work with different versions of query sources', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: '<http://example.org/s> <http://example.org/p> <http://example.org/o>.',
          },
          {
            isAddition: true,
            querySource: {
              type: 'serialized',
              value: '<http://example.org/s> <http://example.org/p> <http://example.org/o>.',
            },
          },
          {
            isAddition: true,
            querySource: {
              value: 'http://example.org/',
            },
          },
          {
            isAddition: true,
            querySource: {
              value: 'http://example.org/',
              context: new ActionContext(),
            },
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 5)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[0].querySource ]) },
        );
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          2,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[1].querySource ]) },
        );
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(5);
      });

      it('should work with immediate deletions 1', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(deleteCallback).toHaveBeenCalledTimes(0);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[0].querySource ]) },
        );
      });

      it('should work with immediate deletions 2', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ];
        source = new ArrayIterator(sources);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(deleteCallback).toHaveBeenCalledTimes(0);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ sources[0].querySource ]) },
        );
      });

      it('should work with slow deletions', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ];
        source = new AsyncIterator();
        source.read = () => {
          if (sources.length === 0) {
            source.close();
            return null;
          }
          if (source.readable) {
            source.readable = false;
            return sources.shift();
          }
          source.readable = false;
          return null;
        };
        source.readable = true;
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(result.querySource.context).not.toBe(context);
        const bindings = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindings, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
        ]);
        expect(deleteCallback).toHaveBeenCalledTimes(1);
        expect(mediatorContextPreprocess.mediate).toHaveBeenNthCalledWith(
          1,
          { context: context.set(KeysInitQuery.querySourcesUnidentified, [ 'http://example.org/' ]) },
        );
      });

      it('should use sources that already identified', async() => {
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(result.querySource.context).not.toBe(context);
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 2)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 2)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, false),
        ]);
      });

      it('should not consider new sources after end', async() => {
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: true,
            querySource: 'http://example.org/1',
          },
        ]);
        source.readable = true;
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        expect(result.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(result.querySource.context).not.toBe(context);
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqualBindingsArray([
          BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        bindingsStream.destroy();
        source.readable = true;
      });

      it('should be able to add and delete hypermedia url\'s', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation(async(action) => {
          return {
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: new QuerySourceHypermedia(
                10,
                'firstUrl',
                'forcedType',
                64,
                true,
                { ...mediators },
                jest.fn(),
                DF,
                BF,
              ),
            }]),
          };
        });
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o'), DF.variable('g')),
          createTestContextWithDataFactory(),
        );
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 4)).resolves.toEqualBindingsArray([
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s1') ],
            [ DF.variable('p'), DF.namedNode('p1') ],
            [ DF.variable('o'), DF.namedNode('o1') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s2') ],
            [ DF.variable('p'), DF.namedNode('p2') ],
            [ DF.variable('o'), DF.namedNode('o2') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s3') ],
            [ DF.variable('p'), DF.namedNode('p3') ],
            [ DF.variable('o'), DF.namedNode('o3') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s4') ],
            [ DF.variable('p'), DF.namedNode('p4') ],
            [ DF.variable('o'), DF.namedNode('o4') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 4)).resolves.toEqualBindingsArray([
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s1') ],
            [ DF.variable('p'), DF.namedNode('p1') ],
            [ DF.variable('o'), DF.namedNode('o1') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s2') ],
            [ DF.variable('p'), DF.namedNode('p2') ],
            [ DF.variable('o'), DF.namedNode('o2') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s3') ],
            [ DF.variable('p'), DF.namedNode('p3') ],
            [ DF.variable('o'), DF.namedNode('o3') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s4') ],
            [ DF.variable('p'), DF.namedNode('p4') ],
            [ DF.variable('o'), DF.namedNode('o4') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
        ]);
      });

      it('should be able to add and delete hypermedia url\'s when it is wrapped around the skolemization', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation(async(action) => {
          return {
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: <any> {
                queryBindings: (op, cont, opt) => {
                  return new QuerySourceHypermedia(
                    10,
                    'firstUrl',
                    'forcedType',
                    64,
                    true,
                    { ...mediators },
                    jest.fn(),
                    DF,
                    BF,
                  ).queryBindings(op, cont, opt).map(bindings => bindings);
                },
              },
            }]),
          };
        });
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o'), DF.variable('g')),
          createTestContextWithDataFactory(),
        );
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 4)).resolves.toEqualBindingsArray([
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s1') ],
            [ DF.variable('p'), DF.namedNode('p1') ],
            [ DF.variable('o'), DF.namedNode('o1') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s2') ],
            [ DF.variable('p'), DF.namedNode('p2') ],
            [ DF.variable('o'), DF.namedNode('o2') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s3') ],
            [ DF.variable('p'), DF.namedNode('p3') ],
            [ DF.variable('o'), DF.namedNode('o3') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s4') ],
            [ DF.variable('p'), DF.namedNode('p4') ],
            [ DF.variable('o'), DF.namedNode('o4') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]),
        ]);
        source.readable = true;
        await expect(partialArrayifyAsyncIterator(bindingsStream, 4)).resolves.toEqualBindingsArray([
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s1') ],
            [ DF.variable('p'), DF.namedNode('p1') ],
            [ DF.variable('o'), DF.namedNode('o1') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s2') ],
            [ DF.variable('p'), DF.namedNode('p2') ],
            [ DF.variable('o'), DF.namedNode('o2') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s3') ],
            [ DF.variable('p'), DF.namedNode('p3') ],
            [ DF.variable('o'), DF.namedNode('o3') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('s'), DF.namedNode('s4') ],
            [ DF.variable('p'), DF.namedNode('p4') ],
            [ DF.variable('o'), DF.namedNode('o4') ],
            [ DF.variable('g'), DF.defaultGraph() ],
          ]).setContextEntry(KeysBindings.isAddition, false),
        ]);
      });

      it('should fail if matchOptions is undefined', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: <any>{
                queryBindings: (operation, currentContext, options) => {
                  const it = new ArrayIterator<Bindings>([
                    BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]),
                  ]);

                  it.setProperty('metadata', {
                    state: new MetadataValidationState(),
                    cardinality: { type: 'exact', value: 1 },
                    variables: [
                      { variable: DF.variable('v'), canBeUndef: false },
                    ],
                  });
                  (<any>it).started = true;

                  // We need to mock LinkedRdfSourcesAsyncRdfIterator, _destroy is overwritten due to it not destroying
                  Object.setPrototypeOf(it, LinkedRdfSourcesAsyncRdfIterator.prototype);
                  // @ts-expect-error
                  it._destroy = () => {};

                  return it;
                },
              },
              context: action.context,
            }]),
          });
        });
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        source.readable = true;
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((_resolve, reject) => {
          bindingsStream.on('data', () => {
            source.readable = true;
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('matchOptions are not set, this should not happen.');
        bindingsStream.destroy();
      });

      it('should fail if no delete function found (1)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: <any>{
                queryBindings: (operation, currentContext, options) => {
                  const it = new ArrayIterator<Bindings>([
                    BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]),
                  ]);

                  it.setProperty('metadata', {
                    state: new MetadataValidationState(),
                    cardinality: { type: 'exact', value: 1 },
                    variables: [
                      { variable: DF.variable('v'), canBeUndef: false },
                    ],
                  });

                  return it;
                },
              },
              context: action.context,
            }]),
          });
        });
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        source.readable = true;
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((_resolve, reject) => {
          bindingsStream.on('data', () => {
            source.readable = true;
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('No delete function found.');
        bindingsStream.destroy();
      });

      it('should fail if no delete function found (2)', async() => {
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation((action) => {
          return Promise.resolve({
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: <any>{
                queryBindings: (operation, currentContext, options) => {
                  const it = new ArrayIterator<Bindings>([
                    BF.bindings([[ DF.variable('v'), DF.namedNode('a') ]]),
                  ]);

                  it.setProperty('metadata', {
                    state: new MetadataValidationState(),
                    cardinality: { type: 'exact', value: 1 },
                    variables: [
                      { variable: DF.variable('v'), canBeUndef: false },
                    ],
                  });
                  (<any>it).started = true;

                  const matchOptions = currentContext.get(KeysStreamingSource.matchOptions);
                  matchOptions.push({
                    stopStream: () => {},
                  });

                  // We need to mock LinkedRdfSourcesAsyncRdfIterator, _destroy is overwritten due to it not destroying
                  Object.setPrototypeOf(it, LinkedRdfSourcesAsyncRdfIterator.prototype);
                  // @ts-expect-error
                  it._destroy = () => {};

                  return it;
                },
              },
              context: action.context,
            }]),
          });
        });
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        source.readable = true;
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        await expect(new Promise<void>((_resolve, reject) => {
          bindingsStream.on('data', () => {
            source.readable = true;
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('No delete function found.');
        bindingsStream.destroy();
      });

      it('should fail on non existing deletions', async() => {
        const sources = [
          {
            isAddition: true,
            querySource: 'http://example.org/1',
          },
          {
            isAddition: true,
            querySource: 'http://example.org/2',
          },
          {
            isAddition: false,
            querySource: 'http://example.org/a',
          },
        ];
        source = new AsyncIterator();
        source.read = () => {
          if (sources.length === 0) {
            source.close();
            return null;
          }
          return sources.shift();
        };
        source.readable = false;
        const result = (await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        })).querySource;
        const bindingsStream = result.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
          new ActionContext(),
        );
        source.readable = true;
        await expect(new Promise<void>((resolve, reject) => {
          bindingsStream.on('data', () => {
            resolve();
          });
          bindingsStream.on('end', () => {
            resolve();
          });
          bindingsStream.on('error', (e) => {
            reject(e);
          });
        })).rejects.toThrow('Deleted source: "http://example.org/a" has not been added. List of added sources:\n[\nhttp://example.org/1,\nhttp://example.org/2\n]');
        expect(bindingsStream.read()).toBeNull();
        expect(() => {
          result.source.queryBindings(
            AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.variable('o')),
            new ActionContext(),
          );
        }).toThrow('Deleted source: "http://example.org/a" has not been added. List of added sources:\n[\nhttp://example.org/1,\nhttp://example.org/2\n]');
      });

      it('should work with slow mediatorContextPreprocess', async() => {
        let resolveMediatorContextPreprocess: () => void = () => {
          throw new Error('No resolve function set');
        };
        jest.spyOn(mediatorContextPreprocess, 'mediate').mockImplementation(async(action) => {
          await new Promise<void>((resolve) => {
            resolveMediatorContextPreprocess = resolve;
          });
          return {
            context: action.context.set(KeysQueryOperation.querySources, [{
              source: new StreamingQuerySourceRdfJs(
                new StreamingStore(),
                DF,
                BF,
              ),
            }]),
          };
        });
        source = testBufferIterator([
          {
            isAddition: true,
            querySource: 'http://example.org/',
          },
          null,
          {
            isAddition: false,
            querySource: 'http://example.org/',
          },
        ]);
        source.readable = true;
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });

        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.namedNode('p'), DF.namedNode('o')),
          new ActionContext(),
        );
        resolveMediatorContextPreprocess();
        source.readable = true;
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(bindingsStream.read()).toBeNull();
      });

      it('should get the source with context', async() => {
        const contextSource = new ActionContext();
        const ret = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source, context: contextSource },
          context,
        });
        expect(ret.querySource.source).toBeInstanceOf(StreamingQuerySourceStream);
        expect(ret.querySource.context).not.toBe(context);
        expect(ret.querySource.context).toBe(contextSource);
      });

      it('should accumulate metadata', async() => {
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o'), DF.variable('g')),
          new ActionContext(),
        );
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 1,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
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
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqual([
          BF.bindings([
            [ DF.variable('v'), DF.namedNode('a') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 2,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
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

      it('should ignore errors when accumulating metadata', async() => {
        jest.spyOn(mediatorRdfMetadataAccumulate, 'mediate').mockRejectedValue(new Error('Test error'));
        const result = await actor.run({
          querySourceUnidentified: { type: 'stream', value: <any>source },
          context,
        });
        const bindingsStream = result.querySource.source.queryBindings(
          AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o'), DF.variable('g')),
          new ActionContext(),
        );
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 1,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
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
        await expect(partialArrayifyAsyncIterator(bindingsStream, 1)).resolves.toEqual([
          BF.bindings([
            [ DF.variable('v'), DF.namedNode('a') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        expect(bindingsStream.getProperty<MetadataBindings>('metadata')).toEqual({
          cardinality: {
            type: 'exact',
            value: 1,
          },
          state: expect.any(MetadataValidationState),
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('s'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('p'),
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
        expect(mediatorRdfMetadataAccumulate.mediate).toHaveBeenCalledTimes(1);
      });
    });
  });
});
