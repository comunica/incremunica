class DoubleNode<T> {
  public value: T;
  public next: DoubleNode<T> | undefined;
  public prev: DoubleNode<T> | undefined;
  public constructor(value: T) {
    this.value = value;
  }
}

/**
 * A doubly linked list implementation.
 */
export class DoublyLinkedList<T> {
  private _head: DoubleNode<T> | undefined;
  private _tail: DoubleNode<T> | undefined;
  private _length: number;

  public constructor() {
    this.clear();
  }

  /**
   * Clears the list.
   */
  public clear(): void {
    this._head = undefined;
    this._tail = undefined;
    this._length = 0;
  }

  /**
   * Adds a value to the end of the list.
   * @param value The value to push.
   * @returns True if the value was added successfully.
   */
  public push(value: T): boolean {
    const newNode = new DoubleNode(value);
    if (this._head) {
      newNode.prev = this._tail;
      this._tail!.next = newNode;
      this._tail = newNode;
    } else {
      this._head = newNode;
      this._tail = newNode;
    }
    this._length++;
    return true;
  }

  /**
   * Removes a value from the end of the list.
   * @returns The removed value or undefined if the list is empty.
   */
  public pop(): T | undefined {
    if (!this._tail) {
      return undefined;
    }
    const removedNode = this._tail;
    if (this._head === this._tail) {
      this._head = undefined;
      this._tail = undefined;
    } else {
      this._tail = removedNode.prev;
      this._tail!.next = undefined;
    }
    this._length--;
    return removedNode.value;
  }

  /**
   * Removes a value from the start of the list.
   * @returns The removed value or undefined if the list is empty.
   */
  public shift(): T | undefined {
    if (!this._head) {
      return undefined;
    }
    const removedNode = this._head;
    if (this._head === this._tail) {
      this._head = undefined;
      this._tail = undefined;
    } else {
      this._head = removedNode.next;
      this._head!.prev = undefined;
    }
    this._length--;
    return removedNode.value;
  }

  /**
   * Adds a value to the start of the list.
   * @param value The value to unshift.
   * @returns True if the value was added successfully.
   */
  public unshift(value: T): boolean {
    const newNode = new DoubleNode(value);
    if (this._head) {
      newNode.next = this._head;
      this._head.prev = newNode;
      this._head = newNode;
    } else {
      this._head = newNode;
      this._tail = newNode;
    }
    this._length++;
    return true;
  }

  /**
   * Adds a value at a specific index.
   * @param index The index to add the value at.
   * @param value The value to add.
   * @returns True if the value was added successfully.
   */
  public addAt(index: number, value: T): boolean {
    if (index < 0 || index > this._length) {
      return false;
    }
    if (index === 0) {
      this.unshift(value);
      return true;
    }
    if (index === this._length) {
      this.push(value);
      return true;
    }

    const newNode = new DoubleNode(value);
    const prevNode = this.getNodeAt(index - 1);
    const nextNode = prevNode!.next;
    newNode.prev = prevNode;
    newNode.next = nextNode;
    prevNode!.next = newNode;
    nextNode!.prev = newNode;
    this._length++;
    return true;
  }

  /**
   * Deletes a value at a specific index.
   * @param index The index to delete the value at.
   * @returns The deleted value or undefined if the index is out of bounds.
   */
  public deleteAt(index: number): T | undefined {
    if (index < 0 || index >= this._length) {
      return;
    }
    if (index === 0) {
      return this.shift();
    }
    if (index === this._length - 1) {
      return this.pop();
    }

    const removedNode = this.getNodeAt(index);
    const prevNode = removedNode!.prev;
    const nextNode = removedNode!.next;
    prevNode!.next = nextNode;
    nextNode!.prev = prevNode;
    this._length--;
    return removedNode?.value;
  }

  /**
   * Returns the length of the list.
   * @returns The length of the list.
   */
  public get length(): number {
    return this._length;
  }

  /**
   * Returns the node at a specific index.
   * @param index The index to get the node at.
   * @returns The node at the specified index or undefined if the index is out of bounds.
   */
  public getNodeAt(index: number): DoubleNode<T> | undefined {
    if (index < 0 || index >= this._length) {
      return undefined;
    }
    let current = this._head;
    for (let i = 0; i < index; i++) {
      current = current!.next;
    }
    return current;
  }
}
