import type {
  IActionRdfResolveHypermedia,
  IActorRdfResolveHypermediaOutput,
  IActorRdfResolveHypermediaArgs,
  IActorRdfResolveHypermediaTest,
} from '@comunica/bus-rdf-resolve-hypermedia';
import {
  ActorRdfResolveHypermedia,
} from '@comunica/bus-rdf-resolve-hypermedia';
import { RdfJsQuadStreamingSource } from '@incremunica/actor-rdf-resolve-quad-pattern-rdfjs-streaming-source';
import type { MediatorGuard } from '@incremunica/bus-guard';
import { StreamingStore } from '@incremunica/incremental-rdf-streaming-store';
import type { Quad } from '@incremunica/incremental-types';
import type * as RDF from '@rdfjs/types';

/**
 * A comunica Stream None RDF Resolve Hypermedia Actor.
 */
export class ActorRdfResolveHypermediaStreamNone extends ActorRdfResolveHypermedia {
  public readonly mediatorGuard: MediatorGuard;

  public constructor(args: IActorRdfResolveHypermediaStreamSourceArgs) {
    super(args, 'file');
  }

  public async testMetadata(action: IActionRdfResolveHypermedia): Promise<IActorRdfResolveHypermediaTest> {
    return { filterFactor: 0 };
  }

  public async run(action: IActionRdfResolveHypermedia): Promise<IActorRdfResolveHypermediaOutput> {
    this.logInfo(action.context, `Identified as file source: ${action.url}`);
    const store = new StreamingStore<Quad>();
    store.import(<RDF.Stream<Quad>><any>action.quads);
    const source = new RdfJsQuadStreamingSource(store);

    await this.mediatorGuard.mediate({
      context: action.context,
      url: action.url,
      metadata: action.metadata,
      streamingSource: source,
    });

    return { source };
  }
}

export interface IActorRdfResolveHypermediaStreamSourceArgs extends IActorRdfResolveHypermediaArgs {
  /**
   * The Guard mediator
   */
  mediatorGuard: MediatorGuard;
}
