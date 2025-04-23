import type { IActorQueryOperationTypedMediatedArgs } from '@comunica/bus-query-operation';
import {
  ActorQueryOperationTypedMediated,
} from '@comunica/bus-query-operation';
import { KeysQueryOperation } from '@comunica/context-entries';
import type { IActorTest, TestResult } from '@comunica/core';
import { failTest, passTestVoid } from '@comunica/core';
import type {
  IQueryOperationResult,
  IQueryOperationResultBindings,
  IQueryOperationResultStream,
  IMetadata,
  IActionContext,
  BindingsStream,
} from '@comunica/types';
import type { Bindings } from '@comunica/utils-bindings-factory';
import { getSafeBindings } from '@comunica/utils-query-operation';
import { KeysBindings } from '@incremunica/context-entries';
import { DoublyLinkedList } from '@incremunica/data-structures';
import type { AsyncIterator } from 'asynciterator';
import type { Algebra } from 'sparqlalgebrajs';

/**
 * An Incremunica Slice Query Operation Actor.
 */
export class ActorQueryOperationSliceOrdered extends ActorQueryOperationTypedMediated<Algebra.Slice> {
  public constructor(args: IActorQueryOperationTypedMediatedArgs) {
    super(args, 'slice');
  }

  public async testOperation(operation: Algebra.Slice, _context: IActionContext): Promise<TestResult<IActorTest>> {
    if (operation.input === undefined) {
      return failTest('This actor can only handle slices after an order operation.');
    }
    if (operation.input.type === 'orderby') {
      return passTestVoid();
    }
    if (operation.input.input === undefined) {
      return failTest('This actor can only handle slices after an order operation.');
    }
    if (operation.input.type === 'project' && operation.input.input.type === 'orderby') {
      return passTestVoid();
    }
    return failTest('This actor can only handle slices after an order operation.');
  }

  public async runOperation(operation: Algebra.Slice, context: IActionContext): Promise<IQueryOperationResult> {
    // Add limit indicator to the context, which can be used for query planning
    // eslint-disable-next-line unicorn/explicit-length-check
    if (operation.length) {
      context = context.set(KeysQueryOperation.limitIndicator, operation.length);
    }

    // Resolve the input
    const output = getSafeBindings(await this.mediatorQueryOperation
      .mediate({ operation: operation.input, context }));

    // eslint-disable-next-line unicorn/explicit-length-check
    const hasLength: boolean = Boolean(operation.length) || operation.length === 0;
    const { start } = operation;
    const length = hasLength ? operation.length! : Number.POSITIVE_INFINITY;

    const view = new DoublyLinkedList<Bindings>();
    const bindingsStream = (<AsyncIterator<Bindings>><any>output.bindingsStream).transform({
      transform: (bindings: Bindings, done: () => void, push: (i: Bindings) => void): void => {
        const order = bindings.getContextEntry(KeysBindings.order);
        if (order === undefined) {
          bindingsStream.destroy(new Error(`Missing order context on bindings: ${bindings.toString()}`));
          done();
          return;
        }
        if (bindings.getContextEntry(KeysBindings.isAddition) ?? true) {
          view.addAt(order.index, bindings);
          if (order.index < start && view.length > start) {
            if (view.length > start + length) {
              push(view.getNodeAt(start + length)!.value.setContextEntry(KeysBindings.isAddition, false));
            }
            push(view.getNodeAt(start)!.value);
          }
          if (order.index >= start && order.index < start + length) {
            if (view.length > start + length) {
              push(view.getNodeAt(start + length)!.value.setContextEntry(KeysBindings.isAddition, false));
            }
            push(bindings);
          }
        } else {
          view.deleteAt(order.index);
          if (order.index < start && view.length >= start) {
            push(view.getNodeAt(start - 1)!.value.setContextEntry(KeysBindings.isAddition, false));
            if (view.length >= start + length) {
              push(view.getNodeAt(start + length - 1)!.value);
            }
          }
          if (order.index >= start && order.index < start + length) {
            push(bindings);
            if (view.length >= start + length) {
              push(view.getNodeAt(start + length - 1)!.value);
            }
          }
        }
        done();
      },
      autoStart: false,
    });

    return <IQueryOperationResultBindings> {
      type: 'bindings',
      bindingsStream: <BindingsStream><any>bindingsStream,
      metadata: this.sliceMetadata(output, operation),
    };
  }

  // If we find metadata, apply slicing on the total number of items
  private sliceMetadata(
    output: IQueryOperationResultStream<any, any>,
    pattern: Algebra.Slice,
  ): () => Promise<IMetadata<any>> {
    // eslint-disable-next-line unicorn/explicit-length-check
    const hasLength: boolean = Boolean(pattern.length) || pattern.length === 0;
    return () => (<() => Promise<IMetadata<any>>>output.metadata)()
      .then((subMetadata) => {
        const cardinality = { ...subMetadata.cardinality };
        if (Number.isFinite(cardinality.value)) {
          cardinality.value = Math.max(0, cardinality.value - pattern.start);
          if (hasLength) {
            cardinality.value = Math.min(cardinality.value, pattern.length!);
          }
        }
        return { ...subMetadata, cardinality };
      });
  }
}
