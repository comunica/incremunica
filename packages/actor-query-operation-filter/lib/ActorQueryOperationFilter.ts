import type { MediatorExpressionEvaluatorFactory } from '@comunica/bus-expression-evaluator-factory';
import type { MediatorHashBindings } from '@comunica/bus-hash-bindings';
import type { MediatorMergeBindingsContext } from '@comunica/bus-merge-bindings-context';
import type { IActorQueryOperationTypedMediatedArgs } from '@comunica/bus-query-operation';
import { ActorQueryOperationTypedMediated } from '@comunica/bus-query-operation';
import { KeysInitQuery } from '@comunica/context-entries';
import type { IActorTest, TestResult } from '@comunica/core';
import { passTestVoid } from '@comunica/core';
import type { IActionContext, IQueryOperationResult, BindingsStream, ComunicaDataFactory } from '@comunica/types';
import type { Bindings } from '@comunica/utils-bindings-factory';
import { BindingsFactory, bindingsToString } from '@comunica/utils-bindings-factory';
import { isExpressionError } from '@comunica/utils-expression-evaluator';
import { getSafeBindings, materializeOperation, validateQueryOutput } from '@comunica/utils-query-operation';
import { KeysBindings } from '@incremunica/context-entries';
import type { AsyncIterator } from 'asynciterator';
import { EmptyIterator, SingletonIterator, UnionIterator } from 'asynciterator';
import type { Algebra } from 'sparqlalgebrajs';
import { Factory } from 'sparqlalgebrajs';
import type { Expression } from 'sparqlalgebrajs/lib/algebra';
import { expressionTypes } from 'sparqlalgebrajs/lib/algebra';

/**
 * An Incremunica Filter Query Operation Actor.
 */
export class ActorQueryOperationFilter extends ActorQueryOperationTypedMediated<Algebra.Filter> {
  public readonly mediatorExpressionEvaluatorFactory: MediatorExpressionEvaluatorFactory;
  public readonly mediatorMergeBindingsContext: MediatorMergeBindingsContext;
  public readonly mediatorHashBindings: MediatorHashBindings;

  public constructor(args: IActorQueryOperationFilterArgs) {
    super(args, 'filter');
  }

  public async testOperation(): Promise<TestResult<IActorTest>> {
    return passTestVoid();
  }

  public async runOperation(operation: Algebra.Filter, context: IActionContext):
  Promise<IQueryOperationResult> {
    const outputRaw = await this.mediatorQueryOperation.mediate({ operation: operation.input, context });
    const output = getSafeBindings(outputRaw);
    validateQueryOutput(output, 'bindings');
    const variables = (await output.metadata()).variables.map(v => v.variable);

    const dataFactory: ComunicaDataFactory = context.getSafe(KeysInitQuery.dataFactory);
    const algebraFactory = new Factory(dataFactory);
    const bindingsFactory = await BindingsFactory.create(
      this.mediatorMergeBindingsContext,
      context,
      dataFactory,
    );

    if (operation.expression.expressionType === expressionTypes.EXISTENCE) {
      const transformMap = new Map<number, {
        count: number;
        iterator: AsyncIterator<Bindings>;
        currentState: boolean;
      }>();

      const { hashFunction } = await this.mediatorHashBindings.mediate({ context });

      const binder = async(
        bindings: Bindings,
        done: () => void,
        push: (i: AsyncIterator<Bindings>) => void,
      ): Promise<void> => {
        const hash = hashFunction(bindings, variables);
        let hashData = transformMap.get(hash);
        if (bindings.getContextEntry(KeysBindings.isAddition) ?? true) {
          if (hashData === undefined) {
            hashData = {
              count: 1,
              iterator: new EmptyIterator(),
              currentState: false,
            };
            transformMap.set(hash, hashData);

            const materializedOperation = materializeOperation(
              operation.expression,
              bindings,
              algebraFactory,
              bindingsFactory,
            );
            const intermediateOutputRaw = await this.mediatorQueryOperation.mediate({
              operation: materializedOperation,
              context,
            });
            const intermediateOutput = getSafeBindings(intermediateOutputRaw);

            let negBindings: Bindings;
            let posBindings: Bindings;

            if (operation.expression.not) {
              hashData.currentState = true;
              negBindings = bindingsFactory.fromBindings(bindings).setContextEntry(KeysBindings.isAddition, true);
              posBindings = bindingsFactory.fromBindings(bindings).setContextEntry(KeysBindings.isAddition, false);
            } else {
              negBindings = bindingsFactory.fromBindings(bindings).setContextEntry(KeysBindings.isAddition, false);
              posBindings = bindingsFactory.fromBindings(bindings).setContextEntry(KeysBindings.isAddition, true);
            }
            let count = 0;

            const constHashData = hashData;
            const transform = (
              item: Bindings,
              doneTransform: () => void,
              pushTransform: (val: Bindings) => void,
            ): void => {
              if (item.getContextEntry(KeysBindings.isAddition) ?? true) {
                if (count === 0) {
                  constHashData.currentState = !operation.expression.not;
                  for (let i = 0; i < constHashData.count; i++) {
                    pushTransform(posBindings);
                  }
                }
                count++;
              } else if (count > 1) {
                count--;
              } else if (count === 0) {
                doneTransform();
                return;
              } else {
                count = 0;
                constHashData.currentState = operation.expression.not;
                for (let i = 0; i < constHashData.count; i++) {
                  pushTransform(negBindings);
                }
              }
              doneTransform();
            };

            const it = (<AsyncIterator<Bindings>><any>intermediateOutput.bindingsStream).transform({
              transform,
              // TODO [2025-05-01]: only prepend when the iterator becomes unreadable/is up to date
              prepend: operation.expression.not ? [ bindings ] : undefined,
            });

            hashData.iterator = it;
            push(it);
          } else {
            hashData.count++;
            if (hashData.currentState) {
              push(new SingletonIterator(bindings));
            }
          }
        } else {
          if (hashData === undefined) {
            done();
            return;
          }
          if (hashData.currentState) {
            push(new SingletonIterator(bindings));
          }
          if (hashData.count === 1) {
            hashData.iterator.close();
            transformMap.delete(hash);
          }
          hashData.count--;
        }
        done();
      };

      const bindingsStream = <BindingsStream><any> new UnionIterator(
        (<AsyncIterator<Bindings>><any>output.bindingsStream).transform({
          // eslint-disable-next-line ts/no-misused-promises
          transform: binder,
        }),
        { autoStart: false },
      );
      return { type: 'bindings', bindingsStream, metadata: output.metadata };
    }

    const checkNestedExistence = (expression: Expression): void => {
      if (expression.expressionType === expressionTypes.EXISTENCE) {
        throw new Error('Nested existence filters are currently not supported.');
      }
      if (expression.args) {
        for (const arg of expression.args) {
          checkNestedExistence(arg);
        }
      }
    };
    checkNestedExistence(operation.expression);

    const evaluator = await this.mediatorExpressionEvaluatorFactory
      .mediate({ algExpr: operation.expression, context });

    const transform = async(item: Bindings, next: any, push: (bindings: Bindings) => void): Promise<void> => {
      try {
        const result = await evaluator.evaluateAsEBV(item);
        if (result) {
          push(item);
        }
      } catch (error: unknown) {
        // We ignore all Expression errors.
        // Other errors (likely programming mistakes) are still propagated.
        //
        // > Specifically, FILTERs eliminate any solutions that,
        // > when substituted into the expression, either result in
        // > an effective boolean value of false or produce an error.
        // > ...
        // > These errors have no effect outside of FILTER evaluation.
        // https://www.w3.org/TR/sparql11-query/#expressions
        if (isExpressionError(<Error> error)) {
          // In many cases, this is a user error, where the user should manually cast the variable to a string.
          // In order to help users debug this, we should report these errors via the logger as warnings.
          this.logWarn(context, 'Error occurred while filtering.', () => ({ error, bindings: bindingsToString(item) }));
        } else {
          bindingsStream.emit('error', error);
        }
      }
      next();
    };

    const bindingsStream = <BindingsStream><any>(<AsyncIterator<Bindings>><any>output.bindingsStream)
      // eslint-disable-next-line ts/no-misused-promises
      .transform<Bindings>({ transform, autoStart: false });
    return { type: 'bindings', bindingsStream, metadata: output.metadata };
  }
}

export interface IActorQueryOperationFilterArgs extends IActorQueryOperationTypedMediatedArgs {
  mediatorExpressionEvaluatorFactory: MediatorExpressionEvaluatorFactory;
  mediatorMergeBindingsContext: MediatorMergeBindingsContext;
  mediatorHashBindings: MediatorHashBindings;
}
