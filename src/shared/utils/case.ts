/**
 * Recursively converts a snake_case string to camelCase at the type level.
 * Multi-segment keys are handled by recursion: `a_b_c` → `aBc`.
 */
export type Camelize<T extends string> = T extends `${infer A}_${infer B}`
    ? `${A}${Camelize<Capitalize<B>>}`
    : T;

/**
 * Produces a new object type whose keys are the camelCase equivalents of the
 * snake_case keys in T. Nested objects are recursed into.
 */
export type CamelizeKeys<T extends object> = {
    [K in keyof T as K extends string ? Camelize<K> : K]: T[K] extends object
    ? CamelizeKeys<T[K]>
    : T[K];
};

/**
 * Converts all top-level keys of an object from snake_case to camelCase at
 * runtime. The return type uses CamelizeKeys<T> so TypeScript infers the
 * correct camelCase key names without any manual mapping.
 *
 * Only top-level keys are converted - nested objects are not recursed into,
 * keeping behaviour predictable at call sites.
 */
export function camelizeKeys<T extends object>(obj: T): CamelizeKeys<T> {
    return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [
            k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
            v,
        ])
    ) as CamelizeKeys<T>;
}
