// Cloudflare Worker Script
// This proxies /product and /store routes to your Render backend

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const pathname = url.pathname
  
  // Backend URL
  const BACKEND_URL = 'https://salone-fastmarket-backend-api-pro.onrender.com'
  
  // ============================================================================
  // Route: /product/* -> Proxy to backend
  // ============================================================================
  if (pathname.startsWith('/product/')) {
    console.log(`🔗 Proxying product route: ${pathname}`)
    
    const backendUrl = `${BACKEND_URL}${pathname}${url.search}`
    
    try {
      const response = await fetch(backendUrl, {
        method: request.method,
        headers: request.headers,
      })
      
      // Return the response from backend
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    } catch (error) {
      console.error('Error proxying product:', error)
      return new Response('Error loading product', { status: 500 })
    }
  }
  
  // ============================================================================
  // Route: /store/* -> Proxy to backend
  // ============================================================================
  if (pathname.startsWith('/store/')) {
    console.log(`🔗 Proxying store route: ${pathname}`)
    
    const backendUrl = `${BACKEND_URL}${pathname}${url.search}`
    
    try {
      const response = await fetch(backendUrl, {
        method: request.method,
        headers: request.headers,
      })
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    } catch (error) {
      console.error('Error proxying store:', error)
      return new Response('Error loading store', { status: 500 })
    }
  }
  
  // ============================================================================
  // Route: /.well-known/assetlinks.json -> Already working, but keep as backup
  // ============================================================================
  if (pathname === '/.well-known/assetlinks.json') {
    return new Response(JSON.stringify([
      {
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
          "namespace": "android_app",
          "package_name": "jaf.salone.fastmarket.pro.salonefastmarketpro",
          "sha256_cert_fingerprints": [
            "AE:38:94:F3:11:35:A5:8B:95:F9:81:5F:AE:72:16:62:00:02:7D:04:3A:3A:E2:F1:DD:1F:69:88:72:43:1A:78"
          ]
        }
      }
    ]), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
  
  // ============================================================================
  // All other routes -> Pass through to your origin (Flutter web app, etc.)
  // ============================================================================
  return fetch(request)
}