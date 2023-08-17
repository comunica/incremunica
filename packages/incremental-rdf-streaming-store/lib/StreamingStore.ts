import { EventEmitter } from 'events';
import type { Quad } from '@comunica/incremental-types';
import type * as RDF from '@rdfjs/types';
import type { Term } from 'n3';
import { Store } from 'n3';
import type { Readable } from 'readable-stream';
import { PassThrough } from 'readable-stream';
import { PendingStreamsIndex } from './PendingStreamsIndex';

/**
 * A StreamingStore allows data lookup and insertion to happen in parallel.
 * Concretely, this means that `match()` calls happening before `import()` calls, will still consider those triples that
 * are inserted later, which is done by keeping the response streams of `match()` open.
 * Only when the `end()` method is invoked, all response streams will close, and the StreamingStore will be considered
 * immutable.
 *
 * WARNING: `end()` MUST be called at some point, otherwise all `match` streams will remain unended.
 */
export class StreamingStore<Q extends Quad>
  extends EventEmitter implements RDF.Source<Q>, RDF.Sink<RDF.Stream<Q>, EventEmitter> {
  protected readonly store: Store;
  protected readonly pendingStreams: PendingStreamsIndex<Q> = new PendingStreamsIndex();
  protected ended = false;
  protected numberOfListeners = 0;
  protected halted = false;
  protected haltBuffer = new Array<Q>();

  public constructor(store = new Store()) {
    super();
    this.store = store;
  }

  /**
   * Mark this store as ended.
   *
   * This will make sure that all running and future `match` calls will end,
   * and all next `import` calls to this store will throw an error.
   */
  public end(): void {
    // Console.log("end")
    this.ended = true;

    // Mark all pendingStreams as ended.
    for (const pendingStreams of this.pendingStreams.indexedStreams.values()) {
      for (const pendingStream of pendingStreams) {
        pendingStream.end();
      }
    }

    this.emit('end');
  }

  public hasEnded(): boolean {
    return this.ended;
  }

  public halt(): void {
    // Console.log("halted");
    this.halted = true;
  }

  public resume(): void {
    for (const quad of this.haltBuffer) {
      for (const pendingStream of this.pendingStreams.getPendingStreamsForQuad(quad)) {
        if (!this.ended) {
          pendingStream.push(quad);
        }
      }
      if (quad.diff) {
        this.store.add(quad);
      } else {
        this.store.delete(quad);
      }
    }
    this.halted = false;
  }

  public isHalted(): boolean {
    return this.halted;
  }

  public copyOfStore(): Store {
    const newStore = new Store();
    this.store.forEach(quad => {
      newStore.add(quad);
    }, null, null, null, null);
    return newStore;
  }

  public remove(stream: RDF.Stream<Q>): EventEmitter {
    if (this.ended) {
      throw new Error('Attempted to remove out of an ended StreamingStore');
    }

    stream.on('data', (quad: Q) => {
      if (quad.diff === undefined) {
        quad.diff = false;
      }
      if (this.halted) {
        this.haltBuffer.push(quad);
        return;
      }
      for (const pendingStream of this.pendingStreams.getPendingStreamsForQuad(quad)) {
        if (!this.ended) {
          pendingStream.push(quad);
        }
      }
      if (quad.diff) {
        this.store.add(quad);
      } else {
        this.store.delete(quad);
      }
    });
    return stream;
  }

  public import(stream: RDF.Stream<Q>): EventEmitter {
    if (this.ended) {
      throw new Error('Attempted to import into an ended StreamingStore');
    }

    stream.on('data', (quad: Q) => {
      // Console.log("on data");
      if (quad.diff === undefined) {
        quad.diff = true;
      }
      if (this.halted) {
        this.haltBuffer.push(quad);
        return;
      }
      for (const pendingStream of this.pendingStreams.getPendingStreamsForQuad(quad)) {
        if (!this.ended) {
          // Console.log("pushed into pending stream")
          pendingStream.push(quad);
        }
      }
      if (quad.diff) {
        this.store.add(quad);
      } else {
        this.store.removeQuad(quad);
      }
    });
    return stream;
  }

  public match(
    subject?: RDF.Term | null,
    predicate?: RDF.Term | null,
    object?: RDF.Term | null,
    graph?: RDF.Term | null,
    options?: { stopMatch: () => void },
  ): RDF.Stream<Q> {
    // Console.log("match")

    // TODO what if match is never called (=> streaming store should be removed) (Should not happen I think)
    this.numberOfListeners++;
    const unionStream = new PassThrough({ objectMode: true });

    const storeResult: Readable = <Readable> <any> this.store.match(
      <Term>subject,
      <Term>predicate,
      <Term>object,
      <Term>graph,
    );
    storeResult.pipe(unionStream, { end: false });

    // If the store hasn't ended yet, also create a new pendingStream
    if (!this.ended) {
      // The new pendingStream remains open, until the store is ended.
      const pendingStream = new PassThrough({ objectMode: true });
      if (options) {
        options.stopMatch = () => {
          // Console.log("stop");
          this.pendingStreams.removeClosedPatternListener(subject, predicate, object, graph);
          pendingStream.end();
        };
      }
      this.pendingStreams.addPatternListener(pendingStream, subject, predicate, object, graph);
      pendingStream.pipe(unionStream, { end: false });

      pendingStream.on('close', () => {
        // Console.log("passThrough ended:");
        if (storeResult.closed) {
          unionStream.end();
        }
      });

      storeResult.on('close', () => {
        // Console.log("storeResult ended");
        if (pendingStream.closed) {
          unionStream.end();
        }
      });
    } else {
      storeResult.on('close', () => {
        // Console.log("storeResult ended");
        unionStream.end();
      });
    }

    unionStream.on('close', () => {
      // Console.log("unionStream ended");
      if (this.numberOfListeners < 2) {
        this.end();
      } else {
        this.numberOfListeners--;
      }
    });

    return unionStream;
  }

  /**
   * The internal store with all imported quads.
   */
  public getStore(): Store {
    return this.store;
  }
}
