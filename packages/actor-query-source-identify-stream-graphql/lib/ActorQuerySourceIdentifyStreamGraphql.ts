import type { MediatorContextPreprocess } from '@comunica/bus-context-preprocess';
import type {
  IActionQuerySourceIdentify,
  IActorQuerySourceIdentifyOutput,
  IActorQuerySourceIdentifyArgs,
} from '@comunica/bus-query-source-identify';
import { ActorQuerySourceIdentify } from '@comunica/bus-query-source-identify';
import type { MediatorRdfMetadataAccumulate } from '@comunica/bus-rdf-metadata-accumulate';
import { KeysInitQuery } from '@comunica/context-entries';
import type { IActorTest, TestResult } from '@comunica/core';
import { failTest, passTestVoid, ActionContext } from '@comunica/core';
import type { ComunicaDataFactory } from '@comunica/types';
import type { QuerySourceStream, QuerySourceUnidentifiedExpanded } from '@incremunica/types';
import { StreamingQuerySourceStreamGraphql } from './StreamingQuerySourceStreamGraphql';

/**
 * An incremunica Stream Sources Query Source Identify Actor.
 */
export class ActorQuerySourceIdentifyStreamGraphql extends ActorQuerySourceIdentify {
  public readonly mediatorRdfMetadataAccumulate: MediatorRdfMetadataAccumulate;
  public readonly mediatorContextPreprocess: MediatorContextPreprocess;

  public constructor(args: IActorQuerySourceIdentifyStreamSourcesArgs) {
    super(args);
  }

  public async test(action: IActionQuerySourceIdentify): Promise<TestResult<IActorTest>> {
    const source = <QuerySourceUnidentifiedExpanded>action.querySourceUnidentified;
    if (source.type !== 'stream-graphql') {
      return failTest(`${this.name} requires a single query source with stream-graphql type to be present in the context.`);
    }
    return passTestVoid();
  }

  public async run(action: IActionQuerySourceIdentify): Promise<IActorQuerySourceIdentifyOutput> {
    const dataFactory: ComunicaDataFactory = action.context.getSafe(KeysInitQuery.dataFactory);
    return {
      querySource: {
        source: new StreamingQuerySourceStreamGraphql(
          <QuerySourceStream><any>action.querySourceUnidentified.value,
          dataFactory,
          this.mediatorRdfMetadataAccumulate,
          this.mediatorContextPreprocess,
          action.context,
        ),
        context: action.querySourceUnidentified.context ?? new ActionContext(),
      },
    };
  }
}

export interface IActorQuerySourceIdentifyStreamSourcesArgs extends IActorQuerySourceIdentifyArgs {
  /**
   * A mediator for accumulating metadata.
   */
  mediatorRdfMetadataAccumulate: MediatorRdfMetadataAccumulate;
  /**
   * A mediator for preprocessing the context.
   */
  mediatorContextPreprocess: MediatorContextPreprocess;
}
