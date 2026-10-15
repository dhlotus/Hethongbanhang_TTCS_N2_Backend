export function PartialType<T>(classRef: new (...args: any[]) => T): new (...args: any[]) => Partial<T> {
  return classRef as any;
}

export function PickType<T>(classRef: new (...args: any[]) => T): new (...args: any[]) => any {
  return classRef as any;
}

export function OmitType<T>(classRef: new (...args: any[]) => T): new (...args: any[]) => any {
  return classRef as any;
}

export function IntersectionType<A, B>(
  classA: new (...args: any[]) => A,
  classB: new (...args: any[]) => B,
): new (...args: any[]) => A & B {
  return classA as any;
}
