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
    autoInstrument?: boolean | { only?: string[] };
    logBody?: boolean;
    sensitiveHeaders?: string[] | null;
  }

  interface TimelineReport {
    steps: TraceStep[];
    summary: Record<string, unknown>;
  }

  interface RepetitionEntry {
    pattern: string;
    sample: string;
    type: string | null;
    count: number;
    totalDuration: number;
    maxDuration: number;
    avgDuration: number;
    errorCount: number;
    isNPlusOne: boolean;
  }

  interface RepetitionAnalysis {
    duplicates: RepetitionEntry[];
    nPlusOne: RepetitionEntry[];
    hasNPlusOne: boolean;
    duplicateCount: number;
    wastedDuration: number;
  }

  interface DiffStep {
    name: string;
    status: 'added' | 'removed' | 'slower' | 'faster' | 'unchanged';
    durationA: number;
    durationB: number;
    deltaMs: number;
    deltaPercent: number | null;
    countA: number;
    countB: number;
  }

  interface TraceDiff {
    a: Record<string, unknown>;
    b: Record<string, unknown>;
    totalDeltaMs: number;
    totalDeltaPercent: number | null;
    regressed: boolean;
    added: DiffStep[];
    removed: DiffStep[];
    slower: DiffStep[];
    faster: DiffStep[];
    steps: DiffStep[];
  }

  interface DiffOptions {
    regressionPercent?: number;
  }

  interface ExplainPrompt {
    system: string;
    user: string;
    report: TimelineReport;
  }

  interface ExplainOptions {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
  }

  interface MarkdownOptions {
    slowThreshold?: number;
  }

  interface SpeedscopeProfile {
    $schema: string;
    name: string;
    activeProfileIndex: number;
    exporter: string;
    shared: { frames: Array<{ name: string }> };
    profiles: unknown[];
  }

  interface AutoInstrumentOptions {
    only?: string[];
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
    exportSpeedscope(trace?: Trace | null): SpeedscopeProfile;
    exportSpeedscopeJson(trace?: Trace | null): string;
    toShareableHtml(trace?: Trace | null): string;
    toMarkdown(trace?: Trace | null, options?: MarkdownOptions): string;
    diff(traceA: Trace, traceB: Trace, options?: DiffOptions): TraceDiff;
    diffToMarkdown(traceA: Trace, traceB: Trace, options?: DiffOptions): string;
    analyze(trace?: Trace | null): RepetitionAnalysis;
    buildExplainPrompt(trace?: Trace | null): ExplainPrompt;
    explain(trace?: Trace | null, options?: ExplainOptions): Promise<string>;
    enableAutoInstrumentation(options?: AutoInstrumentOptions): string[];
    disableAutoInstrumentation(): this;
    instrumentKnex(knexInstance: any): any;
    instrumentPrisma(prismaClient: any): any;
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
