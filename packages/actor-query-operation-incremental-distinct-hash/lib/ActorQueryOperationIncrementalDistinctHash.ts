import type { Bindings } from '@comunica/utils-bindings-factory';
import type { IActorQueryOperationTypedMediatedArgs } from '@comunica/bus-query-operation';
import {
  ActorQueryOperationTypedMediated,
} from '@comunica/bus-query-operation';
import {IActorTest, passTestVoid, TestResult} from '@comunica/core';
import type {
  IActionContext,
  IQueryOperationResult,
  IQueryOperationResultBindings,
  BindingsStream,
} from '@comunica/types';
import { ActionContextKeyIsAddition } from '@incremunica/actor-merge-bindings-context-is-addition';
import type { AsyncIterator } from 'asynciterator';
import type { Algebra } from 'sparqlalgebrajs';
import { getSafeBindings } from '@comunica/utils-query-operation';
import {MediatorHashBindings} from "@comunica/bus-hash-bindings";

/**
 * An Incremunica Distinct Hash Query Operation Actor.
 */
export class ActorQueryOperationIncrementalDistinctHash extends ActorQueryOperationTypedMediated<Algebra.Distinct> {
  public readonly mediatorHashBindings: MediatorHashBindings;

  public constructor(args: IActorQueryOperationIncrementalDistinctHashArgs) {
    super(args, 'distinct');
  }

  public async testOperation(_operation: Algebra.Distinct, _context: IActionContext): Promise<TestResult<IActorTest>> {
    return passTestVoid();
  }

  public async runOperation(operation: Algebra.Distinct, context: IActionContext): Promise<IQueryOperationResult> {
    const output: IQueryOperationResultBindings = getSafeBindings(
      await this.mediatorQueryOperation.mediate({ operation: operation.input, context }),
    );
    const { hashFunction } = await this.mediatorHashBindings.mediate({ context });
    const bindingsStream = <BindingsStream><unknown>(<AsyncIterator<Bindings>><unknown>output.bindingsStream).filter(
      this.newHashFilter(entry => hashFunction(entry, [...entry.keys()])),
    );
    return {
      type: 'bindings',
      bindingsStream,
      metadata: output.metadata,
    };
  }

  /**
   * Create a new distinct filter function.
   * This will maintain an internal hash datastructure so that every bindings object only returns true once.
   * @return {(bindings: Bindings) => boolean} A distinct filter for bindings.
   */
  public newHashFilter(hashBindings: (bindings: Bindings) => number): (bindings: Bindings) => boolean {
    // Base comunica uses an object here but as we hash deletions incremunica uses a Map
    const hashes: Map<number, number> = new Map<number, number>();
    return (bindings: Bindings) => {
      const hash = hashBindings(bindings);
      const hasMapValue = hashes.get(hash);
      if (bindings.getContextEntry(new ActionContextKeyIsAddition())) {
        if (hasMapValue) {
          hashes.set(hash, hasMapValue + 1);
          return false;
        }
        hashes.set(hash, 1);
        return true;
      }
      if (!hasMapValue) {
        return false;
      }
      if (hasMapValue === 1) {
        hashes.delete(hash);
        return true;
      }
      hashes.set(hash, hasMapValue - 1);
      return false;
    };
  }
}

export interface IActorQueryOperationIncrementalDistinctHashArgs extends IActorQueryOperationTypedMediatedArgs {
  mediatorHashBindings: MediatorHashBindings;
}
