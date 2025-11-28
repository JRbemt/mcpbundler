import EventEmitter from "events";
import logger from "../../utils/logger.js";

/**
 * Monitors session activity and detects idle timeouts.
 * Emits "idle_timeout" event when session exceeds idle threshold.
 */
export class SessionActivityMonitor extends EventEmitter {
    private lastActivity: number;
    private readonly idleTimeoutMs: number;
    private readonly checkIntervalMs: number;
    private checkInterval: NodeJS.Timeout | null;
    private readonly sessionId: string;

    constructor(
        sessionId: string,
        idleTimeoutMs: number = 30 * 60 * 1000,
        checkIntervalMs: number = 60 * 1000
    ) {
        super();
        this.sessionId = sessionId;
        this.lastActivity = Date.now();
        this.idleTimeoutMs = idleTimeoutMs;
        this.checkIntervalMs = checkIntervalMs;
        this.checkInterval = null;
    }

    /**
     * Update last activity timestamp.
     */
    public touch(): void {
        this.lastActivity = Date.now();
    }

    /**
     * Get time in milliseconds since last activity.
     */
    public getTimeSinceLastActivity(): number {
        return Date.now() - this.lastActivity;
    }

    /**
     * Start monitoring for idle timeout.
     * Checks periodically and emits "idle_timeout" event when threshold is exceeded.
     */
    public startMonitoring(): void {
        if (this.checkInterval) {
            logger.warn({ sessionId: this.sessionId }, "Activity monitoring already started");
            return;
        }

        this.checkInterval = setInterval(() => {
            const idleTime = this.getTimeSinceLastActivity();

            if (idleTime > this.idleTimeoutMs) {
                logger.warn({
                    sessionId: this.sessionId,
                    idleTimeMs: idleTime,
                    threshold: this.idleTimeoutMs
                }, "Session idle timeout detected");

                this.emit("idle_timeout", {
                    sessionId: this.sessionId,
                    idleTimeMs: idleTime
                });
            }
        }, this.checkIntervalMs);

        logger.debug({ sessionId: this.sessionId }, "Idle monitoring started");
    }

    /**
     * Stop monitoring for idle timeout.
     */
    public stopMonitoring(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            logger.debug({ sessionId: this.sessionId }, "Idle monitoring stopped");
        }
    }

    /**
     * Check if monitoring is currently active.
     */
    public isMonitoring(): boolean {
        return this.checkInterval !== null;
    }
}
