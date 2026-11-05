
export async function onRequest(context) {
  const { request, env } = context

  const apiOrigin = env.API_ORIGIN
  const incomingUrl = new URL(request.url)

  const targetUrl = new URL(
    incomingUrl.pathname + incomingUrl.search,
    apiOrigin
  )

  const headers = new Headers(request.headers)

  // Never use an admin token supplied by the browser.
  headers.set('Authorization', `Bearer ${env.ADMIN_API_TOKEN}`)

  // The upstream host is determined by this function.
  headers.delete('host')

  try {
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : request.body,
    })

    return response
  } catch (error) {
    return Response.json(
      { error: 'Unable to connect to the backend API.' },
      { status: 502 }
    )
  }
}
