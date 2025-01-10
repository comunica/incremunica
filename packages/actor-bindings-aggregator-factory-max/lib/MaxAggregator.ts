import type { ITermComparator } from '@comunica/bus-term-comparator-factory';
import type { IExpressionEvaluator } from '@comunica/types';
import type { IBindingsAggregator } from '@incremunica/bus-bindings-aggregator-factory';
import { AggregateEvaluator } from '@incremunica/bus-bindings-aggregator-factory';
import type * as RDF from '@rdfjs/types';
import AVLTree from 'avl';
import type { Term } from 'n3';
import { termToString } from 'rdf-string';

export class MaxAggregator extends AggregateEvaluator implements IBindingsAggregator {
  private state: AVLTree<RDF.Term, RDF.Term> | undefined = undefined;
  public constructor(
    evaluator: IExpressionEvaluator,
    distinct: boolean,
    private readonly orderByEvaluator: ITermComparator,
    throwError?: boolean,
  ) {
    super(evaluator, distinct, throwError);
  }

  public putTerm(term: RDF.Term): void {
    if (term.termType !== 'Literal') {
      throw new Error(`Term with value ${term.value} has type ${term.termType} and is not a literal`);
    }
    if (this.state === undefined) {
      this.state = new AVLTree<RDF.Term, RDF.Term>((a, b) => this.orderByEvaluator.orderTypes(a, b), this.distinct);
    }
    this.state.insert(term, term);
  }

  protected removeTerm(term: Term): void {
    if (this.state === undefined) {
      throw new Error(`Cannot remove term ${termToString(term)} from empty max aggregator`);
    }
    this.state.remove(term);
  }

  public termResult(): RDF.Term | undefined {
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
