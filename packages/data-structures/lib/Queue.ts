class Node<T> {
  public value: T;
  public next: Node<T> | undefined;
  public constructor(value: T) {
    this.value = value;
  }
}

/**
 * A simple queue implementation.
 */
export class Queue<T> {
  private _head: Node<T> | undefined;
  private _tail: Node<T> | undefined;
  private _length: number;

  /**
   * Creates a new queue.
   * @param initialValues Optional initial values to add to the queue.
   */
  public constructor(initialValues?: T[]) {
    this.clear();
    if (initialValues) {
      for (const value of initialValues) {
        this.push(value);
      }
    }
  }

  /**
   * Adds a value to the end of the queue.
   * @param value The value to push.
   */
  public push(value: T): void {
    const node = new Node(value);

    if (this._head) {
      this._tail!.next = node;
      this._tail = node;
    } else {
      this._head = node;
      this._tail = node;
    }

    this._length++;
  }

  /**
   * Removes a value from the start of the queue.
   * @returns The removed value or undefined if the queue is empty.
   */
  public shift(): T | undefined {
    const current = this._head;

    if (!current) {
      return;
    }

    this._head = this._head!.next;
    this._length--;

    return current.value;
  }

  /**
   * Returns the value at the start of the queue without removing it.
   * @returns The value at the start of the queue or undefined if the queue is empty.
   */
  public peek(): T | undefined {
    if (!this._head) {
      return;
    }

    return this._head.value;
  }

  /**
   * Clears the queue.
   */
  public clear(): void {
    this._head = undefined;
    this._tail = undefined;
    this._length = 0;
  }

  /**
   * Returns the length of the queue.
   * @returns The length of the queue.
   */
  public get length(): number {
    return this._length;
  }

  /**
   * Returns an iterator for the queue, without removing elements.
   */
  public* [Symbol.iterator](): Generator<T> {
    let current = this._head;

    while (current) {
      yield current.value;
      current = current.next;
    }
  }

  /**
   * Drains the queue, returning all values and emptying the queue.
   */
  public* drain(): Generator<T> {
    while (this._head) {
      yield this.shift()!;
    }
  }
}
