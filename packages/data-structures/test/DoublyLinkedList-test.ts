import { DoublyLinkedList } from '../lib';

describe('DoublyLinkedList', () => {
  let list: DoublyLinkedList<number>;

  beforeEach(() => {
    list = new DoublyLinkedList();
  });

  it('should be empty initially', () => {
    expect(list).toHaveLength(0);
    expect(list.getNodeAt(0)).toBeUndefined();
  });

  it('should push elements correctly', () => {
    list.push(1);
    list.push(2);
    list.push(3);

    expect(list).toHaveLength(3);
    expect(list.getNodeAt(0)?.value).toBe(1);
    expect(list.getNodeAt(2)?.value).toBe(3);
  });

  it('should pop elements correctly', () => {
    list.push(1);
    list.push(2);
    list.push(3);

    expect(list.pop()).toBe(3);
    expect(list).toHaveLength(2);
    expect(list.getNodeAt(1)?.value).toBe(2);
    expect(list.pop()).toBe(2);
    expect(list.pop()).toBe(1);
    expect(list.pop()).toBeUndefined();
  });

  it('should shift elements correctly', () => {
    list.push(1);
    list.push(2);
    list.push(3);

    expect(list.shift()).toBe(1);
    expect(list).toHaveLength(2);
    expect(list.getNodeAt(0)?.value).toBe(2);
  });

  it('should unshift elements correctly', () => {
    list.push(1);
    list.push(2);
    list.push(3);

    list.unshift(0);
    expect(list).toHaveLength(4);
    expect(list.getNodeAt(0)?.value).toBe(0);
  });

  it('should add at a specific index correctly', () => {
    list.push(1);
    list.push(2);

    list.addAt(1, 3);

    expect(list).toHaveLength(3);
    expect(list.getNodeAt(1)?.value).toBe(3);
  });

  it('should delete at a specific index correctly', () => {
    list.push(1);
    list.push(2);
    list.push(3);

    expect(list.deleteAt(1)).toBe(2);
    expect(list).toHaveLength(2);
  });

  it('should delete at start correctly', () => {
    list.push(1);
    list.push(2);
    list.push(3);

    expect(list.deleteAt(0)).toBe(1);
    expect(list).toHaveLength(2);
  });

  it('should delete at end correctly', () => {
    list.push(1);
    list.push(2);
    list.push(3);

    expect(list.deleteAt(2)).toBe(3);
    expect(list).toHaveLength(2);
  });

  it('should handle adding elements at the beginning and end correctly', () => {
    list.unshift(0);
    list.push(4);

    expect(list.getNodeAt(0)?.value).toBe(0);
    expect(list.getNodeAt(1)?.value).toBe(4);
    expect(list).toHaveLength(2);
  });

  it('should handle adding elements to an empty list', () => {
    list.addAt(0, 1);
    expect(list).toHaveLength(1);
    expect(list.getNodeAt(0)?.value).toBe(1);
  });

  it('should handle adding elements at too large index', () => {
    expect(list.addAt(20, 1)).toBe(false);
    expect(list).toHaveLength(0);
    expect(list.getNodeAt(0)?.value).toBeUndefined();
  });

  it('should handle adding elements at too small index', () => {
    expect(list.addAt(-20, 1)).toBe(false);
    expect(list).toHaveLength(0);
    expect(list.getNodeAt(0)?.value).toBeUndefined();
  });

  it('should handle deleting elements at too large index', () => {
    expect(list.deleteAt(20)).toBeUndefined();
    expect(list).toHaveLength(0);
    expect(list.getNodeAt(0)?.value).toBeUndefined();
  });

  it('should handle deleting elements at too small index', () => {
    expect(list.deleteAt(-20)).toBeUndefined();
    expect(list).toHaveLength(0);
    expect(list.getNodeAt(0)?.value).toBeUndefined();
  });

  it('should return the correct element when getting a node by index', () => {
    list.push(1);
    list.push(2);
    list.push(3);
    expect(list.getNodeAt(1)?.value).toBe(2);
  });

  it('should handle popping from an empty list', () => {
    expect(list.pop()).toBeUndefined();
    expect(list).toHaveLength(0);
  });

  it('should handle shifting from an empty list', () => {
    expect(list.shift()).toBeUndefined();
    expect(list).toHaveLength(0);
  });

  it('should handle unshifting into an empty list', () => {
    list.unshift(1);
    expect(list).toHaveLength(1);
    expect(list.getNodeAt(0)?.value).toBe(1);
  });

  it('should handle adding duplicate elements correctly', () => {
    list.addAt(0, 1);
    list.addAt(1, 1); // Add a duplicate at index 1
    expect(list).toHaveLength(2);
    expect(list.getNodeAt(1)?.value).toBe(1);
  });

  it('should handle deleting the first element correctly', () => {
    list.addAt(0, 1);
    expect(list.shift()).toBe(1);
    expect(list).toHaveLength(0);
  });

  it('should handle deleting the last element correctly', () => {
    list.addAt(0, 1);
    list.addAt(1, 2);
    expect(list.pop()).toBe(2);
    expect(list).toHaveLength(1);
    expect(list.getNodeAt(0)?.value).toBe(1);
  });

  it('should handle deleting from an empty list', () => {
    expect(list.pop()).toBeUndefined(); // Return undefined for empty list
    expect(list.shift()).toBeUndefined(); // Return undefined for empty list
  });
});
