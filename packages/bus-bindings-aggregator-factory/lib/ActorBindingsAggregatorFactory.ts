import type {
  MediatorExpressionEvaluatorFactory,
} from '@comunica/bus-expression-evaluator-factory';
import type { IAction, IActorArgs, IActorOutput, IActorTest, Mediate } from '@comunica/core';
import { Actor } from '@comunica/core';
import type { Bindings } from '@comunica/utils-bindings-factory';
import type * as RDF from '@rdfjs/types';
import type { Algebra } from 'sparqlalgebrajs';

/**
 * A comunica actor for creating Binding-Aggregator-factories.
 *
 * Actor types:
 * * Input:  IActionBindingsAggregatorFactory:      A SPARQL expression and a factory for an expression evaluator.
 * * Test:   <none>
 * * Output: IActorBindingsAggregatorFactoryOutput: An aggregator of RDF bindings.
 *
 * @see IActionBindingsAggregatorFactory
 * @see IActorBindingsAggregatorFactoryOutput
 */
export abstract class ActorBindingsAggregatorFactory<TS = undefined> extends Actor<
IActionBindingsAggregatorFactory,
IActorTest,
IActorBindingsAggregatorFactoryOutput,
TS
> {
  protected readonly mediatorExpressionEvaluatorFactory: MediatorExpressionEvaluatorFactory;
  /* eslint-disable max-len */
  /**
   * @param args -
   *  \ @defaultNested {<default_bus> a <cc:components/Bus.jsonld#Bus>} bus
   *  \ @defaultNested {Creation of Aggregator failed: none of the configured actors were able to handle ${action.expr.aggregator}} busFailMessage
   */
  protected constructor(args: IActorBindingsAggregatorFactoryArgs<TS>) {
    super(args);
    this.mediatorExpressionEvaluatorFactory = args.mediatorExpressionEvaluatorFactory;
  }
}

export interface IActionBindingsAggregatorFactory extends IAction {
  expr: Algebra.AggregateExpression;
}

/**
 * Instances of this interface perform a specific aggregation of bindings.
 * You can put bindings and when all bindings have been put, request the result.
 */
export interface IBindingsAggregator {
  /**
   * Registers bindings to the aggregator. Each binding you put has the ability to change the aggregation result.
   * @param bindings the bindings to put.
   */
  putBindings: (bindings: Bindings) => Promise<void>;

  /**
   * Request the result term of aggregating the bindings you have put in the aggregator.
   * It returns:
   *  - a term if a new result.
   *  - undefined if no new result.
   *  - null if the aggregator is in an error state.
   */
  result: () => RDF.Term | undefined | null;
}

export interface IActorBindingsAggregatorFactoryOutput extends IActorOutput, IBindingsAggregator {}

export interface IActorBindingsAggregatorFactoryArgs<TS = undefined> extends IActorArgs<
IActionBindingsAggregatorFactory,
IActorTest,
IActorBindingsAggregatorFactoryOutput,
TS
> {
  mediatorExpressionEvaluatorFactory: MediatorExpressionEvaluatorFactory;
}

export type MediatorBindingsAggregatorFactory = Mediate<
IActionBindingsAggregatorFactory,
IActorBindingsAggregatorFactoryOutput
>;
