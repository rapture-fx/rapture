export interface EndpointOptions {
  url?: string;
  timeoutMs?: string;
}

export declare function loadEndpoint(input?: EndpointOptions): string;
