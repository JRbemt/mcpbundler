/**
 * Generic Repository Port for aggregates with a domain-specific identifier.
 *
 * This interface defines the persistence contract for an aggregate root.
 * It is intended to live in the domain layer and must not depend on any
 * infrastructure concerns (ORMs, databases, transport protocols).
 *
 * The repository enforces the presence of a single identifier field on the
 * aggregate, while allowing the *name* and *type* of that identifier to vary
 * per domain model (e.g. `id`, `sessionId`, `deviceId`).
 *
 * Type parameters:
 * - T:
 *   The aggregate type. Must contain exactly one identifier field defined by `IdKey`.
 *
 * - IdKey:
 *   The property name on `T` that represents the aggregate identifier.
 *   This allows repositories to remain domain-specific without enforcing
 *   a generic `id` naming convention.
 *
 * - IdType:
 *   The type of the identifier value (e.g. string, UUID value object).
 *   Defaults to the type of `T[IdKey]`.
 *
 */

/**
 * Utility type that enforces the presence of a domain-specific identifier
 * on an aggregate.
 *
 * Example:
 *   type Session = Entity<"sessionId", SessionId> & { ... }
 */
type Entity<IdKey extends PropertyKey = "id", IdType = string> = {
    [K in IdKey]: IdType;
};

export interface Repository<
    T extends Entity<IdKey, IdType>,
    IdKey extends keyof T,
    IdType = T[IdKey]
> {

    /**
     * Persist a new aggregate instance.
     *
     * Implementations are responsible for enforcing uniqueness
     * of the identifier.
     */
    create(item: Omit<T, IdKey>): Promise<{ record: T, [x: string]: unknown; }>;

    /**
     * Update an existing aggregate.
     *
     * The identifier field is required to locate the aggregate.
     * All other fields are optional and may be partially updated.
     */
    update(item: Partial<T> & Pick<T, IdKey>): Promise<T>;

    /**
     * Remove an aggregate by its identifier.
     */
    delete(id: IdType): Promise<void>;

    /**
     * Retrieve an aggregate by its identifier.
     *
     * Returns `null` if the aggregate does not exist.
     */
    findById(id: IdType): Promise<T | null>;

    /**
     * Check whether an aggregate with the given identifier exists.
     */
    exists(id: IdType): Promise<boolean>;

    /**
     * Find an aggregate by an arbitrary field/value pair.
     *
     * Returns `null` if no matching aggregate is found.
     */
    findFirst(field: keyof T, value: unknown): Promise<T | null>;
}
