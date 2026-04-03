console.log("Deno Nebius Proxy Server Started ✅");

// ✅ API Key 管理类
class APIKeyManager {
  private apiKeys: string[] = [];
  private keyUsageCount = new Map<string, number>();
  private keyLastUsed = new Map<string, number>();
  private loadError: string | null = null;

  constructor() {
    this.loadKeysFromEnv();
    this.logKeyStatus();
  }

  /**
   * 从环境变量加载 API Keys
   */
  private loadKeysFromEnv(): void {
    const envSources = [
      'NEBIUS_API_KEYS',
      'NEBIUS_KEYS',
      'API_KEYS'
    ];

    console.log("🔍 开始加载环境变量...");
    
    for (const envVar of envSources) {
      const keysStr = Deno.env.get(envVar);
      if (keysStr) {
        console.log(`📥 从 ${envVar} 读取到原始值长度: ${keysStr.length} 字符`);
        
        // 🔧 自动处理引号和空格
        const cleanKeysStr = keysStr.replace(/^["']|["']$/g, '');
        
        const keyArray = cleanKeysStr.split(',')
          .map(key => key.trim())
          .filter(key => key.length > 0);
          
        console.log(`📋 分割后的数组: ${keyArray.length} 个 keys`);
        
        // 验证每个 key
        for (let i = 0; i < keyArray.length; i++) {
          const key = keyArray[i];
          const isValid = this.isValidAPIKey(key);
          // 只显示前几位和后几位，避免日志泄露完整 Key
          const maskedKey = key.length > 10 ? `${key.substring(0, 5)}...${key.substring(key.length - 5)}` : 'short-key';
          console.log(`🔑 Key ${i + 1} (${maskedKey}): ${isValid ? '✅ 有效' : '❌ 无效'}`);
          
          if (isValid) {
            this.apiKeys.push(key);
          }
        }
        
        if (this.apiKeys.length > 0) {
          console.log(`✅ 从 ${envVar} 成功加载 ${this.apiKeys.length} 个有效的 API keys`);
          break;
        }
      }
    }

    // 尝试加载索引格式：NEBIUS_API_KEY_1...
    if (this.apiKeys.length === 0) {
      for (let i = 1; i <= 50; i++) {
        const envVar = `NEBIUS_API_KEY_${i}`;
        const key = Deno.env.get(envVar);
        if (key && this.isValidAPIKey(key.trim())) {
          this.apiKeys.push(key.trim());
        }
      }
      if (this.apiKeys.length > 0) {
        console.log(`✅ 从索引格式加载了 ${this.apiKeys.length} 个 API keys`);
      }
    }

    if (this.apiKeys.length === 0) {
      this.loadError = 'No valid API keys found! Please check your environment variables.';
      console.error('❌ 没有找到有效的 API keys! 请检查环境变量设置。');
      return;
    }

    // 初始化使用计数
    this.apiKeys.forEach(key => {
      this.keyUsageCount.set(key, 0);
      this.keyLastUsed.set(key, 0);
    });
  }

  /**
   * 验证 API Key 格式 (已修正)
   */
  private isValidAPIKey(key: string): boolean {
    // 修正：Nebius Key 是 JWT 格式，包含点号 (.)
    // 只要长度足够且不包含空字符即可，不做严格正则验证以免误杀
    return key.length > 20 && !key.includes(" ");
  }

  hasValidKeys(): boolean {
    return this.apiKeys.length > 0;
  }

  getLoadError(): string | null {
    return this.loadError;
  }

  getNextAPIKey(): string {
    if (!this.hasValidKeys()) {
      throw new Error('No valid API keys available');
    }

    const now = Date.now();
    
    // 清理过期的使用记录（1小时前）
    this.keyUsageCount.forEach((count, key) => {
      const lastUsed = this.keyLastUsed.get(key) || 0;
      if (now - lastUsed > 60 * 60 * 1000) {
        this.keyUsageCount.set(key, 0);
      }
    });

    // 找到使用次数最少的 key
    let bestKey = this.apiKeys[0];
    let minUsage = this.keyUsageCount.get(bestKey) || 0;
    
    for (const key of this.apiKeys) {
      const usage = this.keyUsageCount.get(key) || 0;
      if (usage < minUsage) {
        minUsage = usage;
        bestKey = key;
      }
    }

    this.keyUsageCount.set(bestKey, minUsage + 1);
    this.keyLastUsed.set(bestKey, now);

    return bestKey;
  }

  getPublicKeyStatus(): { total: number; usage: number[]; error?: string; hasKeys: boolean } {
    const usage: number[] = [];
    this.apiKeys.forEach(key => {
      usage.push(this.keyUsageCount.get(key) || 0);
    });
    
    const result = {
      total: this.apiKeys.length,
      usage,
      hasKeys: this.apiKeys.length > 0
    };

    if (this.loadError && this.apiKeys.length === 0) {
      return { ...result, error: 'API keys configuration error - check server logs' };
    }

    return result;
  }

  private logKeyStatus(): void {
    if (this.loadError) {
      console.log(`❌ API Keys 加载失败: ${this.loadError}`);
      return;
    }
    console.log(`🔑 总计加载 API Keys: ${this.apiKeys.length}`);
  }
}

// ✅ 代理访问认证管理器
class ProxyAuthManager {
  private customToken: string | null = null;

  constructor() {
    this.loadCustomToken();
  }

  private loadCustomToken(): void {
    const token = Deno.env.get('PROXY_API_TOKEN');
    if (token && token.trim().length > 0) {
      this.customToken = token.trim();
      console.log(`✅ 自定义代理 token 已加载 (长度: ${token.length})`);
    } else {
      console.error('❌ PROXY_API_TOKEN 未设置或为空！');
    }
  }

  validateToken(token: string): boolean {
    if (!this.customToken) return false;
    return this.customToken === token;
  }

  hasValidToken(): boolean {
    return this.customToken !== null;
  }
}

// ✅ 初始化
const keyManager = new APIKeyManager();
const authManager = new ProxyAuthManager();

// ✅ 支持的 API 映射
const apiMapping: Record<string, string> = {
  '/v1': 'https://api.studio.nebius.ai/v1',
  '/nebius': 'https://api.studio.nebius.ai/v1'
};

interface RequestStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  startTime: number;
  authFailures: number;
  rateLimitHits: number;
}

const stats: RequestStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  startTime: Date.now(),
  authFailures: 0,
  rateLimitHits: 0
};

/**
 * 🔄 请求处理器
 */
Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  stats.totalRequests++;
  console.log(`[REQ ${stats.totalRequests}] ${request.method} ${pathname}${search} from ${request.headers.get('CF-IPCountry') || 'Unknown'}`);

  if (pathname === '/' || pathname === '/index.html') {
    return htmlResponse(generateStatusPage(request.url));
  }

  if (pathname === '/status') {
    return jsonResponse({
      service: "Nebius Proxy Server",
      version: "1.1.0",
      uptime: Date.now() - stats.startTime,
      stats,
      keyStatus: keyManager.getPublicKeyStatus(),
      proxyToken: authManager.hasValidToken() ? 'configured' : 'not configured'
    });
  }

  if (pathname === '/robots.txt') {
    return textResponse("User-agent: *\nDisallow: /");
  }

  // 检查配置
  if (!authManager.hasValidToken() || !keyManager.hasValidKeys()) {
    return jsonResponse({ error: "Service Unavailable", message: "Configuration Error" }, 503);
  }

  const [prefix, rest] = extractPrefixAndRest(pathname, Object.keys(apiMapping));
  if (prefix) {
    if (!verifyAuth(request)) {
      stats.failedRequests++;
      stats.authFailures++;
      return jsonResponse({ error: "Unauthorized", message: "Valid Bearer token required" }, 401);
    }
  } else {
    return textResponse("Invalid path", 404);
  }

  const targetUrl = `${apiMapping[prefix]}${rest}${search}`;

  let apiKey: string;
  try {
    apiKey = keyManager.getNextAPIKey();
  } catch (_error) {
    stats.failedRequests++;
    return jsonResponse({ error: "Service Unavailable", message: "No API keys available" }, 503);
  }

  let retries = 3;
  let response: Response | null = null;

  while (retries > 0) {
    try {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${apiKey}`);
      headers.set("User-Agent", "Deno-Proxy/1.0");
      headers.delete("Host");
      headers.delete("CF-Ray");
      headers.delete("CF-IPCountry");

      console.log(`👉 Proxying to: ${targetUrl.split('?')[0]} (attempt ${4 - retries})`);
      
      response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
        redirect: "follow"
      });

      if (response.status === 401 || response.status === 403) {
        console.log(`⚠️ Auth failed (${response.status}), retrying...`);
        stats.authFailures++;
        retries--;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (response.status === 429) {
        console.log(`⚠️ Rate limited, retrying...`);
        stats.rateLimitHits++;
        retries--;
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      break;
    } catch (error) {
      console.error(`🆘 Proxy Error: ${(error as Error).message}`);
      retries--;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  if (!response) {
    stats.failedRequests++;
    return jsonResponse({ error: "Bad Gateway", message: "All retries failed" }, 502);
  }

  stats.successfulRequests++;

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("X-Proxy-Server", "Deno Nebius Proxy");
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
});

function verifyAuth(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '').trim();
  return authManager.validateToken(token);
}

function extractPrefixAndRest(path: string, prefixes: string[]): [string, string] {
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      if (!rest || rest.startsWith('/')) {
        return [prefix, rest || ""];
      }
    }
  }
  return ["", ""];
}

function generateStatusPage(requestUrl: string): string {
  const keyStatus = keyManager.getPublicKeyStatus();
  const hasProxyToken = authManager.hasValidToken();
  const baseUrl = new URL(requestUrl).origin;
  
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Nebius Proxy</title>
    <meta charset="utf-8">
    <style>
        body { font-family: sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; background: #f0f2f5; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .status-ok { color: green; } .status-err { color: red; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🚀 Nebius Proxy Server</h1>
        <p>Status: ${keyStatus.hasKeys && hasProxyToken ? '<span class="status-ok">Active</span>' : '<span class="status-err">Config Error</span>'}</p>
        <p>Keys Loaded: ${keyStatus.total}</p>
        <p>Requests: ${stats.totalRequests}</p>
        <p><strong>Endpoint:</strong> ${baseUrl}/v1/chat/completions</p>
    </div>
</body>
</html>`;
}

function htmlResponse(content: string): Response {
  return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function textResponse(content: string, status = 200): Response {
  return new Response(content, { headers: { "Content-Type": "text/plain; charset=utf-8" }, status });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" }, status });
}
