import type { ITermComparator } from '@comunica/bus-term-comparator-factory';
import type { IExpressionEvaluator } from '@comunica/types';
import type { IBindingsAggregator } from '@incremunica/bus-bindings-aggregator-factory';
import { AggregateEvaluator } from '@incremunica/bus-bindings-aggregator-factory';
import type * as RDF from '@rdfjs/types';
import AVLTree from 'avl';
import type { Term } from 'n3';
import { termToString } from 'rdf-string';

// TODO [2025-06-01]: Make a tree implementation that has constant time complexity for max and min
//  and has a remove function for a node (not only a key)
//  or maybe don't use a tree
export class MaxAggregator extends AggregateEvaluator implements IBindingsAggregator {
  private state: AVLTree<RDF.Term, undefined> | undefined = undefined;
  public constructor(
    evaluator: IExpressionEvaluator,
    distinct: boolean,
    private readonly orderByEvaluator: ITermComparator,
    throwError?: boolean,
  ) {
    super(evaluator, distinct, throwError);
  }

  protected putTerm(term: RDF.Term): void {
    if (term.termType !== 'Literal') {
      throw new Error(`Term with value ${term.value} has type ${term.termType} and is not a literal`);
    }
    if (this.state === undefined) {
      this.state = new AVLTree<RDF.Term, undefined>((a, b) => this.orderByEvaluator.orderTypes(a, b));
    }
    this.state.insert(term);
  }

  protected removeTerm(term: Term): void {
    if (this.state === undefined) {
      throw new Error(`Cannot remove term ${termToString(term)} from empty max aggregator`);
    }
    if (!this.state.remove(term)) {
      throw new Error(`Cannot remove term ${termToString(term)} that was not added to max aggregator`);
    }
  }

  protected termResult(): RDF.Term | undefined {
    if (this.state === undefined) {
      return this.emptyValue();
    }
    const returnVal = this.state.max();
    if (returnVal === null) {
      return this.emptyValue();
    }
    return returnVal;
  }
}
