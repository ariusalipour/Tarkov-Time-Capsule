// Keep existing clients working while the API and data live entirely on the NAS.
export default {
  fetch(request) {
    const source = new URL(request.url);
    const destination = new URL('https://tarkovcapsule.mockachino.app');
    destination.pathname = source.pathname;
    destination.search = source.search;
    return new Response(null, {
      status: 307,
      headers: {
        Location: destination.href,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
