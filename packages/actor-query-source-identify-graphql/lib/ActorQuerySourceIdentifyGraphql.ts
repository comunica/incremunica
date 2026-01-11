import type { MediatorHttp } from '@comunica/bus-http';
import type { MediatorMergeBindingsContext } from '@comunica/bus-merge-bindings-context';
import type {
  IActionQuerySourceIdentify,
  IActorQuerySourceIdentifyOutput,
  IActorQuerySourceIdentifyArgs,
} from '@comunica/bus-query-source-identify';
import { ActorQuerySourceIdentify } from '@comunica/bus-query-source-identify';
import { KeysInitQuery } from '@comunica/context-entries';
import type { TestResult, IActorTest } from '@comunica/core';
import { failTest, passTestVoid } from '@comunica/core';
import type { ComunicaDataFactory } from '@comunica/types';
import { BindingsFactory } from '@comunica/utils-bindings-factory';
import { QuerySourceGraphql } from './QuerySourceGraphql';
import { KeysGraphQLSource } from './SchemaKeys';

/**
 * An incremunica Graphql Query Source Identify Actor.
 */
export class ActorQuerySourceIdentifyGraphql extends ActorQuerySourceIdentify {
  public readonly mediatorMergeBindingsContext: MediatorMergeBindingsContext;
  public readonly mediatorHttp: MediatorHttp;

  public constructor(args: IActorQuerySourceIdentifyGraphqlArgs) {
    super(args);
  }

  public async test(action: IActionQuerySourceIdentify): Promise<TestResult<IActorTest>> {
    const source = action.querySourceUnidentified;

    if (source.type === undefined || source.type !== 'graphql') {
      return failTest(`${this.name} requires a single query source with graphql type to be present in the context.`);
    }
    const schema_source = action.querySourceUnidentified.context?.get(KeysGraphQLSource.schema);
    if (schema_source === undefined) {
      return failTest(`${this.name} requires a graphql schema to be present in the context.`);
    }
    const schema_context = action.querySourceUnidentified.context?.get(KeysGraphQLSource.context);
    if (schema_context === undefined) {
      return failTest(`${this.name} requires a graphql schema context to be present in the context.`);
    }

    return passTestVoid();
  }

  public async run(action: IActionQuerySourceIdentify): Promise<IActorQuerySourceIdentifyOutput> {
    const schema_source = action.querySourceUnidentified.context?.get(KeysGraphQLSource.schema);
    const schema_context = action.querySourceUnidentified.context?.get(KeysGraphQLSource.context);
    const dataFactory: ComunicaDataFactory = action.context.getSafe(KeysInitQuery.dataFactory);
    return {
      querySource: {
        source: new QuerySourceGraphql(
          <string> action.querySourceUnidentified.value,
          dataFactory,
          await BindingsFactory.create(this.mediatorMergeBindingsContext, action.context, dataFactory),
          this.mediatorHttp,
          schema_source!,
          schema_context!,
        ),
        context: action.querySourceUnidentified.context,
      },
    };
  }
}

export interface IActorQuerySourceIdentifyGraphqlArgs extends IActorQuerySourceIdentifyArgs {
  /**
   * A mediator for creating binding context merge handlers
   */
  mediatorMergeBindingsContext: MediatorMergeBindingsContext;
  mediatorHttp: MediatorHttp;
}
