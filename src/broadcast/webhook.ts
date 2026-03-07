/**
 * Webhook broadcasting with retry logic
 */

import { OpenClawEvent, WebhookConfig, RetryConfig } from '../events/types';

let axiosImport: Promise<typeof import('axios')> | null = null;

function getAxios() {
  axiosImport ??= import('axios');
  return axiosImport;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getResponseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

/**
 * Result of a webhook delivery attempt
 */
export interface DeliveryResult {
  success: boolean;
  webhookUrl: string;
  attempts: number;
  error?: string;
  responseStatus?: number;
  durationMs: number;
}

/**
 * Send event to a single webhook with retry logic
 * @param event - The event to send
 * @param webhook - Webhook configuration
 * @param retryConfig - Retry configuration
 * @param timeoutMs - Request timeout in milliseconds
 * @param correlationIdHeader - Header name for correlation ID
 * @returns Delivery result with success status and metadata
 */
export async function sendToWebhook(
  event: OpenClawEvent,
  webhook: WebhookConfig,
  retryConfig: RetryConfig,
  timeoutMs: number,
  correlationIdHeader: string,
): Promise<DeliveryResult> {
  const startTime = Date.now();
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let attempts = 0;
  let delayMs = retryConfig.initialDelayMs;
  const webhookUrl = webhook.url?.trim() ?? '';

  // Validate webhook URL
  if (webhookUrl === '') {
    return {
      success: false,
      webhookUrl,
      attempts: 0,
      error: 'Invalid webhook URL',
      durationMs: Date.now() - startTime,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        success: false,
        webhookUrl,
        attempts: 0,
        error: 'Only HTTP and HTTPS webhook URLs are supported',
        durationMs: Date.now() - startTime,
      };
    }
  } catch {
    return {
      success: false,
      webhookUrl,
      attempts: 0,
      error: 'Invalid webhook URL format',
      durationMs: Date.now() - startTime,
    };
  }

  const axios = (await getAxios()).default;

  while (attempts < retryConfig.maxAttempts) {
    attempts++;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'OpenClaw-Event-Plugin/1.0.0',
        ...webhook.headers,
      };

      // Add correlation ID header
      if (event.correlationId) {
        headers[correlationIdHeader] = event.correlationId;
      }

      // Add auth header if token provided
      if (webhook.authToken) {
        headers['Authorization'] = `Bearer ${webhook.authToken}`;
      }

      const response = await axios({
        method: webhook.method ?? 'POST',
        url: parsedUrl.toString(),
        data: webhook.includeFullPayload !== false ? event : { type: event.type, timestamp: event.timestamp },
        headers,
        timeout: timeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      return {
        success: true,
        webhookUrl: webhook.url,
        attempts,
        responseStatus: response.status,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = getErrorMessage(error);
      lastStatus = getResponseStatus(error);

      // Don't retry on client errors (4xx) except 429 (rate limit)
      if (
        lastStatus !== undefined &&
        lastStatus >= 400 &&
        lastStatus < 500 &&
        lastStatus !== 429
      ) {
        break;
      }

      // Wait before retry (exponential backoff)
      if (attempts < retryConfig.maxAttempts) {
        await sleep(delayMs);
        delayMs = Math.min(delayMs * retryConfig.backoffMultiplier, retryConfig.maxDelayMs);
      }
    }
  }

  return {
    success: false,
    webhookUrl,
    attempts,
    error: lastError,
    responseStatus: lastStatus,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Send event to multiple webhooks in parallel
 */
export async function broadcastToWebhooks(
  event: OpenClawEvent,
  webhooks: WebhookConfig[],
  retryConfig: RetryConfig,
  timeoutMs: number,
  correlationIdHeader: string,
): Promise<DeliveryResult[]> {
  if (webhooks.length === 0) {
    return [];
  }

  const results = await Promise.all(
    webhooks.map((webhook) =>
      sendToWebhook(event, webhook, retryConfig, timeoutMs, correlationIdHeader),
    ),
  );

  return results;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
