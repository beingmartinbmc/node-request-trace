declare namespace requestTrace {
  interface TraceStep {
    name: string;
    start: number;
    duration: number;
    type?: string;
    error?: string;
  }

  interface Trace {
    requestId: string;
    method: string;
    path: string;
    route?: string;
    startTime: number;
    duration: number;
    status: number;
    steps: TraceStep[];
    _slow?: boolean;
  }

  interface RequestContext {
    requestId: string;
    method: string;
    path: string;
    route: string;
    status: number;
    duration: number;
    startTime: number;
  }

  interface TraceConfig {
    slowThreshold?: number;
    samplingRate?: number;
    maxTraces?: number;
    retentionSeconds?: number;
    autoTrack?: boolean;
    traceOutgoing?: boolean;
    logBody?: boolean;
    sensitiveHeaders?: string[] | null;
  }

  interface TimelineReport {
    steps: TraceStep[];
    summary: Record<string, unknown>;
  }

  interface LoggerIntegration {
    onTrace(trace: Trace): void;
  }

  interface RequestTracer {
    init(options?: TraceConfig): this;
    middleware(framework?: 'express' | 'koa'): (...args: any[]) => any;
    fastifyPlugin(): (...args: any[]) => any;
    koaMiddleware(): (...args: any[]) => any;
    instrumentKoa(app: any): any;
    routes(): (...args: any[]) => any;
    current(): Trace | null;
    getCurrentTrace(): Trace | null;
    getCurrentRequestContext(): RequestContext | null;
    step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
    useLogger(type: 'pino' | 'winston' | 'console', loggerInstance?: any): this;
    useLogger(integration: LoggerIntegration): this;
    enableHttpTracing(): this;
    disableHttpTracing(): this;
    isHttpTracingEnabled(): boolean;
    exportChromeTrace(trace: Trace): unknown[];
    exportChromeTraceJson(trace: Trace): string;
    timeline(trace?: Trace | null): TimelineReport;
    renderTimeline(trace?: Trace | null, options?: { width?: number }): string;
    sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined>;
    destroy(): void;
  }

  interface RequestTracerConstructor {
    new(): RequestTracer;
  }
}

declare const requestTrace: requestTrace.RequestTracer & {
  RequestTracer: requestTrace.RequestTracerConstructor;
};

export = requestTrace;
