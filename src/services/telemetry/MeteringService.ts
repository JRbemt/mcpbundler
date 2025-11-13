/**
 * MeteringService - Collects and batches metering events for backend ingestion
 *
 * This service buffers metering events and periodically flushes them to the
 * backend API for storage and aggregation. Events are batched to reduce
 * network overhead and improve performance.
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../../utils/logger.js';

/**
 * Metering event types matching backend schema
 */
export type MeteringEventType =
    | 'tool_call'
    | 'resource_read'
    | 'prompt_get'
    | 'session_created'
    | 'data_transferred';

/**
 * Metering event structure
 */
export interface MeteringEvent {
    event_type: MeteringEventType;
    timestamp: string;
    user_id: string;
    collection_id: string;
    session_id: string;

    // Event specifics
    upstream_namespace?: string;
    tool_name?: string;
    mcp_item_id?: string;

    // Metrics
    bytes_transferred?: number;
    token_cost?: number;  // Pre-calculated cost
    duration_ms?: number;
}

/**
 * Configuration options for MeteringService
 */
export interface MeteringServiceConfig {
    /** Backend API base URL */
    backendUrl: string;
    /** Service token for authentication */
    serviceToken: string;
    /** Flush interval in milliseconds */
    flushIntervalMs?: number;
    /** Batch size (flush when this many events are buffered) */
    batchSize?: number;
    /** Enable/disable the service */
    enabled?: boolean;
}

/**
 * MeteringService - Buffers and flushes metering events to backend
 */
export class MeteringService {
    private buffer: MeteringEvent[] = [];
    private flushInterval: NodeJS.Timeout | null = null;
    private httpClient: AxiosInstance;
    private config: Required<MeteringServiceConfig>;
    private isShuttingDown = false;

    constructor(config: MeteringServiceConfig) {
        // Set defaults
        this.config = {
            flushIntervalMs: 10000,
            batchSize: 100,
            enabled: true,
            ...config
        } as Required<MeteringServiceConfig>;

        // Create axios instance with service token
        this.httpClient = axios.create({
            baseURL: this.config.backendUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'X-Service-Token': this.config.serviceToken,
            },
        });

        // Start periodic flush
        if (this.config.enabled) {
            this.flushInterval = setInterval(() => {
                this.flush().catch(err => {
                    logger.error({ error: err }, 'Error in periodic flush');
                });
            }, this.config.flushIntervalMs);

            logger.info({
                flushIntervalMs: this.config.flushIntervalMs,
                batchSize: this.config.batchSize,
            }, 'MeteringService initialized');
        } else {
            logger.info('MeteringService disabled');
        }
    }

    /**
     * Record a metering event
     * Events are buffered and flushed periodically or when batch size is reached
     */
    recordEvent(event: MeteringEvent): void {
        if (!this.config.enabled || this.isShuttingDown) {
            return;
        }

        this.buffer.push(event);

        logger.debug({
            event_type: event.event_type,
            buffer_size: this.buffer.length,
        }, 'Metering event recorded');

        // Auto-flush if batch size reached
        if (this.buffer.length >= this.config.batchSize) {
            logger.debug('Batch size reached, flushing events');
            this.flush().catch(err => {
                logger.error({ error: err }, 'Error in auto-flush');
            });
        }
    }

    /**
     * Flush buffered events to backend
     * Called periodically or when batch size is reached
     */
    private async flush(): Promise<void> {
        if (this.buffer.length === 0) {
            return;
        }

        // Take current buffer and reset
        const events = [...this.buffer];
        this.buffer = [];

        try {
            logger.debug({
                event_count: events.length,
            }, 'Flushing metering events to backend');

            await this.httpClient.post('/api/v1/metering/events', {
                events,
            });

            logger.info({
                event_count: events.length,
            }, 'Successfully flushed metering events');

        } catch (error: any) {
            logger.error({
                error: error.message,
                event_count: events.length,
                status: error.response?.status,
                response: error.response?.data,
            }, 'Failed to flush metering events');

            // Re-queue events on failure (with limit to prevent unbounded growth)
            if (this.buffer.length < this.config.batchSize * 5) {
                this.buffer.push(...events);
                logger.warn({
                    requeued_count: events.length,
                    new_buffer_size: this.buffer.length,
                }, 'Re-queued failed events');
            } else {
                logger.error({
                    dropped_count: events.length,
                }, 'Buffer full, dropping metering events');
            }
        }
    }

    /**
     * Shutdown the service and flush remaining events
     * Should be called during application shutdown
     */
    async shutdown(): Promise<void> {
        logger.info('Shutting down MeteringService');
        this.isShuttingDown = true;

        // Clear interval
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        // Flush remaining events
        try {
            await this.flush();
            logger.info('MeteringService shutdown complete');
        } catch (error) {
            logger.error({ error }, 'Error during MeteringService shutdown');
        }
    }

    /**
     * Get current buffer size (for monitoring/debugging)
     */
    getBufferSize(): number {
        return this.buffer.length;
    }
}
