/**
 * SSRF Protection Utilities
 *
 * Prevents Server-Side Request Forgery attacks by validating
 * upstream URLs against private IP ranges and localhost.
 */

/**
 * Private IP ranges (RFC 1918, RFC 4193, etc.)
 */
const PRIVATE_IP_PATTERNS = [
  // IPv4 private ranges
  /^10\./,                                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,           // 172.16.0.0/12
  /^192\.168\./,                              // 192.168.0.0/16

  // Localhost
  /^127\./,                                   // 127.0.0.0/8
  /^localhost$/i,

  // Link-local
  /^169\.254\./,                              // 169.254.0.0/16

  // IPv6 private ranges
  /^::1$/,                                    // IPv6 localhost
  /^fe80:/i,                                  // IPv6 link-local
  /^fc00:/i,                                  // IPv6 unique local
  /^fd00:/i,                                  // IPv6 unique local

  // Broadcast
  /^255\.255\.255\.255$/,

  // Reserved
  /^0\.0\.0\.0$/,

  // Metadata services (cloud providers)
  /^169\.254\.169\.254$/,                     // AWS/Azure/GCP metadata
];

/**
 * Disallowed URL schemes
 */
const DISALLOWED_SCHEMES = [
  "file",
  "ftp",
  "gopher",
  "data",
  "javascript",
  "vbscript"
];

export interface SSRFValidationResult {
  allowed: boolean;
  reason?: string;
  url: string;
}

/**
 * Validates a URL against SSRF protection rules
 *
 * @param urlString - The URL to validate
 * @param options - Validation options
 * @returns Validation result with allowed status and reason
 */
export function validateUpstreamUrl(
  urlString: string,
  options: {
    allowPrivateIPs?: boolean;
    allowLocalhost?: boolean;
    allowedSchemes?: string[];
  } = {}
): SSRFValidationResult {
  const {
    allowPrivateIPs = false,
    allowLocalhost = false,
    allowedSchemes = ["http", "https"]
  } = options;

  try {
    const url = new URL(urlString);

    // Check scheme
    if (!allowedSchemes.includes(url.protocol.replace(":", ""))) {
      return {
        allowed: false,
        reason: `Disallowed URL scheme: ${url.protocol}. Only ${allowedSchemes.join(", ")} are permitted.`,
        url: urlString
      };
    }

    // Check for disallowed schemes
    const scheme = url.protocol.replace(":", "");
    if (DISALLOWED_SCHEMES.includes(scheme)) {
      return {
        allowed: false,
        reason: `Forbidden URL scheme: ${url.protocol}`,
        url: urlString
      };
    }

    // Extract hostname
    const hostname = url.hostname.toLowerCase();

    // Check localhost
    if (!allowLocalhost && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")) {
      return {
        allowed: false,
        reason: "Localhost URLs are not permitted for upstream connections",
        url: urlString
      };
    }

    // Check private IP ranges
    if (!allowPrivateIPs) {
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(hostname)) {
          return {
            allowed: false,
            reason: `Private IP address detected: ${hostname}. Private IP ranges are not permitted for upstream connections.`,
            url: urlString
          };
        }
      }
    }

    // URL is safe
    return {
      allowed: true,
      url: urlString
    };

  } catch (error: any) {
    return {
      allowed: false,
      reason: `Invalid URL format: ${error.message}`,
      url: urlString
    };
  }
}

/**
 * Validates multiple upstream URLs
 *
 * @param urls - Array of URLs to validate
 * @param options - Validation options
 * @returns Array of validation results
 */
export function validateUpstreamUrls(
  urls: string[],
  options?: Parameters<typeof validateUpstreamUrl>[1]
): SSRFValidationResult[] {
  return urls.map(url => validateUpstreamUrl(url, options));
}

/**
 * Checks if all URLs pass validation
 *
 * @param urls - Array of URLs to validate
 * @param options - Validation options
 * @returns True if all URLs are allowed
 */
export function allUrlsAllowed(
  urls: string[],
  options?: Parameters<typeof validateUpstreamUrl>[1]
): boolean {
  return validateUpstreamUrls(urls, options).every(result => result.allowed);
}
