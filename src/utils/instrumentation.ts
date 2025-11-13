/*instrumentation.ts*/
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: undefined }),
    // metricReader: new PeriodicExportingMetricReader({
    //     exporter: new ConsoleMetricExporter(),
    // }),
    instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
